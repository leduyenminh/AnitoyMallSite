import { afterEach, describe, expect, it } from "vitest";
import { parseParcel, settings } from "./config";
import type { Quote } from "./quote";
import { clearShippingCache, matchWard, parcelFor, priceShipping, ShippingAddressError } from "./shipping";

// Shipping rules with GHN stubbed: no network, fake shop details only.

const HCM = "Thành phố Hồ Chí Minh";
const ghnEnv = { GHN_TOKEN: "test-token", GHN_SHOP_ID: "123", SHIP_FROM_PHONE: "0900000000" };
const rules = settings(ghnEnv as unknown as Env).shipping;

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

interface Call {
	url: string;
	headers: Record<string, string>;
	body: Record<string, unknown> | null;
}

/** A GHN stand-in: HCM with two wards, and a fee preview that answers `fee` (or fails). */
function fakeGhn(fee: number | "fail" = 22000) {
	const calls: Call[] = [];
	const json = (data: unknown, code = 200) => new Response(JSON.stringify({ code, message: "Success", data }), { status: code });
	const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		calls.push({ url, headers: init?.headers as Record<string, string>, body: init?.body ? JSON.parse(String(init.body)) : null });
		if (url.includes("/v3/master-data/province/all"))
			return json([{ _id: 1000001, name: "Hồ Chí Minh", extension_names: ["thành phố hồ chí minh", "hcm"], status: 1 }]);
		if (url.includes("/v3/master-data/ward/all-by-province-id?province_id=1000001"))
			return json([
				{ _id: 1, name: "Phường Bến Thành", extension_names: ["ben thanh", "p.bến thành"], status: 1 },
				{ _id: 2, name: "Phường Sài Gòn", extension_names: [], status: 1 },
			]);
		if (url.endsWith("/v2/shipping-order/preview")) return fee === "fail" ? json(null, 400) : json({ total_fee: fee });
		return json(null, 404);
	}) as typeof fetch;
	return { f, calls };
}

afterEach(clearShippingCache);

describe("shipping", () => {
	it("is free from the threshold and flat outside HCM, without calling GHN", async () => {
		const { f, calls } = fakeGhn();
		expect((await priceShipping(quote(rules.freeThreshold), rules, { province: HCM, ward: "Phường Bến Thành" }, f)).shippingFee).toBe(0);
		const hanoi = await priceShipping(quote(50000), rules, { province: "Thành phố Hà Nội", ward: "Phường Hoàn Kiếm" }, f);
		expect(hanoi).toMatchObject({ shippingFee: rules.fee, total: 50000 + rules.fee, shippingPending: false });
		expect(calls).toHaveLength(0);
	});

	it("waits for an address, and for the ward inside HCM", async () => {
		const { f } = fakeGhn();
		expect((await priceShipping(quote(50000), rules, undefined, f)).shippingPending).toBe(true);
		expect((await priceShipping(quote(50000), rules, { province: HCM, ward: " " }, f)).shippingPending).toBe(true);
	});

	it("prices HCM with GHN by ward, sending the shop's details and no customer data", async () => {
		const { f, calls } = fakeGhn(22000);
		const q = await priceShipping(quote(50000, 2), rules, { province: HCM, ward: "ben thanh" }, f);
		expect(q).toMatchObject({ shippingFee: 22000, total: 72000, ward: "Phường Bến Thành", shippingPending: false });
		const preview = calls.find((c) => c.url.endsWith("/preview"))!;
		expect(preview.headers).toMatchObject({ Token: "test-token", ShopId: "123" });
		expect(preview.body).toMatchObject({
			to_name: "Mall of Anitoy",
			to_phone: "0900000000",
			to_ward_name: "Phường Bến Thành",
			to_province_name: "Hồ Chí Minh",
			is_new_to_address: true,
			service_type_id: 2,
			weight: 400,
			height: 20,
		});
	});

	it("rejects a ward GHN doesn't know, and falls back to the flat fee when GHN fails", async () => {
		await expect(priceShipping(quote(50000), rules, { province: HCM, ward: "Phường Không Có" }, fakeGhn().f)).rejects.toBeInstanceOf(ShippingAddressError);
		clearShippingCache();
		const down = await priceShipping(quote(50000), rules, { province: HCM, ward: "Phường Sài Gòn" }, fakeGhn("fail").f);
		expect(down.shippingFee).toBe(rules.fee);
	});

	it("uses the flat fee everywhere until GHN is fully configured", async () => {
		const { f, calls } = fakeGhn();
		const partial = settings({ GHN_TOKEN: "test-token", GHN_SHOP_ID: "123" } as unknown as Env).shipping;
		expect(partial.ghn).toBeNull();
		expect((await priceShipping(quote(50000), partial, { province: HCM, ward: "Phường Sài Gòn" }, f)).shippingFee).toBe(partial.fee);
		expect(await priceShipping(quote(50000), partial, undefined, f)).toMatchObject({ shippingFee: partial.fee, shippingPending: false });
		expect(calls).toHaveLength(0);
	});

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
