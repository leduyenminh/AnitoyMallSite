import { fold } from "./catalog";
import { log } from "./log";
import type { Quote } from "./quote";
import { HCM_PROVINCE } from "./validation";

// Shipping fees. Orders inside Ho Chi Minh City are priced by GHN for the customer's ward; other
// provinces will use Viettel Post, which is not connected yet, so they pay the flat SHIPPING_FEE.
// Orders from the free-shipping threshold ship free. If GHN can't be reached, the flat fee applies.
//
// GHN (https://developer.ghn.vn): the fee comes from "Preview Order", a dry run of Create Order
// that accepts the post-2025 two-level address (province + ward, `is_new_to_address`). No order is
// created and no customer data is sent: the recipient is the shop itself (SHIP_FROM_PHONE).

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
	/** The shop's name and phone, used as the recipient of fee previews. */
	previewName: string;
	previewPhone: string;
	/** Value GHN sends in the X-Webhook-Token header of order callbacks; callbacks are refused without it. */
	webhookSecret: string | null;
}

export interface ShippingSettings {
	/** Flat fee where no carrier price applies. */
	fee: number;
	freeThreshold: number;
	eta: string;
	/** Packed size of one item; an order stacks its items. */
	parcel: Parcel;
	ghn: GhnConfig | null;
}

export interface Destination {
	province: string;
	ward: string;
}

/** The ward is not one GHN delivers to (or is misspelled): the shopper must pick one from the list. */
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
 * Calls GHN. `noCustomerData` marks requests that carry no customer data (master data, fee
 * previews addressed to the shop): only their errors keep GHN's message text.
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

const FEE_TTL_MS = 30 * 60_000;
const feeCache = new Map<string, { at: number; fee: number }>();

/** GHN's fee to deliver `parcel` to a ward (GHN's own province and ward names). */
export async function ghnFee(cfg: GhnConfig, to: Destination, parcel: Parcel, f: typeof fetch = fetch): Promise<number> {
	const key = `${to.province}|${to.ward}|${parcel.weight}|${parcel.length}x${parcel.width}x${parcel.height}`;
	const hit = feeCache.get(key);
	if (hit && Date.now() - hit.at < FEE_TTL_MS) return hit.fee;
	const data = await ghnCall<{ total_fee?: unknown }>(
		cfg,
		"/shiip/public-api/v2/shipping-order/preview",
		f,
		{
			payment_type_id: 1,
			required_note: "CHOXEMHANGKHONGTHU",
			to_name: cfg.previewName,
			to_phone: cfg.previewPhone,
			to_address: `${to.ward}, ${to.province}`,
			to_ward_name: to.ward,
			to_province_name: to.province,
			is_new_to_address: true,
			service_type_id: 2,
			content: "Mô hình, phụ kiện anime",
			...parcel,
		},
		true,
	);
	const fee = data.total_fee;
	if (typeof fee !== "number" || !Number.isSafeInteger(fee) || fee < 0 || fee > 5_000_000) throw new Error("ghn fee invalid");
	// Bounded: drop the oldest entry rather than the whole cache.
	if (feeCache.size >= 500) feeCache.delete(feeCache.keys().next().value!);
	feeCache.set(key, { at: Date.now(), fee });
	return fee;
}

// ------------------------------------------------------------------ pricing a quote

export interface ShippedQuote extends Quote {
	/** True until the shopper gives an address the fee depends on. */
	shippingPending: boolean;
	/** GHN's spelling of the ward, when GHN priced the order. */
	ward?: string;
}

/**
 * Adds the shipping fee to a quote. Free from the threshold; inside HCM, GHN's price for the ward
 * (throws ShippingAddressError for a ward GHN doesn't know); elsewhere, or when GHN fails, the flat fee.
 */
export async function priceShipping(quote: Quote, rules: ShippingSettings, to: Destination | undefined, f: typeof fetch = fetch): Promise<ShippedQuote> {
	const done = (fee: number, extra: Partial<ShippedQuote> = {}): ShippedQuote => ({
		...quote,
		shippingFee: fee,
		total: quote.subtotal + fee,
		shippingPending: false,
		...extra,
	});
	if (quote.itemCount === 0 || quote.subtotal >= rules.freeThreshold) return done(0);
	// Without GHN the fee doesn't depend on the address; with it, HCM needs the ward first.
	if (!to) return rules.ghn ? done(0, { shippingPending: true }) : done(rules.fee);
	const ghnArea = Boolean(rules.ghn) && to.province === HCM_PROVINCE;
	if (ghnArea && !to.ward.trim()) return done(0, { shippingPending: true });
	if (!ghnArea || !rules.ghn) return done(rules.fee);

	let area: { province: string; wards: GhnPlace[] };
	try {
		area = await ghnWards(rules.ghn, to.province, f);
	} catch (error) {
		log.warn("shipping.ghn_failed", { step: "wards", reason: error instanceof Error ? error.message : "unknown" });
		return done(rules.fee);
	}
	const ward = matchWard(area.wards, to.ward);
	if (!ward) throw new ShippingAddressError("unknown ward");
	try {
		const fee = await ghnFee(rules.ghn, { province: area.province, ward }, parcelFor(rules.parcel, quote.itemCount), f);
		return done(fee, { ward });
	} catch (error) {
		log.warn("shipping.ghn_failed", { step: "fee", reason: error instanceof Error ? error.message : "unknown" });
		return done(rules.fee, { ward });
	}
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

/** For tests: forget cached GHN wards and fees. */
export function clearShippingCache() {
	wardCache.clear();
	feeCache.clear();
}
