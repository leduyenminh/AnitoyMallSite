import { describe, expect, it } from "vitest";
import catalogFile from "../data/catalog.json";
import { Document } from "../views/layout";
import { text } from "../views/text";
import { search } from "./catalog";
import { settings } from "./config";
import { langOf, listingParams, routes, translateQuery } from "./i18n";
import { formatCount, formatShortVnd, formatVnd } from "./money";
import { buildQuote, type QuoteLine } from "./quote";
import { lookupSchema, quoteSchema } from "./validation";
import { googleFeed, metaDescription, productJsonLd, productPath, sitemapXml, storeJsonLd } from "./seo";
import { englishSlug, englishText, localizeLines, localizeProduct, sourceHash, translationFile } from "./translations";
import type { Product } from "./types";

const s = settings({ SITE_URL: "https://shop.example.vn" } as unknown as Env);
const catalog = (catalogFile as unknown as { products: Product[] }).products;
/** A real product from the catalog, live and priced, as the English pages would show it. */
const real = (id: string): Product => {
	const p = catalog.find((x) => x.id === id)!;
	return { ...p, status: "active", skus: p.skus.map((k, i) => ({ ...k, price: 80000 + i * 1000, stock: 3 })) };
};
const KEYCHAIN = "tt-1731406172224063628";
const NEKO = "tt-1731739548394554508";

describe("languages and paths", () => {
	it("treats everything under /en as English", () => {
		expect(langOf("/en")).toBe("en");
		expect(langOf("/en/products/x")).toBe("en");
		expect(langOf("/")).toBe("vi");
		expect(langOf("/san-pham")).toBe("vi");
		expect(langOf("/english")).toBe("vi");
	});

	it("maps listing filters between the two languages' parameter names", () => {
		const vi = new URLSearchParams({ q: "frieren", bst: "frieren", "con-hang": "1", "gia-tu": "50000", trang: "2", sort: "newest", utm_source: "x" });
		expect(translateQuery(vi, "vi", "en")).toBe("?q=frieren&collection=frieren&in-stock=1&min-price=50000&page=2&sort=newest");
		const en = new URLSearchParams(translateQuery(vi, "vi", "en").slice(1));
		expect(new URLSearchParams(translateQuery(en, "en", "vi").slice(1)).get(listingParams.vi.page)).toBe("2");
		expect(translateQuery(new URLSearchParams(), "vi", "en")).toBe("");
	});

	it("matches the literal paths src/index.tsx registers for private pages", () => {
		expect([routes.vi.cart, routes.vi.checkout, routes.vi.order]).toEqual(["/gio-hang", "/thanh-toan", "/don-hang"]);
		expect([routes.en.cart, routes.en.checkout, routes.en.order]).toEqual(["/en/cart", "/en/checkout", "/en/orders"]);
	});

	it("accepts only vi or en as the language of a quote or lookup", () => {
		const items = [{ productId: "p1", skuId: "s1", quantity: 1 }];
		expect(quoteSchema.safeParse({ items, lang: "en" }).success).toBe(true);
		expect(quoteSchema.safeParse({ items }).success).toBe(true);
		expect(quoteSchema.safeParse({ items, lang: "fr" }).success).toBe(false);
		expect(lookupSchema.safeParse({ code: "MA3K7PQ2X", phone: "0900000000", lang: "EN" }).success).toBe(false);
	});

	it("keeps Vietnamese paths and gives products English slugs under /en", () => {
		const p = real(KEYCHAIN);
		expect(productPath(p)).toBe(`/san-pham/${p.slug}`);
		expect(productPath(p, "en")).toBe("/en/products/frieren-fern-himmel-acrylic-keychain");
		expect(productPath({ id: "unknown", slug: "mo-hinh-x" }, "en")).toBe("/en/products/mo-hinh-x");
	});
});

describe("product translations", () => {
	it("has a current English text for every catalog product (re-check and update `source` after an import)", () => {
		const stale = catalog
			.filter((p) => translationFile.products[p.id]?.source !== sourceHash(p))
			.map((p) => `${p.id} (source should be ${sourceHash(p)} once the English text is checked)`);
		expect(stale).toEqual([]);
	});

	it("uses unique, URL-safe English slugs that no other product uses", () => {
		const slugs = Object.values(translationFile.products).map((t) => t.slug);
		expect(new Set(slugs).size).toBe(slugs.length);
		for (const slug of slugs) expect(slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
		for (const [id, t] of Object.entries(translationFile.products)) {
			expect(catalog.some((p) => p.id !== id && p.slug === t.slug)).toBe(false);
		}
		expect(Object.keys(translationFile.products).every((id) => catalog.some((p) => p.id === id))).toBe(true);
	});

	it("changes only the text: ids, slug, prices, stock and images stay as stored", () => {
		const p = real(NEKO);
		const en = localizeProduct(p, "en");
		expect(en.title).toMatch(/^ANITOY Osakana Neko Figure/);
		expect(en.skus.map((k) => k.name)).toEqual(["Default"]);
		expect(en.attributes.find((a) => a.name === "Country of origin")?.value).toBe("Mainland China");
		const strip = (x: Product) => ({ ...x, title: "", description: "", attributes: [], skus: x.skus.map((k) => ({ ...k, name: "" })) });
		expect(strip(en)).toEqual(strip(p));
		expect(localizeProduct(p, "vi")).toBe(p);
	});

	it("falls back to Vietnamese when the Vietnamese text changed after translating", () => {
		const p = { ...real(KEYCHAIN), title: "Móc khoá mới" };
		expect(englishText(p)).toBeUndefined();
		expect(localizeProduct(p, "en").title).toBe("Móc khoá mới");
		expect(englishSlug(p)).toBe("frieren-fern-himmel-acrylic-keychain");
		// Wording the glossary doesn't know stays as it is.
		expect(localizeProduct({ ...p, skus: [{ ...p.skus[0]!, name: "Mẫu mới" }] }, "en").skus[0]?.name).toBe("Mẫu mới");
	});

	it("translates order and cart lines without touching amounts, keeping a title recorded before a rename", () => {
		const p = real(NEKO);
		const line = { slug: p.slug, title: p.title, skuName: "Mặc định", quantity: 2, lineTotal: 160000 };
		const [en] = localizeLines([line, { ...line, title: "Tên cũ" }], [p], "en");
		expect(en).toEqual({ ...line, title: englishText(p)!.title, skuName: "Default", slug: englishSlug(p) });
		expect(localizeLines([{ ...line, title: "Tên cũ" }], [p], "en")[0]?.title).toBe("Tên cũ");
		expect(localizeLines([line], [p], "vi")[0]).toBe(line);
	});

	it("leaves every amount of a quote unchanged in English", () => {
		const products = [real(KEYCHAIN), real(NEKO)];
		const quote = buildQuote(
			[
				{ productId: KEYCHAIN, skuId: products[0]!.skus[1]!.id, quantity: 2, price: 1 },
				{ productId: NEKO, skuId: products[1]!.skus[0]!.id, quantity: 1 },
			],
			products,
			{ fee: 30000, freeThreshold: 150000 },
		);
		const lines = localizeLines(quote.lines, products, "en");
		const amounts = (l: QuoteLine) => ({ ...l, title: "", skuName: "", slug: "" });
		expect(lines.map(amounts)).toEqual(quote.lines.map(amounts));
		expect(lines.map((l) => l.slug)).toEqual(products.map(englishSlug));
		expect(quote.lines[0]?.issue).toBe("price_changed");
	});

	it("finds products by their English words too", () => {
		expect(search([real(KEYCHAIN), real(NEKO)], "keychain").map((p) => p.id)).toEqual([KEYCHAIN]);
		expect(search([real(KEYCHAIN), real(NEKO)], "moc khoa").map((p) => p.id)).toEqual([KEYCHAIN]);
	});
});

describe("English money and counts", () => {
	it("formats the same integer đồng with English grouping", () => {
		expect(formatVnd(150000, "en")).toBe("₫150,000");
		expect(formatVnd(150000)).toMatch(/^150\.000\s₫$/);
		expect(formatShortVnd(150000, "en")).toBe("₫150K");
		expect(formatShortVnd(1_250_000)).toBe("1,3M");
		expect(formatShortVnd(1_250_000, "en")).toBe("₫1.3M");
		expect(formatCount(199_400, "en")).toBe("199.4K");
		expect(formatCount(199_400)).toBe("199,4K");
	});
});

describe("English SEO", () => {
	it("lists the English feed with English text and links, and the same ids, prices, stock and shipping", () => {
		const p = real(KEYCHAIN);
		const vi = googleFeed(s, [p]);
		const en = googleFeed(s, [p], "en");
		const field = (xml: string, tag: string) => [...xml.matchAll(new RegExp(`<g:${tag}>([^<]*)</g:${tag}>`, "g"))].map((m) => m[1]);
		for (const tag of ["id", "item_group_id", "price", "availability", "image_link"]) expect(field(en, tag)).toEqual(field(vi, tag));
		expect(field(en, "price")[0]).toBe("80000 VND");
		expect(en).toContain("<g:shipping><g:country>VN</g:country>");
		expect(en).toContain(`https://shop.example.vn/en/products/frieren-fern-himmel-acrylic-keychain?sku=${p.skus[0]!.id}`);
		expect(field(en, "title")[0]).toMatch(/^Anitoy Premium Acrylic Keychain/);
		expect(field(en, "product_type")[0]).toBe("Keychains &amp; accessories &gt; Frieren");
		expect(vi).toContain(`https://shop.example.vn/san-pham/${p.slug}?sku=`);
	});

	it("describes the English product page with English names, English URLs and VND prices", () => {
		const p = real(NEKO);
		const ld = productJsonLd(s, p, "en") as { name: string; url: string; offers: { url: string; price: number; priceCurrency: string; shippingDetails: { shippingDestination: { addressCountry: string } } } };
		expect(ld.name).toBe(englishText(p)!.title);
		expect(ld.url).toBe(`https://shop.example.vn${productPath(p, "en")}`);
		expect(ld.offers).toMatchObject({ price: 80000, priceCurrency: "VND", url: ld.url });
		expect(ld.offers.shippingDetails.shippingDestination.addressCountry).toBe("VN");
		expect(JSON.stringify(ld)).not.toContain("aggregateRating");
		expect(metaDescription(p, "en")).toMatch(/ Price ₫80,000\.$/);
		const [, website] = storeJsonLd(s, "en") as [unknown, { inLanguage: string; url: string; potentialAction: { target: { urlTemplate: string } } }];
		expect(website).toMatchObject({ inLanguage: "en", url: "https://shop.example.vn/en" });
		expect(website.potentialAction.target.urlTemplate).toBe("https://shop.example.vn/en/search?q={search_term_string}");
	});

	it("lists hreflang alternates in the sitemap, with x-default on English", () => {
		const xml = sitemapXml(s, [{ path: "/en/products", alternates: { vi: "/san-pham", en: "/en/products" } }]);
		expect(xml).toContain("<loc>https://shop.example.vn/en/products</loc>");
		expect(xml).toContain('<xhtml:link rel="alternate" hreflang="vi" href="https://shop.example.vn/san-pham"/>');
		expect(xml).toContain('<xhtml:link rel="alternate" hreflang="en" href="https://shop.example.vn/en/products"/>');
		expect(xml).toContain('<xhtml:link rel="alternate" hreflang="x-default" href="https://shop.example.vn/en/products"/>');
	});

	it("marks up pages with their language and hreflang links, but none on pages that are not indexed", async () => {
		const ctx = { s, lang: "en" as const, path: "/en/products", build: "t", alt: "/san-pham" };
		const indexed = await Document({ ctx, meta: { title: "x", canonical: "/en/products", alternates: { vi: "/san-pham", en: "/en/products" } }, children: "" }).toString();
		expect(indexed).toContain('<html lang="en">');
		expect(indexed).toContain('<link rel="alternate" hreflang="vi" href="https://shop.example.vn/san-pham"');
		expect(indexed).toContain('<link rel="alternate" hreflang="x-default" href="https://shop.example.vn/en/products"');
		expect(indexed).toContain('href="/san-pham" hreflang="vi" lang="vi"');
		const cart = await Document({ ctx: { ...ctx, path: "/en/cart", alt: "/gio-hang" }, meta: { title: "x", noindex: true, alternates: { vi: "/gio-hang", en: "/en/cart" } }, children: "" }).toString();
		expect(cart).not.toContain("hreflang=\"x-default\"");
		expect(cart).toContain('href="/gio-hang" hreflang="vi"');
	});
});

describe("English UI text", () => {
	it("has no Vietnamese left in the English strings", () => {
		const strings: string[] = [];
		const walk = (v: unknown, key = ""): void => {
			if (key === "historyNotes") return; // keyed by the Vietnamese notes it translates
			if (typeof v === "string") strings.push(v);
			// Text with values: try both branches of any condition.
			else if (typeof v === "function") for (const arg of [1, 0]) strings.push(String((v as (...a: unknown[]) => unknown)(arg, arg, arg)));
			else if (Array.isArray(v)) v.forEach((x) => walk(x));
			else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, k);
		};
		walk(text.en);
		walk(Object.values(text.en.historyNotes));
		const vietnamese = /[ạảãàáâậầấẩẫăắằặẳẵọõỏôộổỗồốơờớợởỡẹẽêếềệểễụủũưựữửừứịỉĩỳỷỵỹ]/i;
		expect(strings.filter((x) => vietnamese.test(x.replace(/đồng/g, "")))).toEqual([]);
	});
});
