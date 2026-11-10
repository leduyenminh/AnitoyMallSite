import { afterEach, describe, expect, it } from "vitest";
import { parseParcel, settings } from "./config";
import type { Quote } from "./quote";
import { billedGrams, cardFee, GHN_RATES, parseBands, parseExtraPerKg } from "./rates";
import { clearShippingCache, matchWard, parcelFor, priceShipping, ShippingAddressError } from "./shipping";

// Shipping fees from GHN's rate card, with GHN's ward list stubbed: no network, fake data only.

const HCM = "Thành phố Hồ Chí Minh";
const HANOI = "Thành phố Hà Nội";
const rules = settings({} as unknown as Env).shipping;
const ghnRules = settings({ GHN_TOKEN: "test-token", GHN_SHOP_ID: "123" } as unknown as Env).shipping;

const quote = (subtotal: number, itemCount = 1): Quote => ({
	lines: [],
	itemCount,
	subtotal,
	shippingFee: 0,
	total: subtotal,
	freeShippingRemaining: 0,
	freeShippingThreshold: rules.freeThreshold,
	hasIssues: false,
});

/** A GHN stand-in: HCM with two wards (or failing). Records the URLs called. */
function fakeGhn(fail = false) {
	const calls: string[] = [];
	const json = (data: unknown, code = 200) => new Response(JSON.stringify({ code, message: "Success", data }), { status: code });
	const f = (async (input: RequestInfo | URL) => {
		const url = String(input);
		calls.push(url);
		if (fail) return json(null, 500);
		if (url.includes("/v3/master-data/province/all"))
			return json([{ _id: 1000001, name: "Hồ Chí Minh", extension_names: ["thành phố hồ chí minh", "hcm"], status: 1 }]);
		if (url.includes("/v3/master-data/ward/all-by-province-id?province_id=1000001"))
			return json([
				{ _id: 1, name: "Phường Bến Thành", extension_names: ["ben thanh", "p.bến thành"], status: 1 },
				{ _id: 2, name: "Phường Sài Gòn", extension_names: [], status: 1 },
			]);
		return json(null, 404);
	}) as typeof fetch;
	return { f, calls };
}

afterEach(clearShippingCache);

describe("GHN's rate card", () => {
	it("bills the larger of the real weight and the size weight", () => {
		expect(billedGrams({ weight: 200, length: 20, width: 10, height: 10 })).toBe(400);
		expect(billedGrams({ weight: 900, length: 20, width: 10, height: 10 })).toBe(900);
		expect(billedGrams({ weight: 1, length: 3, width: 3, height: 3 })).toBe(6); // 27 cm³ / 5, rounded up
	});

	it("prices by zone and weight band, then per started kg past the last band", () => {
		expect(cardFee(GHN_RATES, true, 400)).toBe(16500);
		expect(cardFee(GHN_RATES, true, 3000)).toBe(16500);
		expect(cardFee(GHN_RATES, true, 3001)).toBe(23500);
		expect(cardFee(GHN_RATES, false, 500)).toBe(26000);
		expect(cardFee(GHN_RATES, false, 501)).toBe(28000);
		expect(cardFee(GHN_RATES, false, 2000)).toBe(30000);
		expect(cardFee(GHN_RATES, false, 5000)).toBe(42000);
		expect(cardFee(GHN_RATES, false, 5001)).toBe(49000);
		expect(cardFee(GHN_RATES, false, 7000)).toBe(56000);
	});

	it("reads the card from settings, falling back to GHN's card when malformed", () => {
		expect(rules.rates).toEqual(GHN_RATES);
		expect(rules).toMatchObject({ fee: 26000, localFee: 16500 });
		expect(parseBands("1000:20000, 2000:25000", [])).toEqual([
			{ upTo: 1000, fee: 20000 },
			{ upTo: 2000, fee: 25000 },
		]);
		const badBands = ["", "2000:25000,1000:20000", "1000:20000.5", "1000", "1000:20000:1", "0:100", "1000:-1", "1000:abc", "1000:", "1000: ", "500:26000,1000:"];
		for (const bad of [...badBands, "5e2:2.6e4", "0x1F4:26000", "+500:+26000"]) expect(parseBands(bad, GHN_RATES.other)).toBe(GHN_RATES.other);
		expect(parseExtraPerKg("8000", 7000)).toBe(8000);
		for (const bad of [undefined, "", " ", "-1", "7000.5", "x", "0x10", "7e3"]) expect(parseExtraPerKg(bad, 7000)).toBe(7000);
		const custom = settings({ SHIPPING_RATES_HCM: "3000:20000", SHIPPING_RATES_OTHER: "500:30000", SHIPPING_FEE_PER_EXTRA_KG: "5000" } as unknown as Env).shipping;
		expect(custom).toMatchObject({ fee: 30000, localFee: 20000, rates: { extraPerKg: 5000 } });
	});
});

describe("shipping on a quote", () => {
	it("charges the card by province and the stacked parcel's billed weight", async () => {
		const at = async (province: string, items: number) => (await priceShipping(quote(50000, items), rules, { province, ward: "Phường Thử" })).shippingFee;
		expect(await at(HCM, 1)).toBe(16500);
		expect(await at(HCM, 5)).toBe(16500); // 2 kg billed
		expect(await at(HANOI, 1)).toBe(26000); // 0.4 kg
		expect(await at(HANOI, 2)).toBe(28000); // 0.8 kg
		expect(await at(HANOI, 3)).toBe(30000); // 1.2 kg
		expect(await at(HANOI, 6)).toBe(33000); // 2.4 kg
		const q = await priceShipping(quote(50000, 2), rules, { province: HANOI, ward: "Phường Hoàn Kiếm" });
		expect(q).toMatchObject({ shippingFee: 28000, total: 78000, shippingPending: false });
	});

	it("is free from the threshold, and waits for the province otherwise", async () => {
		expect(await priceShipping(quote(rules.freeThreshold), rules, undefined)).toMatchObject({ shippingFee: 0, shippingPending: false });
		expect((await priceShipping(quote(rules.freeThreshold), rules, { province: HANOI, ward: "Phường Hoàn Kiếm" })).shippingFee).toBe(0);
		expect(await priceShipping(quote(50000), rules, undefined)).toMatchObject({ shippingFee: 0, total: 50000, shippingPending: true });
		expect(await priceShipping(quote(0, 0), rules, undefined)).toMatchObject({ shippingFee: 0, shippingPending: false });
	});

	it("checks HCM wards against GHN's list without changing the fee, and never calls GHN for other provinces", async () => {
		const { f, calls } = fakeGhn();
		expect(await priceShipping(quote(50000, 2), ghnRules, { province: HCM, ward: "ben thanh" }, f)).toMatchObject({
			shippingFee: 16500,
			ward: "Phường Bến Thành",
		});
		await expect(priceShipping(quote(50000), ghnRules, { province: HCM, ward: "Phường Không Có" }, f)).rejects.toBeInstanceOf(ShippingAddressError);
		// Free shipping doesn't skip the check: the parcel still has to be booked.
		await expect(priceShipping(quote(ghnRules.freeThreshold), ghnRules, { province: HCM, ward: "Phường Không Có" }, f)).rejects.toBeInstanceOf(
			ShippingAddressError,
		);
		const callsSoFar = calls.length;
		expect((await priceShipping(quote(50000), ghnRules, { province: HANOI, ward: "Phường Hoàn Kiếm" }, f)).shippingFee).toBe(26000);
		expect(await priceShipping(quote(50000), ghnRules, { province: HCM, ward: " " }, f)).toMatchObject({ shippingFee: 16500, shippingPending: false });
		expect(calls).toHaveLength(callsSoFar);
		expect(calls.some((url) => url.includes("preview"))).toBe(false);
	});

	it("keeps the ward as typed when GHN's list can't be loaded", async () => {
		const q = await priceShipping(quote(50000), ghnRules, { province: HCM, ward: "Phường Sài Gòn" }, fakeGhn(true).f);
		expect(q).toMatchObject({ shippingFee: 16500, shippingPending: false });
		expect(q.ward).toBeUndefined();
	});

	it("doesn't check wards until GHN is configured", async () => {
		const { f, calls } = fakeGhn();
		const partial = settings({ GHN_TOKEN: "test-token" } as unknown as Env).shipping;
		expect(partial.ghn).toBeNull();
		expect((await priceShipping(quote(50000), partial, { province: HCM, ward: "Phường Không Có" }, f)).shippingFee).toBe(16500);
		expect(calls).toHaveLength(0);
	});
});

describe("wards and parcels", () => {
	it("matches the exact ward before accent-free spellings", () => {
		const wards = [
			{ _id: 1, name: "Xã An Thơi", extension_names: [], status: 1 },
			{ _id: 2, name: "Xã An Thới", extension_names: [], status: 1 },
		];
		expect(matchWard(wards, "xã an thới")).toBe("Xã An Thới");
		expect(matchWard(wards, "Xã An Thơi")).toBe("Xã An Thơi");
		expect(matchWard(wards, "xa an thoi")).toBe("Xã An Thơi");
		expect(matchWard(wards, "  ")).toBeNull();
	});

	it("stacks items into one parcel and reads the parcel setting", () => {
		expect(parcelFor({ weight: 200, length: 20, width: 10, height: 10 }, 3)).toEqual({ weight: 600, length: 20, width: 10, height: 30 });
		expect(parseParcel("150", "15x10x8")).toEqual({ weight: 150, length: 15, width: 10, height: 8 });
		expect(parseParcel("abc", "15x10")).toEqual(rules.parcel);
	});
});
