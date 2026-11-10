import { fold } from "./catalog";
import { log } from "./log";
import type { Quote } from "./quote";
import { billedGrams, cardFee, type RateCard } from "./rates";
import { HCM_PROVINCE } from "./validation";

// Shipping fees come from GHN's rate card (src/lib/rates.ts): one price inside Ho Chi Minh City,
// prices by billed weight for other provinces, free from the threshold. No carrier is called to
// price an order.
//
// GHN's API (https://developer.ghn.vn) books HCM parcels from /admin and reports their status. It
// uses the post-2025 two-level address (province + ward, `is_new_to_address`), so checkout checks
// HCM wards against GHN's list.

/** One parcel: grams and centimetres. */
export interface Parcel {
	weight: number;
	length: number;
	width: number;
	height: number;
}

export interface GhnConfig {
	apiUrl: string;
	token: string;
	shopId: number;
	/** Value GHN sends in the X-Webhook-Token header of order callbacks; callbacks are refused without it. */
	webhookSecret: string | null;
}

export interface ShippingSettings {
	/**
	 * One item to another province: the most a one-item order pays. Used before the address is
	 * known (structured data, the Merchant feed).
	 */
	fee: number;
	/** One item inside HCM: the lowest fee, shown as the starting price. */
	localFee: number;
	freeThreshold: number;
	eta: string;
	/** Packed size of one item; an order stacks its items. */
	parcel: Parcel;
	/** GHN's rate card: the fee of every order. */
	rates: RateCard;
	/** GHN's API: HCM ward names at checkout and parcel booking from /admin. */
	ghn: GhnConfig | null;
}

export interface Destination {
	province: string;
	ward: string;
}

/** An HCM ward GHN doesn't deliver to (or misspelled): the shopper must pick one from the list. */
export class ShippingAddressError extends Error {}

/** The parcel for `items` units: weights add up and the boxes stack (GHN caps a side at 200cm). */
export function parcelFor(per: Parcel, items: number): Parcel {
	const n = Math.max(1, items);
	return { weight: per.weight * n, length: per.length, width: per.width, height: Math.min(200, per.height * n) };
}

// ------------------------------------------------------------------ GHN client

const GHN_TIMEOUT_MS = 5000;

interface GhnPlace {
	_id: number;
	name: string;
	extension_names?: string[] | null;
	status?: number;
}

/**
 * Calls GHN. `noCustomerData` marks requests that carry no customer data (master data): only
 * their errors keep GHN's message text.
 */
async function ghnCall<T>(cfg: GhnConfig, path: string, f: typeof fetch, body?: unknown, noCustomerData = body === undefined): Promise<T> {
	const res = await f(`${cfg.apiUrl}${path}`, {
		method: body === undefined ? "GET" : "POST",
		headers: { Token: cfg.token, ShopId: String(cfg.shopId), "Content-Type": "application/json" },
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
		signal: AbortSignal.timeout(GHN_TIMEOUT_MS),
	});
	const json = (await res.json().catch(() => null)) as { code?: number; data?: T; code_message?: unknown; message?: unknown } | null;
	if (!res.ok || !json || json.code !== 200 || json.data == null) {
		// Errors name the endpoint, GHN's code and error name, never the token or the request; GHN's
		// message only when the request had no customer data it could echo back.
		const name = typeof json?.code_message === "string" ? ` ${json.code_message.slice(0, 50)}` : "";
		const message = noCustomerData && typeof json?.message === "string" ? `: ${json.message.slice(0, 160)}` : "";
		throw new Error(`ghn ${path.split("?")[0]} ${json?.code ?? res.status}${name}${message}`);
	}
	return json.data;
}

const DAY_MS = 24 * 3600_000;
/** A failed lookup is remembered this long, so page loads during a GHN outage don't each call GHN. */
const FAILURE_TTL_MS = 2 * 60_000;
type Area = { province: string; wards: GhnPlace[] };
const wardCache = new Map<string, { at: number; ttl: number; area: Promise<Area> }>();

const names = (p: GhnPlace) => [p.name, ...(p.extension_names ?? [])].map(fold);

async function fetchArea(cfg: GhnConfig, province: string, f: typeof fetch): Promise<Area> {
	const all = await ghnCall<GhnPlace[]>(cfg, "/shiip/public-api/v3/master-data/province/all?offset=0&limit=200", f);
	const wanted = fold(province);
	const match = all.find((p) => p.status === 1 && names(p).includes(wanted));
	if (!match) throw new Error("ghn province not found");
	const wards = (
		await ghnCall<GhnPlace[]>(cfg, `/shiip/public-api/v3/master-data/ward/all-by-province-id?province_id=${match._id}&offset=0&limit=200`, f)
	).filter((w) => w.status === 1 && typeof w.name === "string");
	if (!wards.length) throw new Error("ghn wards empty");
	return { province: match.name, wards };
}

/**
 * GHN's name for a province and its wards (two-level model), cached for a day per isolate.
 * Concurrent misses share one request, and a failure is cached briefly.
 */
export function ghnWards(cfg: GhnConfig, province: string, f: typeof fetch = fetch): Promise<Area> {
	const hit = wardCache.get(province);
	if (hit && Date.now() - hit.at < hit.ttl) return hit.area;
	const area = fetchArea(cfg, province, f);
	const entry = { at: Date.now(), ttl: DAY_MS, area };
	wardCache.set(province, entry);
	area.catch(() => {
		entry.ttl = FAILURE_TTL_MS;
	});
	return area;
}

/** GHN's canonical name for the ward the shopper typed or picked, if it is one of `wards`. */
export function matchWard(wards: GhnPlace[], input: string): string | null {
	const typed = input.trim().replace(/\s+/g, " ");
	if (!typed) return null;
	// An exact pick first (wards may differ only by accents), then accent-free names and GHN's variants.
	const exact = wards.find((w) => w.name.toLocaleLowerCase("vi") === typed.toLocaleLowerCase("vi"));
	if (exact) return exact.name;
	const wanted = fold(typed);
	return wards.find((w) => names(w).includes(wanted))?.name ?? null;
}

// ------------------------------------------------------------------ pricing a quote

export interface ShippedQuote extends Quote {
	/** True until the shopper gives the province the fee depends on. */
	shippingPending: boolean;
	/** GHN's spelling of an HCM ward. */
	ward?: string;
}

/**
 * Adds the shipping fee to a quote: free from the threshold, otherwise the rate card's price for
 * the zone and the parcel's billed weight. Inside HCM, with GHN on, the ward must be one GHN knows
 * so the parcel can be booked (ShippingAddressError otherwise); if GHN's ward list can't be
 * loaded, the ward is kept as typed.
 */
export async function priceShipping(quote: Quote, rules: ShippingSettings, to: Destination | undefined, f: typeof fetch = fetch): Promise<ShippedQuote> {
	const done = (fee: number, extra: Partial<ShippedQuote> = {}): ShippedQuote => ({
		...quote,
		shippingFee: fee,
		total: quote.subtotal + fee,
		shippingPending: false,
		...extra,
	});
	if (quote.itemCount === 0) return done(0);
	const free = quote.subtotal >= rules.freeThreshold;
	if (!to) return free ? done(0) : done(0, { shippingPending: true });
	const local = to.province === HCM_PROVINCE;
	const fee = free ? 0 : cardFee(rules.rates, local, billedGrams(parcelFor(rules.parcel, quote.itemCount)));
	const ward = local && rules.ghn ? await knownWard(rules.ghn, to, f) : null;
	return done(fee, ward ? { ward } : {});
}

/** GHN's spelling of the HCM ward; null when none is typed yet or GHN's list can't be loaded. */
async function knownWard(cfg: GhnConfig, to: Destination, f: typeof fetch): Promise<string | null> {
	if (!to.ward.trim()) return null;
	let area: Area;
	try {
		area = await ghnWards(cfg, to.province, f);
	} catch (error) {
		log.warn("shipping.ghn_failed", { step: "wards", reason: error instanceof Error ? error.message : "unknown" });
		return null;
	}
	const ward = matchWard(area.wards, to.ward);
	if (!ward) throw new ShippingAddressError("unknown ward");
	return ward;
}

// ------------------------------------------------------------------ booking a parcel

export interface GhnBooking {
	/** Our order id, sent as client_order_code: GHN returns the same parcel when a booking is retried. */
	orderId: string;
	name: string;
	phone: string;
	street: string;
	/** GHN's own province and ward names (two-level model). */
	to: Destination;
	codAmount: number;
	parcel: Parcel;
	items: { name: string; quantity: number; price: number }[];
	note?: string;
}

/** Books a parcel with GHN (Create Order); the shop pays GHN, the customer pays the shop. Returns GHN's tracking code. */
export async function ghnCreateOrder(cfg: GhnConfig, b: GhnBooking, f: typeof fetch = fetch): Promise<string> {
	const data = await ghnCall<{ order_code?: unknown }>(cfg, "/shiip/public-api/v2/shipping-order/create", f, {
		payment_type_id: 1,
		required_note: "CHOXEMHANGKHONGTHU",
		client_order_code: b.orderId,
		to_name: b.name,
		to_phone: b.phone,
		to_address: `${b.street}, ${b.to.ward}, ${b.to.province}`,
		to_ward_name: b.to.ward,
		to_province_name: b.to.province,
		is_new_to_address: true,
		cod_amount: b.codAmount,
		service_type_id: 2,
		...b.parcel,
		items: b.items.map((i) => ({ name: i.name.slice(0, 512), quantity: i.quantity, price: i.price })),
		...(b.note ? { note: b.note.slice(0, 5000) } : {}),
	});
	const code = data.order_code;
	if (typeof code !== "string" || !/^[A-Za-z0-9]{1,50}$/.test(code)) throw new Error("ghn order_code invalid");
	return code;
}

/** GHN statuses that mean the parcel has left the shop. */
export const GHN_IN_TRANSIT = new Set(["picked", "storing", "sorting", "transporting", "delivering", "money_collect_delivering", "delivery_fail"]);

/** For tests: forget cached GHN wards. */
export function clearShippingCache() {
	wardCache.clear();
}
