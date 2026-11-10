import { afterAll, describe, expect, it } from "vitest";
import worker from "./index";
import { createTestD1 } from "./lib/testing/d1-sqlite.mjs";

// Buyer reviews through the real Hono app: from a delivered order to the product page, and review
// moderation in /admin. Fake data only.

const db = createTestD1();
afterAll(() => db.close());

const env = {
	DB: db,
	ADMIN_PASSWORD: "test-admin-pass",
	SHIPPING_FEE: "30000",
	FREE_SHIPPING_THRESHOLD: "150000",
} as unknown as Env;
const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined, props: {} } as unknown as ExecutionContext;
const ORIGIN = "http://localhost";
const admin = { Authorization: `Basic ${btoa("admin:test-admin-pass")}`, Origin: ORIGIN, "content-type": "application/json" };

const call = (path: string, init: RequestInit = {}) => worker.fetch(new Request(`${ORIGIN}${path}`, init), env, ctx);
const post = (path: string, body: unknown, headers: Record<string, string> = { "content-type": "application/json" }) =>
	call(path, { method: "POST", headers, body: JSON.stringify(body) });

const PRODUCT = "tt-1732681072582362252";
const SLUG = "mo-hinh-neko-kinako-ao-trum-tim-10cm";

describe("buyer reviews through the app", () => {
	let orderId = "";
	let token = "";
	let reviewId = "";

	it("a delivered order's page asks for a review, and the review is saved", async () => {
		const placed = await post("/api/orders", {
			items: [{ productId: PRODUCT, skuId: "tt-1732680979138577548", quantity: 1 }],
			customer: { name: "Nguyen Van A", phone: "0900000000" },
			address: { province: "Thành phố Hà Nội", ward: "Phường Hoàn Kiếm", street: "1 Phố Thử" },
			paymentMethod: "cod",
		});
		expect(placed.status).toBe(201);
		const { id, url } = (await placed.json()) as { id: string; url: string };
		orderId = id;
		token = new URL(url, ORIGIN).searchParams.get("t")!;

		expect(await (await call(`/don-hang/${orderId}?t=${encodeURIComponent(token)}`)).text()).not.toContain("data-review-form");
		expect((await post(`/api/orders/${orderId}/reviews`, { t: token, productId: PRODUCT, rating: 5 })).status).toBe(409);

		let version = 1;
		for (const action of ["confirm", "ship", "deliver"]) {
			const res = await post(`/api/admin/orders/${orderId}`, { action, version }, admin);
			expect(res.status).toBe(200);
			version = ((await res.json()) as { version: number }).version;
		}
		const page = await call(`/don-hang/${orderId}?t=${encodeURIComponent(token)}`);
		expect(page.headers.get("Cache-Control")).toBe("no-store");
		const html = await page.text();
		expect(html).toContain("data-review-form");
		expect(html).toContain(`data-product-id="${PRODUCT}"`);

		expect((await post(`/api/orders/${orderId}/reviews`, { t: "wrong-token-123", productId: PRODUCT, rating: 5 })).status).toBe(404);
		const saved = await post(`/api/orders/${orderId}/reviews`, { t: token, productId: PRODUCT, rating: 4, comment: "Xinh <b>lắm</b>", lang: "vi" });
		expect(saved.status).toBe(200);
		expect(saved.headers.get("Cache-Control")).toBe("no-store");
	});

	it("waits for approval in /admin, then shows on the product page with the combined rating", async () => {
		expect((await call("/admin/danh-gia")).status).toBe(401);
		const list = await (await call("/admin/danh-gia", { headers: { Authorization: admin.Authorization } })).text();
		expect(list).toContain("A. N.");
		expect(list).not.toContain("Nguyen Van A");
		reviewId = list.match(/data-review-id="(rv_[^"]+)"/)![1]!;
		const seen = list.match(/data-review-updated="([^"]+)"/)![1]!;

		expect(await (await call(`/san-pham/${SLUG}`)).text()).not.toContain('id="reviews"');
		expect((await post(`/api/admin/reviews/${reviewId}`, { status: "approved" }, admin)).status).toBe(400);
		expect((await post(`/api/admin/reviews/${reviewId}`, { status: "approved", seen }, { ...admin, Origin: "https://evil.example" })).status).toBe(403);
		expect((await post(`/api/admin/reviews/${reviewId}`, { status: "approved", seen: "2000-01-01T00:00:00.000Z" }, admin)).status).toBe(409);
		expect((await post(`/api/admin/reviews/${reviewId}`, { status: "approved", seen }, admin)).status).toBe(200);

		const html = await (await call(`/san-pham/${SLUG}`)).text();
		expect(html).toContain('id="reviews"');
		expect(html).toContain("A. N.");
		// Plain text: the comment's markup is escaped, never rendered.
		expect(html).toContain("Xinh &lt;b&gt;lắm&lt;/b&gt;");
		// TikTok's 9 ratings of 5.0 and this website's 4 stars: (9 × 5 + 4) / 10 = 4.9.
		expect(html).toContain("(10 đánh giá trên TikTok Shop và website)");
		expect(html).toContain("TikTok Shop: 5.0 ★ (9) · Website: 4.0 ★ (1)");
		expect(html).toMatch(/"aggregateRating":\{"@type":"AggregateRating","ratingValue":4,"reviewCount":1/);
		const moved = await call(`/en/products/${SLUG}`);
		const en = moved.status === 301 ? await call(new URL(moved.headers.get("Location")!, ORIGIN).pathname) : moved;
		expect(await en.text()).toContain("(10 ratings on TikTok Shop and this website)");
	});
});
