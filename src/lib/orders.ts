import { enabledPaymentMethods, type Settings } from "./config";
import { randomCode, randomToken, safeEqual } from "./crypto";
import {
	cancelOrder,
	ConflictError,
	countOpenOrdersForPhone,
	countRecentOrdersForIp,
	DuplicateOrderError,
	expiredOrders,
	getOrder,
	loadProducts,
	OutOfStockError,
	placeOrder,
	saveOrder,
} from "./db";
import { log } from "./log";
import { buildQuote, type Quote } from "./quote";
import type { Order, OrderEvent, OrderStatus, PaymentMethod, PaymentProvider } from "./types";
import { checkoutSchema, isOrderCode, isValidEmail, normaliseOrderCode, normalisePhone, ORDER_CODE_ALPHABET } from "./validation";

// Order workflow. Invariants:
// - the server prices every order (buildQuote) right before placing it;
// - an order and its stock decrement are one D1 transaction (placeOrder), and cancelling returns
//   the stock in the same transaction (cancelOrder);
// - every state change goes through saveOrder/cancelOrder with optimistic locking and appends
//   to `history`;
// - an order is paid only when a bank transfer for its exact total arrives (SePay) or the seller
//   confirms the money in /admin; COD is paid when the parcel is delivered.

/** Unpaid, unconfirmed orders one phone number may have open at once. */
export const MAX_OPEN_ORDERS_PER_PHONE = 3;
/** Orders one network (hashed IP) may place per hour. */
export const MAX_ORDERS_PER_IP_PER_HOUR = 8;

export class CheckoutError extends Error {
	constructor(
		public readonly code: "invalid" | "quote_changed" | "too_many_orders" | "verification_failed",
		public readonly details: { fields?: string[]; quote?: Quote } = {},
	) {
		super(code);
		this.name = "CheckoutError";
	}
}

export const newOrderId = () => `MA${randomCode(ORDER_CODE_ALPHABET, 7)}`;

/** Minutes an order may wait for payment or the seller's confirmation before it is released. */
export function ttlMinutes(method: PaymentMethod, s: Settings): number {
	return method === "cod" ? s.ttl.cod : s.ttl.bank;
}

export interface CreateContext {
	ipHash: string | null;
	/** Verifies a Turnstile token when Turnstile is configured. */
	verifyHuman?: (token: string | undefined) => Promise<boolean>;
	now?: Date;
}

export async function createOrder(db: D1Database, s: Settings, raw: unknown, ctx: CreateContext): Promise<Order> {
	const parsed = checkoutSchema.safeParse(raw);
	if (!parsed.success) throw new CheckoutError("invalid", { fields: parsed.error.issues.map((i) => i.path.join(".")) });
	const input = parsed.data;

	// Honeypot filled: answer like a validation error, without saying why.
	if (input.website) throw new CheckoutError("invalid", { fields: [] });

	const phone = normalisePhone(input.customer.phone);
	const email = input.customer.email || undefined;
	const fields: string[] = [];
	if (!phone) fields.push("customer.phone");
	if (email && !isValidEmail(email)) fields.push("customer.email");
	if (!enabledPaymentMethods(s).includes(input.paymentMethod)) fields.push("paymentMethod");
	if (fields.length) throw new CheckoutError("invalid", { fields });

	if (ctx.verifyHuman && !(await ctx.verifyHuman(input.turnstileToken))) throw new CheckoutError("verification_failed");

	const now = ctx.now ?? new Date();
	// Durable, global spam limits (the per-location rate limiter runs before this).
	if ((await countOpenOrdersForPhone(db, phone!)) >= MAX_OPEN_ORDERS_PER_PHONE) throw new CheckoutError("too_many_orders");
	if (ctx.ipHash) {
		const since = new Date(now.getTime() - 3600_000).toISOString();
		if ((await countRecentOrdersForIp(db, ctx.ipHash, since)) >= MAX_ORDERS_PER_IP_PER_HOUR) throw new CheckoutError("too_many_orders");
	}

	const quoteFor = async () => buildQuote(input.items, await loadProducts(db, input.items.map((i) => i.productId)), s.shipping);
	const quote = await quoteFor();
	if (quote.hasIssues || quote.itemCount === 0) throw new CheckoutError("quote_changed", { quote });

	const at = now.toISOString();
	const ttl = ttlMinutes(input.paymentMethod, s);
	const order: Order = {
		id: newOrderId(),
		accessToken: randomToken(),
		status: "pending",
		paymentMethod: input.paymentMethod,
		paymentStatus: "unpaid",
		customer: { name: input.customer.name, phone: phone!, ...(email ? { email } : {}) },
		address: input.address,
		...(input.note ? { note: input.note } : {}),
		lines: quote.lines.map((l) => ({
			productId: l.productId,
			skuId: l.skuId,
			slug: l.slug,
			title: l.title,
			skuName: l.skuName,
			...(l.image ? { image: l.image } : {}),
			unitPrice: l.unitPrice,
			quantity: l.quantity,
			lineTotal: l.lineTotal,
		})),
		subtotal: quote.subtotal,
		shippingFee: quote.shippingFee,
		total: quote.total,
		history: [{ status: "pending", at }],
		...(ttl > 0 ? { expiresAt: new Date(now.getTime() + ttl * 60_000).toISOString() } : {}),
		version: 1,
		createdAt: at,
		updatedAt: at,
	};

	for (let attempt = 0; ; attempt++) {
		try {
			await placeOrder(db, order, ctx.ipHash);
			break;
		} catch (error) {
			if (error instanceof DuplicateOrderError && attempt < 3) {
				order.id = newOrderId();
				continue;
			}
			// Someone bought the last units between quoting and placing: show the fresh quote.
			if (error instanceof OutOfStockError) throw new CheckoutError("quote_changed", { quote: await quoteFor() });
			throw error;
		}
	}
	log.info("order.created", { orderId: order.id, total: order.total, lines: order.lines.length, method: order.paymentMethod });
	return order;
}

/** Orders hold personal data: viewing one requires the random token from its link. */
export async function getOrderForViewer(db: D1Database, id: string, token: string | undefined): Promise<Order | null> {
	if (!token || !isOrderCode(id)) return null;
	const order = await getOrder(db, id);
	return order && safeEqual(order.accessToken, token) ? order : null;
}

export const maskName = (name: string) => `${Array.from(name.trim()).slice(0, 2).join("")}***`;
export const maskPhone = (phone: string) => (phone.length < 6 ? "***" : `${phone.slice(0, 3)}****${phone.slice(-3)}`);

export interface OrderLookup {
	id: string;
	status: OrderStatus;
	paymentMethod: PaymentMethod;
	paymentStatus: Order["paymentStatus"];
	lines: { slug: string; title: string; skuName: string; image?: string; quantity: number; lineTotal: number }[];
	subtotal: number;
	shippingFee: number;
	total: number;
	history: { status: OrderEvent["status"]; at: string }[];
	customer: { name: string; phone: string };
	province: string;
	expiresAt?: string;
	createdAt: string;
}

/**
 * "Tra cứu đơn hàng": code + phone. A wrong code and a wrong phone look the same, and the result
 * never includes the address, email, note or access token.
 */
export async function lookupOrder(db: D1Database, code: string, phoneInput: string): Promise<OrderLookup | null> {
	const id = normaliseOrderCode(code);
	const phone = normalisePhone(phoneInput);
	const order = phone && isOrderCode(id) ? await getOrder(db, id) : null;
	if (!order || !safeEqual(order.customer.phone, phone ?? "")) return null;
	return {
		id: order.id,
		status: order.status,
		paymentMethod: order.paymentMethod,
		paymentStatus: order.paymentStatus,
		lines: order.lines.map(({ slug, title, skuName, image, quantity, lineTotal }) => ({ slug, title, skuName, image, quantity, lineTotal })),
		subtotal: order.subtotal,
		shippingFee: order.shippingFee,
		total: order.total,
		history: order.history.map((h) => ({ status: h.status, at: h.at })),
		customer: { name: maskName(order.customer.name), phone: maskPhone(order.customer.phone) },
		province: order.address.province,
		...(order.expiresAt && order.status === "pending" && order.paymentStatus === "unpaid" ? { expiresAt: order.expiresAt } : {}),
		createdAt: order.createdAt,
	};
}

export type PaymentResult = "paid" | "already_paid" | "not_found" | "amount_mismatch";

/** Marks an order paid from a verified bank transfer. Idempotent: SePay retries webhooks. */
export async function recordPayment(
	db: D1Database,
	orderId: string,
	payment: { provider: PaymentProvider; ref: string; amount: number; transactionId?: string },
): Promise<{ result: PaymentResult; order?: Order }> {
	for (let attempt = 0; attempt < 3; attempt++) {
		const order = await getOrder(db, orderId);
		if (!order) return { result: "not_found" };
		if (order.paymentStatus === "paid") return { result: "already_paid", order };
		if (payment.amount !== order.total) {
			log.warn("payment.amount_mismatch", { orderId, expected: order.total, received: payment.amount, provider: payment.provider });
			return { result: "amount_mismatch", order };
		}
		const at = new Date().toISOString();
		const lateNote = order.status === "cancelled" ? "Thanh toán đến sau khi đơn đã huỷ – cần hoàn tiền hoặc mở lại đơn" : undefined;
		const { expiresAt: _expired, ...rest } = order;
		const next: Order = {
			...rest,
			paymentStatus: "paid",
			payment: {
				provider: payment.provider,
				ref: payment.ref,
				...(payment.transactionId ? { transactionId: payment.transactionId } : {}),
				paidAt: at,
			},
			history: [...order.history, { status: "paid", at, note: lateNote ?? payment.provider }],
			updatedAt: at,
		};
		try {
			const saved = await saveOrder(db, order, next);
			if (lateNote) log.warn("payment.paid_after_cancel", { orderId, provider: payment.provider });
			log.info("payment.confirmed", { orderId, provider: payment.provider, amount: payment.amount });
			return { result: "paid", order: saved };
		} catch (error) {
			if (error instanceof ConflictError) continue;
			throw error;
		}
	}
	throw new ConflictError(`Order ${orderId} kept changing while recording payment`);
}

export type OrderAction = "confirm" | "mark_paid" | "ship" | "deliver" | "cancel";

const transitions: Record<Exclude<OrderAction, "mark_paid">, { from: OrderStatus[]; to: OrderStatus }> = {
	confirm: { from: ["pending"], to: "confirmed" },
	ship: { from: ["pending", "confirmed"], to: "shipped" },
	deliver: { from: ["shipped"], to: "delivered" },
	cancel: { from: ["pending", "confirmed"], to: "cancelled" },
};

export function allowedActions(order: Order): OrderAction[] {
	const actions = (Object.keys(transitions) as (keyof typeof transitions)[]).filter((a) => transitions[a].from.includes(order.status)) as OrderAction[];
	// The seller confirms VietQR transfers by hand; COD becomes paid only when it is delivered.
	if (order.paymentMethod === "vietqr" && order.paymentStatus === "unpaid" && order.status !== "cancelled") actions.push("mark_paid");
	return actions;
}

/** Seller-side workflow (admin). Confirming or marking paid stops the order from expiring. */
export async function applyOrderAction(db: D1Database, id: string, action: OrderAction, expectedVersion?: number): Promise<Order> {
	const order = await getOrder(db, id);
	if (!order) throw new Error("not_found");
	if (expectedVersion !== undefined && order.version !== expectedVersion) throw new ConflictError("stale");
	if (!allowedActions(order).includes(action)) throw new ConflictError(`cannot ${action} while ${order.status}`);

	const at = new Date().toISOString();
	const { expiresAt: _expires, ...rest } = order;
	const next: Order = { ...rest, updatedAt: at, history: [...order.history] };

	if (action === "cancel") {
		next.status = "cancelled";
		next.history.push({ status: "cancelled", at, note: "Shop huỷ đơn" });
		const saved = await cancelOrder(db, order, next);
		log.info("order.updated", { orderId: id, action, status: saved.status });
		return saved;
	}
	if (action === "mark_paid") {
		next.paymentStatus = "paid";
		next.payment = { provider: "bank", ref: "manual", paidAt: at };
		next.history.push({ status: "paid", at, note: "Shop xác nhận đã nhận tiền" });
	} else {
		next.status = transitions[action].to;
		next.history.push({ status: next.status, at });
		// Cash on delivery is collected when the parcel is delivered.
		if (action === "deliver" && order.paymentMethod === "cod" && order.paymentStatus === "unpaid") {
			next.paymentStatus = "paid";
			next.payment = { provider: "cod", ref: "delivery", paidAt: at };
			next.history.push({ status: "paid", at, note: "COD" });
		}
	}
	const saved = await saveOrder(db, order, next);
	log.info("order.updated", { orderId: id, action, status: saved.status, payment: saved.paymentStatus });
	return saved;
}

/**
 * Cancels orders still waiting for payment or the seller's confirmation after their deadline,
 * returning their stock. Runs from the cron trigger; safe to run concurrently.
 */
export async function expireOrders(db: D1Database, now = new Date()): Promise<string[]> {
	const expired: string[] = [];
	for (const order of await expiredOrders(db, now.toISOString())) {
		const at = now.toISOString();
		const { expiresAt: _e, ...rest } = order;
		const next: Order = {
			...rest,
			status: "cancelled",
			history: [...order.history, { status: "expired", at, note: "Quá hạn thanh toán / xác nhận – đã trả hàng về kho" }],
			updatedAt: at,
		};
		try {
			await cancelOrder(db, order, next);
			expired.push(order.id);
		} catch (error) {
			// Paid or confirmed meanwhile: leave it.
			if (!(error instanceof ConflictError)) log.error("order.expire_failed", { orderId: order.id, error: String(error) });
		}
	}
	if (expired.length) log.info("orders.expired", { count: expired.length, orders: expired });
	return expired;
}
