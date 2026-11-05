import { afterEach, describe, expect, it } from "vitest";
import { settings } from "./config";
import { cancelOrder, ConflictError, getOrder, invalidateCatalog, migrateDb, OutOfStockError, placeOrder } from "./db";
import { applyOrderAction, CheckoutError, createOrder, expireOrders, getOrderForViewer, lookupOrder, MAX_OPEN_ORDERS_PER_PHONE, recordPayment } from "./orders";
import { handleBankTransaction } from "./payments";
import { createTestD1 } from "./testing/d1-sqlite.mjs";
import type { Order } from "./types";

// Order invariants against a real SQLite database with D1 semantics (batches are transactions,
// CHECK (stock >= 0) aborts an oversell). Fixtures use obviously fake customer data.

const s = settings({ BANK_ACCOUNT_NO: "1234567890", BANK_ACCOUNT_NAME: "NGUYEN VAN A", SEPAY_API_KEY: "test-key" } as unknown as Env);
const NOW = new Date("2026-11-03T03:00:00.000Z");
const PRICE = 50000;

const dbs: ReturnType<typeof createTestD1>[] = [];
afterEach(() => {
	while (dbs.length) dbs.pop()!.close();
});

async function freshDb(stock = 2) {
	const db = createTestD1();
	dbs.push(db);
	await migrateDb(db);
	const content = { title: "Mô hình test", description: "", images: [], collection: "frieren", category: "mini", tags: [], attributes: [], videoIds: [] };
	await db.batch([
		db
			.prepare("INSERT INTO products (id, slug, status, featured, data, created_at, updated_at) VALUES ('test-p', 'test-p', 'active', 0, ?1, ?2, ?2)")
			.bind(JSON.stringify(content), NOW.toISOString()),
		db.prepare("INSERT INTO skus (id, product_id, name, price, stock, position) VALUES ('test-s', 'test-p', 'Frieren', ?1, ?2, 0)").bind(PRICE, stock),
	]);
	invalidateCatalog();
	return db;
}

const stockOf = async (db: D1Database) => (await db.prepare("SELECT stock FROM skus WHERE id = 'test-s'").first<{ stock: number }>())!.stock;

const checkout = (over: Record<string, unknown> = {}) => ({
	items: [{ productId: "test-p", skuId: "test-s", quantity: 1 }],
	customer: { name: "Nguyen Van A", phone: "0900000000" },
	address: { province: "Thành phố Hà Nội", ward: "Phường Hoàn Kiếm", street: "1 Phố Thử" },
	paymentMethod: "cod",
	...over,
});

const place = (db: D1Database, over: Record<string, unknown> = {}) => createOrder(db, s, checkout(over), { ipHash: null, now: NOW });

describe("placing orders", () => {
	it("charges the server price and takes stock in the same transaction", async () => {
		const db = await freshDb();
		const order = await place(db, { items: [{ productId: "test-p", skuId: "test-s", quantity: 1 }] });
		expect(order.subtotal).toBe(PRICE);
		expect(order.shippingFee).toBe(s.shipping.fee);
		expect(order.total).toBe(PRICE + s.shipping.fee);
		expect(await stockOf(db)).toBe(1);
		expect(order.expiresAt).toBe(new Date(NOW.getTime() + s.ttl.cod * 60_000).toISOString());
	});

	it("rejects a cart whose price the client changed", async () => {
		const db = await freshDb();
		await expect(place(db, { items: [{ productId: "test-p", skuId: "test-s", quantity: 1, price: 1 }] })).rejects.toMatchObject({ code: "quote_changed" });
		expect(await stockOf(db)).toBe(2);
	});

	it("never oversells", async () => {
		const db = await freshDb(2);
		await place(db, { items: [{ productId: "test-p", skuId: "test-s", quantity: 2 }] });
		expect(await stockOf(db)).toBe(0);
		await expect(place(db, { customer: { name: "Nguyen Van B", phone: "0911111111" } })).rejects.toMatchObject({ code: "quote_changed" });
		expect(await stockOf(db)).toBe(0);
	});

	it("rolls the whole order back when stock runs out between quote and placement", async () => {
		const db = await freshDb(1);
		const order = await place(db);
		const clash: Order = { ...order, id: "MA2222222", lines: order.lines.map((l) => ({ ...l, quantity: 5 })) };
		await expect(placeOrder(db, clash, null)).rejects.toBeInstanceOf(OutOfStockError);
		expect(await getOrder(db, "MA2222222")).toBeNull();
		expect(await stockOf(db)).toBe(0);
	});

	it("caps open orders per phone number", async () => {
		const db = await freshDb(10);
		for (let i = 0; i < MAX_OPEN_ORDERS_PER_PHONE; i++) await place(db);
		await expect(place(db)).rejects.toMatchObject({ code: "too_many_orders" });
		expect(await stockOf(db)).toBe(10 - MAX_OPEN_ORDERS_PER_PHONE);
	});

	it("rejects bots that fill the honeypot", async () => {
		const db = await freshDb();
		await expect(place(db, { website: "http://spam.example" })).rejects.toBeInstanceOf(CheckoutError);
		expect(await stockOf(db)).toBe(2);
	});

	it("only takes COD and VietQR, and VietQR only once the bank account is set", async () => {
		const db = await freshDb(5);
		for (const paymentMethod of ["momo", "zalopay", "card"]) {
			await expect(place(db, { paymentMethod })).rejects.toMatchObject({ code: "invalid", details: { fields: ["paymentMethod"] } });
		}
		const noBank = settings({} as unknown as Env);
		await expect(createOrder(db, noBank, checkout({ paymentMethod: "vietqr" }), { ipHash: null, now: NOW })).rejects.toMatchObject({
			code: "invalid",
			details: { fields: ["paymentMethod"] },
		});
		expect(await stockOf(db)).toBe(5);
		expect((await place(db, { paymentMethod: "vietqr" })).expiresAt).toBe(new Date(NOW.getTime() + s.ttl.bank * 60_000).toISOString());
	});
});

describe("cancelling and expiry", () => {
	it("returns stock exactly once, even when a stale cancel is retried", async () => {
		const db = await freshDb(2);
		const order = await place(db);
		const next: Order = { ...order, status: "cancelled", history: [...order.history, { status: "cancelled", at: NOW.toISOString() }] };
		await cancelOrder(db, order, next);
		expect(await stockOf(db)).toBe(2);
		await expect(cancelOrder(db, order, next)).rejects.toBeInstanceOf(ConflictError);
		expect(await stockOf(db)).toBe(2);
	});

	it("refuses a seller action based on a stale version", async () => {
		const db = await freshDb();
		const order = await place(db);
		await applyOrderAction(db, order.id, "confirm", order.version);
		await expect(applyOrderAction(db, order.id, "cancel", order.version)).rejects.toBeInstanceOf(ConflictError);
		expect((await getOrder(db, order.id))?.status).toBe("confirmed");
	});

	it("expires only unpaid, unconfirmed orders past their deadline and releases their stock", async () => {
		const db = await freshDb(10);
		const waiting = await place(db);
		const confirmed = await place(db);
		await applyOrderAction(db, confirmed.id, "confirm");
		const paid = await place(db, { paymentMethod: "vietqr" });
		await recordPayment(db, paid.id, { provider: "bank", ref: "test", amount: paid.total });
		expect(await stockOf(db)).toBe(7);

		expect(await expireOrders(db, new Date(NOW.getTime() + 60_000))).toEqual([]); // nothing due yet
		const expired = await expireOrders(db, new Date(NOW.getTime() + 2 * 86_400_000));
		expect(expired).toEqual([waiting.id]);
		expect(await stockOf(db)).toBe(8);

		const after = await getOrder(db, waiting.id);
		expect(after?.status).toBe("cancelled");
		expect(after?.expiresAt).toBeUndefined();
		expect(after?.history.map((h) => h.status)).toEqual(["pending", "expired"]);
		expect((await getOrder(db, confirmed.id))?.status).toBe("confirmed");
		expect((await getOrder(db, paid.id))?.paymentStatus).toBe("paid");

		// A second run finds nothing and restocks nothing.
		expect(await expireOrders(db, new Date(NOW.getTime() + 3 * 86_400_000))).toEqual([]);
		expect(await stockOf(db)).toBe(8);
	});
});

describe("payments", () => {
	it("marks an order paid only for the exact amount, once", async () => {
		const db = await freshDb();
		const order = await place(db, { paymentMethod: "vietqr" });
		expect((await recordPayment(db, order.id, { provider: "bank", ref: "t1", amount: order.total - 1 })).result).toBe("amount_mismatch");
		expect((await getOrder(db, order.id))?.paymentStatus).toBe("unpaid");
		expect((await recordPayment(db, order.id, { provider: "bank", ref: "t2", amount: order.total })).result).toBe("paid");
		expect((await recordPayment(db, order.id, { provider: "bank", ref: "t2", amount: order.total })).result).toBe("already_paid");
		const paid = await getOrder(db, order.id);
		expect(paid?.expiresAt).toBeUndefined();
		expect(paid?.history.filter((h) => h.status === "paid")).toHaveLength(1);
	});

	it("matches bank transfers by memo, account and amount, once per transaction", async () => {
		const db = await freshDb();
		const order = await place(db, { paymentMethod: "vietqr" });
		const tx = { id: 1001, accountNumber: "1234567890", content: `CT ${order.id} chuyen tien`, transferType: "in" as const, transferAmount: order.total };
		expect(await handleBankTransaction(db, s, { ...tx, accountNumber: "9999999999" })).toBe("other_account");
		expect(await handleBankTransaction(db, s, { ...tx, accountNumber: undefined })).toBe("other_account");
		expect(await handleBankTransaction(db, settings({} as unknown as Env), tx)).toBe("other_account");
		expect((await getOrder(db, order.id))?.paymentStatus).toBe("unpaid");
		expect(await handleBankTransaction(db, s, { ...tx, transferType: "out" })).toBe("ignored");
		expect(await handleBankTransaction(db, s, tx)).toBe("paid");
		expect(await handleBankTransaction(db, s, tx)).toBe("duplicate");
		expect((await getOrder(db, order.id))?.paymentStatus).toBe("paid");
	});

	it("lets the seller confirm a VietQR transfer by hand, which stops expiry", async () => {
		const db = await freshDb();
		const order = await place(db, { paymentMethod: "vietqr" });
		const paid = await applyOrderAction(db, order.id, "mark_paid", order.version);
		expect(paid.paymentStatus).toBe("paid");
		expect(paid.payment).toMatchObject({ provider: "bank", ref: "manual" });
		expect((await getOrder(db, order.id))?.expiresAt).toBeUndefined();
		await expect(applyOrderAction(db, order.id, "mark_paid")).rejects.toBeInstanceOf(ConflictError);
	});

	it("marks COD paid only on delivery, never by hand before", async () => {
		const db = await freshDb();
		const order = await place(db);
		await expect(applyOrderAction(db, order.id, "mark_paid")).rejects.toBeInstanceOf(ConflictError);
		await applyOrderAction(db, order.id, "confirm");
		const shipped = await applyOrderAction(db, order.id, "ship");
		expect(shipped.paymentStatus).toBe("unpaid");
		const delivered = await applyOrderAction(db, order.id, "deliver");
		expect(delivered.paymentStatus).toBe("paid");
		expect(delivered.payment).toMatchObject({ provider: "cod", ref: "delivery" });
		expect(delivered.history.map((h) => h.status)).toEqual(["pending", "confirmed", "shipped", "delivered", "paid"]);
	});
});

describe("customer data", () => {
	it("needs the access token to view an order", async () => {
		const db = await freshDb();
		const order = await place(db);
		expect(await getOrderForViewer(db, order.id, "wrong-token")).toBeNull();
		expect(await getOrderForViewer(db, order.id, undefined)).toBeNull();
		expect((await getOrderForViewer(db, order.id, order.accessToken))?.id).toBe(order.id);
	});

	it("lookup needs the right phone and returns masked details only", async () => {
		const db = await freshDb();
		const order = await place(db);
		expect(await lookupOrder(db, order.id, "0911111111")).toBeNull();
		const found = await lookupOrder(db, order.id.slice(2), "+84 900 000 000");
		expect(found?.customer).toEqual({ name: "Ng***", phone: "090****000" });
		const json = JSON.stringify(found);
		for (const secret of [order.accessToken, "Phố Thử", "Hoàn Kiếm", "Nguyen Van A", "0900000000"]) expect(json).not.toContain(secret);
	});
});
