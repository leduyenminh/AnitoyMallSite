import { describe, expect, it } from "vitest";
import { fold, search, videoUploadedAt } from "./catalog";
import { enabledPaymentMethods, settings, wwwRedirect } from "./config";
import { randomCode, safeEqual } from "./crypto";
import { percentOff } from "./money";
import { crc16, safeMemo, vietQrPayload } from "./payments/vietqr";
import { buildQuote, shippingFor } from "./quote";
import { escapeXml, googleFeed, productJsonLd } from "./seo";
import type { Product } from "./types";
import { findOrderCodes, isOrderCode, normaliseOrderCode, normalisePhone, ORDER_CODE_ALPHABET } from "./validation";

const env = { SITE_URL: "https://shop.example.vn" } as unknown as Env;
const s = settings(env);
const rules = { fee: 30000, freeThreshold: 150000 };

function product(overrides: Partial<Product> = {}): Product {
	return {
		id: "p1",
		slug: "mo-hinh-test",
		status: "active",
		title: "Mô hình test",
		description: "Mô tả",
		images: ["/media/p/p1-1.webp"],
		collection: "frieren",
		category: "mini",
		tags: ["frieren"],
		attributes: [],
		featured: 0,
		videoIds: [],
		skus: [{ id: "s1", productId: "p1", name: "Frieren", price: 80000, stock: 5, position: 0 }],
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
		...overrides,
	};
}

describe("buildQuote", () => {
	it("prices from the catalog, not the client, and adds shipping under the threshold", () => {
		const q = buildQuote([{ productId: "p1", skuId: "s1", quantity: 1, price: 1 }], [product()], rules);
		expect(q.subtotal).toBe(80000);
		expect(q.shippingFee).toBe(30000);
		expect(q.total).toBe(110000);
		expect(q.lines[0]?.issue).toBe("price_changed");
		expect(q.freeShippingRemaining).toBe(70000);
	});

	it("caps quantity at stock and flags it", () => {
		const q = buildQuote([{ productId: "p1", skuId: "s1", quantity: 9 }], [product()], rules);
		expect(q.lines[0]?.quantity).toBe(5);
		expect(q.lines[0]?.issue).toBe("insufficient_stock");
		expect(q.shippingFee).toBe(0); // 400.000đ is over the free-shipping threshold
	});

	it("merges duplicate lines and rejects drafts and unpriced SKUs", () => {
		const merged = buildQuote(
			[
				{ productId: "p1", skuId: "s1", quantity: 1 },
				{ productId: "p1", skuId: "s1", quantity: 2 },
			],
			[product()],
			rules,
		);
		expect(merged.lines).toHaveLength(1);
		expect(merged.lines[0]?.quantity).toBe(3);
		const draft = buildQuote([{ productId: "p1", skuId: "s1", quantity: 1 }], [product({ status: "draft" })], rules);
		expect(draft.lines[0]?.issue).toBe("unavailable");
		expect(draft.total).toBe(0);
	});

	it("charges no shipping on an empty cart", () => {
		expect(shippingFor(0, rules)).toBe(0);
	});
});

describe("validation", () => {
	it("normalises Vietnamese mobile numbers", () => {
		expect(normalisePhone("+84 900 000 000")).toBe("0900000000");
		expect(normalisePhone("0900.000.000")).toBe("0900000000");
		expect(normalisePhone("0200000000")).toBeNull();
	});

	it("accepts order codes with or without the prefix", () => {
		expect(normaliseOrderCode("ma 3k7 pq2x")).toBe("MA3K7PQ2X");
		expect(normaliseOrderCode("3K7PQ2X")).toBe("MA3K7PQ2X");
		expect(isOrderCode("MA3K7PQ2X")).toBe(true);
		expect(isOrderCode("MA3K7PQ2O")).toBe(false); // O is not in the alphabet
	});

	it("finds order codes in bank-transfer memos, with or without spaces", () => {
		expect(findOrderCodes("NGUYEN VAN A chuyen tien MA3K7PQ2X")).toContain("MA3K7PQ2X");
		expect(findOrderCodes("MA 3K7 PQ2X FT2611")).toContain("MA3K7PQ2X");
		expect(findOrderCodes("chuyen tien")).toEqual([]);
	});

	it("generates codes from the unambiguous alphabet", () => {
		const code = `MA${randomCode(ORDER_CODE_ALPHABET, 7)}`;
		expect(isOrderCode(code)).toBe(true);
	});
});

describe("VietQR", () => {
	it("uses CRC-16/CCITT-FALSE", () => {
		expect(crc16("123456789")).toBe("29B1");
	});

	it("builds a dynamic NAPAS payload for the BIDV account", () => {
		const payload = vietQrPayload({ bin: "970418", accountNo: "1234567890", amount: 118941, memo: "MA3K7PQ2X" });
		expect(payload.startsWith("000201010212")).toBe(true);
		expect(payload).toContain("0010A000000727");
		expect(payload).toContain("0006970418");
		expect(payload).toContain("01101234567890");
		expect(payload).toContain("0208QRIBFTTA");
		expect(payload).toContain("5303704");
		expect(payload).toContain("5406118941");
		expect(payload).toContain("0809MA3K7PQ2X");
		expect(payload.slice(-8, -4)).toBe("6304");
		expect(crc16(payload.slice(0, -4))).toBe(payload.slice(-4));
	});

	it("keeps memos to plain ASCII", () => {
		expect(safeMemo("Đơn hàng #MA3K7PQ2X")).toBe("Don hang MA3K7PQ2X");
	});
});

describe("crypto", () => {
	it("compares in constant time", () => {
		expect(safeEqual("abc", "abc")).toBe(true);
		expect(safeEqual("abc", "abd")).toBe(false);
		expect(safeEqual("ABC", "abc", true)).toBe(true);
		expect(safeEqual("abc", "abcd")).toBe(false);
	});
});

describe("catalog helpers", () => {
	it("searches without diacritics", () => {
		expect(fold("Móc khoá Đẹp")).toBe("moc khoa dep");
		const keychain = product({ id: "p2", title: "Móc khoá acrylic Frieren", tags: ["keychain"] });
		expect(search([product(), keychain], "moc khoa").map((p) => p.id)).toEqual(["p2"]);
	});

	it("reads the upload time from a TikTok video id", () => {
		expect(videoUploadedAt("7549993146407472404").startsWith("2025-")).toBe(true);
	});

	it("computes the discount from a real list price only", () => {
		expect(percentOff(88941, 105882)).toBe(16);
		expect(percentOff(88941, undefined)).toBeUndefined();
		expect(percentOff(100, 90)).toBeUndefined();
	});
});

describe("settings", () => {
	it("offers COD, plus VietQR once the BIDV account is set, and nothing else", () => {
		expect(enabledPaymentMethods(s)).toEqual(["cod"]);
		const full = settings({
			...env,
			BANK_ACCOUNT_NO: "1234567890",
			BANK_ACCOUNT_NAME: "NGUYEN VAN A",
			// Leftover keys of the removed wallet and card gateways must not bring them back.
			MOMO_PARTNER_CODE: "x",
			ZALOPAY_APP_ID: "1",
			VNPAY_TMN_CODE: "x",
		} as unknown as Env);
		expect(enabledPaymentMethods(full)).toEqual(["cod", "vietqr"]);
		expect(full.bank).toEqual({ bin: "970418", name: "BIDV", accountNo: "1234567890", accountName: "NGUYEN VAN A" });
	});
});

describe("www redirect", () => {
	const site = "https://anitoymall.com";
	it("sends www page requests to the same path on the bare domain", () => {
		expect(wwwRedirect(new URL("https://www.anitoymall.com/san-pham?sort=bestselling"), site, "GET")).toBe(
			"https://anitoymall.com/san-pham?sort=bestselling",
		);
	});

	it("leaves the bare domain, other hosts, POSTs and an unset SITE_URL alone", () => {
		expect(wwwRedirect(new URL("https://anitoymall.com/"), site, "GET")).toBeNull();
		expect(wwwRedirect(new URL("https://anitoy-mall.example.workers.dev/"), site, "GET")).toBeNull();
		expect(wwwRedirect(new URL("https://www.anitoymall.com/api/webhooks/sepay"), site, "POST")).toBeNull();
		expect(wwwRedirect(new URL("https://www.anitoymall.com/api/orders/MA3K7PQ2X/status?t=x"), site, "GET")).toBeNull();
		expect(wwwRedirect(new URL("http://localhost:5173/"), "", "GET")).toBeNull();
	});
});

describe("SEO", () => {
	it("escapes XML and drops invalid characters", () => {
		expect(escapeXml(`a & <b> "c"\u0001`)).toBe("a &amp; &lt;b&gt; &quot;c&quot;");
	});

	it("lists one feed item per priced SKU, sold-out ones as out_of_stock", () => {
		const p = product({
			skus: [
				{ id: "s1", productId: "p1", name: "Frieren", price: 80000, stock: 5, position: 0 },
				{ id: "s2", productId: "p1", name: "Fern", price: 80000, stock: 0, position: 1 },
				{ id: "s3", productId: "p1", name: "Draft", price: 0, stock: 3, position: 2 },
			],
		});
		const xml = googleFeed(s, [p, product({ id: "hidden", status: "draft" })]);
		expect(xml.match(/<item>/g)).toHaveLength(2);
		expect(xml).toContain("<g:availability>out_of_stock</g:availability>");
		expect(xml).toContain("<g:price>80000 VND</g:price>");
		expect(xml).toContain("<g:item_group_id>p1</g:item_group_id>");
		expect(xml).toContain("https://shop.example.vn/san-pham/mo-hinh-test?sku=s2");
	});

	it("describes variants as a ProductGroup with offers, shipping and returns", () => {
		const p = product({
			skus: [
				{ id: "s1", productId: "p1", name: "Frieren", price: 80000, stock: 5, position: 0 },
				{ id: "s2", productId: "p1", name: "Fern", price: 80000, stock: 0, position: 1 },
			],
		});
		const ld = productJsonLd(s, p) as { "@type": string; hasVariant: { offers: { availability: string; shippingDetails: unknown; hasMerchantReturnPolicy: unknown } }[] };
		expect(ld["@type"]).toBe("ProductGroup");
		expect(ld.hasVariant[1]?.offers.availability).toBe("https://schema.org/OutOfStock");
		expect(ld.hasVariant[0]?.offers.shippingDetails).toBeDefined();
		expect(ld.hasVariant[0]?.offers.hasMerchantReturnPolicy).toBeDefined();
	});
});
