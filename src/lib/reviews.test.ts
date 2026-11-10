import { afterEach, describe, expect, it, vi } from "vitest";
import { combinedRating } from "./catalog";
import { settings } from "./config";
import { catalogVersion, invalidateCatalog, loadCatalog, migrateDb, schemaMigrations } from "./db";
import { applyOrderAction, createOrder } from "./orders";
import { approvedReviews, listReviews, reviewerName, reviewsForOrder, setReviewStatus, submitReview } from "./reviews";
import { productJsonLd } from "./seo";
import { createTestD1 } from "./testing/d1-sqlite.mjs";

// Buyer reviews against a real SQLite database with D1 semantics. Fixtures use obviously fake data.

const s = settings({} as Env);
const NOW = new Date("2026-11-09T03:00:00.000Z");
const LATER = new Date("2026-11-09T04:00:00.000Z");
const EVEN_LATER = new Date("2026-11-09T05:00:00.000Z");

const dbs: ReturnType<typeof createTestD1>[] = [];
afterEach(() => {
	while (dbs.length) dbs.pop()!.close();
});

async function freshDb() {
	const db = createTestD1();
	dbs.push(db);
	await migrateDb(db, s.pricing);
	const content = { title: "Mô hình test", description: "", images: [], collection: "frieren", category: "mini", tags: [], attributes: [], videoIds: [], tiktokRating: { value: 4.9, count: 36 } };
	await db.batch([
		db.prepare("INSERT INTO products (id, slug, status, featured, data, created_at, updated_at) VALUES ('test-p', 'test-p', 'active', 0, ?1, ?2, ?2)").bind(JSON.stringify(content), NOW.toISOString()),
		db.prepare("INSERT INTO skus (id, product_id, name, price, stock, position) VALUES ('test-s', 'test-p', 'Frieren', 50000, 5, 0)"),
	]);
	invalidateCatalog({ sold: true });
	return db;
}

async function order(db: D1Database, delivered = true) {
	const o = await createOrder(
		db,
		s,
		{
			items: [{ productId: "test-p", skuId: "test-s", quantity: 1 }],
			customer: { name: "Nguyen Van A", phone: "0900000000", email: "test@example.com" },
			address: { province: "Thành phố Hà Nội", ward: "Phường Hoàn Kiếm", street: "1 Phố Thử" },
			paymentMethod: "cod",
		},
		{ ipHash: null, now: NOW },
	);
	if (delivered) for (const action of ["confirm", "ship", "deliver"] as const) await applyOrderAction(db, o.id, action);
	return o;
}

const review = (token: string, over: Record<string, unknown> = {}) => ({ t: token, productId: "test-p", rating: 5, comment: "Đẹp, đóng gói kỹ.", lang: "vi", ...over });

const product = async (db: D1Database) => {
	invalidateCatalog();
	return (await loadCatalog(db)).find((p) => p.id === "test-p")!;
};

describe("schema upgrade", () => {
	it("adds the reviews table to a live version-1 database, keeping its rows", async () => {
		const db = createTestD1();
		dbs.push(db);
		await db.prepare("CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)").run();
		await db.batch([...schemaMigrations[0]!.map((sql) => db.prepare(sql)), db.prepare("INSERT INTO meta (k, v) VALUES ('schema', '1')")]);
		await db.batch([
			db.prepare("INSERT INTO products (id, slug, status, featured, data, created_at, updated_at) VALUES ('p1', 'p1', 'active', 0, ?1, '2026-11-01', '2026-11-01')").bind(JSON.stringify({ title: "Cũ" })),
			db.prepare("INSERT INTO skus (id, product_id, name, price, stock, position) VALUES ('s1', 'p1', 'A', 50000, 7, 0)"),
		]);
		await migrateDb(db, s.pricing);
		await migrateDb(db, s.pricing);
		expect(await db.prepare("SELECT v FROM meta WHERE k = 'schema'").first("v")).toBe(String(schemaMigrations.length));
		expect(await db.prepare("SELECT price, stock FROM skus WHERE id = 's1'").first()).toEqual({ price: 50000, stock: 7 });
		expect(await db.prepare("SELECT COUNT(*) AS n FROM reviews").first("n")).toBe(0);
		// Not re-seeded: the shop already has products.
		expect(await db.prepare("SELECT COUNT(*) AS n FROM products").first("n")).toBe(1);
	});
});

describe("reviewer names", () => {
	it.each([
		["Nguyen Van A", "A. N."],
		["Nguyễn Văn An", "A. N."],
		["  lê  duyên   minh ", "M. L."],
		["minh", "M."],
		["", ""],
	])("%s → %s", (name, masked) => expect(reviewerName(name)).toBe(masked));
});

describe("combined rating", () => {
	it("weights TikTok Shop's and the website's ratings by their counts", () => {
		const r = combinedRating({ tiktokRating: { value: 4.9, count: 36 }, siteReviews: { count: 3, sum: 15 } })!;
		expect(r.count).toBe(39);
		expect(r.value).toBeCloseTo((4.9 * 36 + 15) / 39, 10);
		expect(r.tiktok).toEqual({ value: 4.9, count: 36 });
		expect(r.site).toEqual({ value: 5, count: 3 });
	});

	it("shows one side alone, or nothing", () => {
		expect(combinedRating({ tiktokRating: { value: 4.5, count: 4 } })).toEqual({ value: 4.5, count: 4, tiktok: { value: 4.5, count: 4 } });
		expect(combinedRating({ siteReviews: { count: 2, sum: 7 } })).toEqual({ value: 3.5, count: 2, site: { value: 3.5, count: 2 } });
		expect(combinedRating({})).toBeNull();
	});

	it("never credits TikTok Shop with a rating that has no reviews behind it", () => {
		expect(combinedRating({ tiktokRating: { value: 4.9, count: 0 }, siteReviews: { count: 2, sum: 8 } })).toEqual({ value: 4, count: 2, site: { value: 4, count: 2 } });
		expect(combinedRating({ tiktokRating: { value: 4.9, count: 0 } })).toEqual({ value: 4.9, count: 0, tiktok: { value: 4.9, count: 0 } });
	});
});

describe("buyer reviews", () => {
	it("only the buyer of a delivered order can review, with the order's token", async () => {
		const db = await freshDb();
		const pending = await order(db, false);
		expect(await submitReview(db, pending.id, review(pending.accessToken), NOW)).toBe("not_delivered");

		const done = await order(db);
		expect(await submitReview(db, done.id, review("x".repeat(24)), NOW)).toBe("not_found");
		expect(await submitReview(db, "MA2222222", review(done.accessToken), NOW)).toBe("not_found");
		expect(await submitReview(db, done.id, review(done.accessToken, { productId: "other" }), NOW)).toBe("invalid");
		expect(await submitReview(db, done.id, review(done.accessToken, { rating: 6 }), NOW)).toBe("invalid");
		expect(await submitReview(db, done.id, review(done.accessToken, { comment: "x".repeat(1001) }), NOW)).toBe("invalid");
		expect(await submitReview(db, done.id, review(done.accessToken), NOW)).toBe("saved");
	});

	it("stores a masked name only and counts a review once the seller approves it", async () => {
		const db = await freshDb();
		const o = await order(db);
		await submitReview(db, o.id, review(o.accessToken), NOW);

		const stored = JSON.stringify((await db.prepare("SELECT * FROM reviews").all()).results);
		expect(stored).toContain('"author":"A. N."');
		for (const secret of ["Nguyen Van A", "0900000000", "test@example.com", "Phố Thử", o.accessToken]) expect(stored).not.toContain(secret);

		expect((await product(db)).siteReviews).toBeUndefined();
		expect(await approvedReviews(db, "test-p")).toEqual([]);

		const [r] = await listReviews(db, "pending");
		expect(await setReviewStatus(db, r!.id, "approved", r!.updatedAt, LATER)).toBe("updated");
		expect((await product(db)).siteReviews).toEqual({ count: 1, sum: 5 });
		expect(await approvedReviews(db, "test-p")).toEqual([{ id: r!.id, rating: 5, comment: "Đẹp, đóng gói kỹ.", author: "A. N.", lang: "vi", createdAt: NOW.toISOString() }]);
	});

	it("one review per product per order; an edit goes back for approval", async () => {
		const db = await freshDb();
		const o = await order(db);
		await submitReview(db, o.id, review(o.accessToken), NOW);
		const [r] = await reviewsForOrder(db, o.id);
		await setReviewStatus(db, r!.id, "approved", r!.updatedAt, LATER);

		await submitReview(db, o.id, review(o.accessToken, { rating: 3, comment: "Sửa lại" }), EVEN_LATER);
		const mine = await reviewsForOrder(db, o.id);
		expect(mine).toHaveLength(1);
		expect(mine[0]).toMatchObject({ id: r!.id, rating: 3, comment: "Sửa lại", status: "pending" });
		expect((await product(db)).siteReviews).toBeUndefined();

		expect(await setReviewStatus(db, r!.id, "hidden", mine[0]!.updatedAt, EVEN_LATER)).toBe("updated");
		expect(await approvedReviews(db, "test-p")).toEqual([]);
		expect(await setReviewStatus(db, "rv_missing", "approved", NOW.toISOString(), NOW)).toBe("changed");
	});

	it("never publishes a text the seller didn't see: a buyer's edit after she loaded /admin wins", async () => {
		const db = await freshDb();
		const o = await order(db);
		await submitReview(db, o.id, review(o.accessToken, { comment: "Đẹp" }), NOW);
		const [seen] = await listReviews(db, "pending");
		await submitReview(db, o.id, review(o.accessToken, { comment: "Gọi 0900000000" }), LATER);
		expect(await setReviewStatus(db, seen!.id, "approved", seen!.updatedAt, EVEN_LATER)).toBe("changed");
		expect(await approvedReviews(db, "test-p")).toEqual([]);
		expect((await reviewsForOrder(db, o.id))[0]).toMatchObject({ status: "pending", comment: "Gọi 0900000000" });
	});

	it("approving, hiding or editing a published review refreshes cached pages (catalog version)", async () => {
		const db = await freshDb();
		const o = await order(db);
		const version = async (at: Date) => {
			vi.setSystemTime(at);
			return catalogVersion(db);
		};
		vi.useFakeTimers({ toFake: ["Date"] });
		try {
			vi.setSystemTime(NOW);
			await submitReview(db, o.id, review(o.accessToken), NOW);
			const v0 = await version(NOW);
			const [r] = await reviewsForOrder(db, o.id);
			vi.setSystemTime(LATER);
			await setReviewStatus(db, r!.id, "approved", r!.updatedAt, LATER);
			const v1 = await version(LATER);
			expect(v1).not.toBe(v0);
			vi.setSystemTime(EVEN_LATER);
			await submitReview(db, o.id, review(o.accessToken, { rating: 2 }), EVEN_LATER);
			const v2 = await version(EVEN_LATER);
			expect(v2).not.toBe(v1);
			const later = new Date(EVEN_LATER.getTime() + 60_000);
			vi.setSystemTime(later);
			await setReviewStatus(db, r!.id, "hidden", (await reviewsForOrder(db, o.id))[0]!.updatedAt, later);
			expect(await version(later)).not.toBe(v2);
		} finally {
			vi.useRealTimers();
		}
	});

	it("structured data carries the website's own reviews only, without names", async () => {
		const db = await freshDb();
		expect(JSON.stringify(productJsonLd(s, await product(db)))).not.toContain("aggregateRating");

		const o = await order(db);
		await submitReview(db, o.id, review(o.accessToken, { rating: 4 }), NOW);
		const [r] = await reviewsForOrder(db, o.id);
		await setReviewStatus(db, r!.id, "approved", r!.updatedAt, LATER);
		const ld = productJsonLd(s, await product(db)) as { aggregateRating?: unknown };
		expect(ld.aggregateRating).toEqual({ "@type": "AggregateRating", ratingValue: 4, reviewCount: 1, bestRating: 5, worstRating: 1 });
		expect(JSON.stringify(ld)).not.toContain("A. N.");
	});
});
