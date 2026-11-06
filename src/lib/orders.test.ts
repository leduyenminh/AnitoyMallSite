import { afterEach, describe, expect, it } from "vitest";
import { settings } from "./config";
import { unitsSold } from "./catalog";
import { cancelOrder, catalogSource, ConflictError, getOrder, importCatalog, invalidateCatalog, loadCatalog, migrateDb, OutOfStockError, placeOrder } from "./db";
import { sitePrice } from "./pricing";
import { clearShippingCache } from "./shipping";
import {
	applyCarrierEvent,
	applyOrderAction,
	bookGhnShipment,
	type CarrierEvent,
	CheckoutError,
	createOrder,
	expireOrders,
	getOrderForViewer,
	lookupOrder,
	MAX_OPEN_ORDERS_PER_PHONE,
	recordPayment,
} from "./orders";
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
	await migrateDb(db, s.pricing);
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

describe("shipping on orders", () => {
	const ghnSettings = settings({ BANK_ACCOUNT_NO: "1234567890", BANK_ACCOUNT_NAME: "NGUYEN VAN A", GHN_TOKEN: "test-token", GHN_SHOP_ID: "123", SHIP_FROM_PHONE: "0900000000" } as unknown as Env);
	const bookings: Record<string, unknown>[] = [];
	const ghn = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		if (url.endsWith("/shipping-order/create")) bookings.push(JSON.parse(String(init?.body)));
		const data = url.includes("province/all")
			? [{ _id: 1000001, name: "Hồ Chí Minh", extension_names: ["thành phố hồ chí minh"], status: 1 }]
			: url.includes("ward/all-by-province-id")
				? [{ _id: 1, name: "Phường Bến Thành", extension_names: ["ben thanh"], status: 1 }]
				: url.endsWith("/shipping-order/create")
					? { order_code: "LTEST1" }
					: { total_fee: 21000 };
		return new Response(JSON.stringify({ code: 200, data }));
	}) as typeof fetch;
	const hcm = (over: Record<string, unknown> = {}) =>
		createOrder(db0!, ghnSettings, checkout({ address: { province: "Thành phố Hồ Chí Minh", ward: "ben thanh", street: "1 Đường Thử" }, ...over }), { ipHash: null, now: NOW, fetch: ghn });
	let db0: D1Database | null = null;
	afterEach(() => {
		clearShippingCache();
		db0 = null;
	});

	it("charges GHN's fee inside HCM and keeps GHN's spelling of the ward", async () => {
		db0 = await freshDb();
		const order = await hcm({ shippingFee: 21000 });
		expect(order).toMatchObject({ shippingFee: 21000, total: PRICE + 21000, address: { ward: "Phường Bến Thành" } });
	});

	it("stops when the fee changed since the shopper saw it, or the ward is unknown", async () => {
		db0 = await freshDb();
		await expect(hcm({ shippingFee: 15000 })).rejects.toMatchObject({ code: "quote_changed" });
		await expect(hcm({ address: { province: "Thành phố Hồ Chí Minh", ward: "Phường Không Có", street: "1 Đường Thử" } })).rejects.toMatchObject({
			code: "invalid",
			details: { fields: ["address.ward"] },
		});
		expect(await stockOf(db0)).toBe(2);
	});

	it("books a confirmed COD order with GHN once, collecting the order total", async () => {
		db0 = await freshDb();
		bookings.length = 0;
		const order = await hcm();
		await expect(bookGhnShipment(db0, ghnSettings, order.id, undefined, ghn)).rejects.toBeInstanceOf(ConflictError); // not confirmed yet
		await applyOrderAction(db0, order.id, "confirm");
		const booked = await bookGhnShipment(db0, ghnSettings, order.id, undefined, ghn);
		expect(booked.shipment).toMatchObject({ carrier: "ghn", code: "LTEST1", status: "ready_to_pick" });
		expect(bookings).toHaveLength(1);
		expect(bookings[0]).toMatchObject({
			client_order_code: order.id,
			cod_amount: order.total,
			to_name: "Nguyen Van A",
			to_phone: "0900000000",
			to_ward_name: "Phường Bến Thành",
			to_province_name: "Hồ Chí Minh",
			is_new_to_address: true,
			payment_type_id: 1,
		});
		await expect(bookGhnShipment(db0, ghnSettings, order.id, undefined, ghn)).rejects.toBeInstanceOf(ConflictError);
		expect(bookings).toHaveLength(1);
		// GHN still carries it: cancelling here would put the goods back on sale.
		await expect(applyOrderAction(db0, order.id, "cancel")).rejects.toBeInstanceOf(ConflictError);
		expect(await stockOf(db0)).toBe(1);
	});

	it("follows GHN callbacks, and pays COD only when GHN transfers the exact total", async () => {
		db0 = await freshDb();
		const order = await hcm();
		await applyOrderAction(db0, order.id, "confirm");
		await bookGhnShipment(db0, ghnSettings, order.id, undefined, ghn);
		const event = (over: Partial<CarrierEvent>): CarrierEvent => ({
			orderId: order.id,
			code: "LTEST1",
			type: "switch_status",
			status: "picked",
			codAmount: order.total,
			codTransferred: false,
			...over,
		});

		expect(await applyCarrierEvent(db0, event({ code: "OTHER1" }))).toBe("not_found");
		expect(await applyCarrierEvent(db0, event({ status: "picked" }))).toBe("updated");
		expect(await applyCarrierEvent(db0, event({ status: "picked" }))).toBe("ignored");
		expect(await getOrder(db0, order.id)).toMatchObject({ status: "shipped", paymentStatus: "unpaid" });

		await applyCarrierEvent(db0, event({ status: "delivered" }));
		expect(await getOrder(db0, order.id)).toMatchObject({ status: "delivered", paymentStatus: "unpaid" });

		expect(await applyCarrierEvent(db0, event({ type: "cod", status: "delivered", codAmount: order.total - 1, codTransferred: true }))).toBe("ignored");
		expect((await getOrder(db0, order.id))?.paymentStatus).toBe("unpaid");

		expect(await applyCarrierEvent(db0, event({ type: "cod", status: "delivered", codTransferred: true }))).toBe("updated");
		const paid = await getOrder(db0, order.id);
		expect(paid).toMatchObject({ status: "delivered", paymentStatus: "paid", payment: { provider: "cod", ref: "ghn:LTEST1" } });
		expect(paid!.history.map((h) => h.status)).toEqual(["pending", "confirmed", "shipped", "delivered", "paid"]);
		expect(await applyCarrierEvent(db0, event({ type: "cod", status: "delivered", codTransferred: true }))).toBe("ignored");
	});

	it("lets the seller confirm the money for a delivered GHN parcel by hand", async () => {
		db0 = await freshDb();
		const order = await hcm();
		await applyOrderAction(db0, order.id, "confirm");
		await bookGhnShipment(db0, ghnSettings, order.id, undefined, ghn);
		await applyOrderAction(db0, order.id, "ship");
		const delivered = await applyOrderAction(db0, order.id, "deliver");
		expect(delivered.paymentStatus).toBe("unpaid");
		const paid = await applyOrderAction(db0, order.id, "mark_paid");
		expect(paid.payment).toMatchObject({ provider: "cod", ref: "manual" });
	});
});

describe("prices from TikTok", () => {
	const rule = { feeBps: 2751, fixedFee: 3000, rounding: 1000 };
	const skuRow = (db: D1Database, id: string) => db.prepare("SELECT price, compare_at, stock FROM skus WHERE id = ?1").bind(id).first();

	it("sets the price from TikTok's list price minus fees and leaves stock alone", async () => {
		const db = await freshDb();
		const sku = catalogSource.products.flatMap((p) => p.skus).find((k) => k.compareAtPrice)!;
		await db.prepare("UPDATE skus SET price = 1000, stock = 7 WHERE id = ?1").bind(sku.id).run();
		await importCatalog(db, { mode: "prices", pricing: rule });
		expect(await skuRow(db, sku.id)).toEqual({ price: sitePrice(sku.compareAtPrice!, rule), compare_at: sku.compareAtPrice, stock: 7 });
	});

	it("keeps the price the seller set on an item TikTok has no price for", async () => {
		const db = await freshDb();
		const sku = catalogSource.products.flatMap((p) => p.skus).find((k) => k.price === 0)!;
		await db.prepare("UPDATE skus SET price = 50000 WHERE id = ?1").bind(sku.id).run();
		await importCatalog(db, { mode: "prices", pricing: rule });
		expect(await skuRow(db, sku.id)).toMatchObject({ price: 50000 });
	});
});

describe("units sold", () => {
	it("counts site sales from confirmed or paid orders only, on top of TikTok's", async () => {
		const db = await freshDb(20);
		const order = (quantity: number, phone: string, over: Record<string, unknown> = {}) =>
			place(db, { items: [{ productId: "test-p", skuId: "test-s", quantity }], customer: { name: "Nguyen Van A", phone }, ...over });
		await order(1, "0900000000"); // pending, unpaid: not a sale yet
		const confirmed = await order(2, "0911111111");
		await applyOrderAction(db, confirmed.id, "confirm");
		const paid = await order(3, "0922222222", { paymentMethod: "vietqr" });
		await applyOrderAction(db, paid.id, "mark_paid");
		const cancelled = await order(4, "0933333333");
		await applyOrderAction(db, cancelled.id, "confirm");
		await applyOrderAction(db, cancelled.id, "cancel");
		invalidateCatalog({ sold: true });
		const product = (await loadCatalog(db)).find((p) => p.id === "test-p");
		expect(product?.siteSold).toBe(5);
		expect(unitsSold({ ...product!, tiktokSold: 100 })).toBe(105);
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
