import type { Settings } from "../config";
import { safeEqual } from "../crypto";
import { claimBankTransaction, getOrder, releaseBankTransaction, setBankTransactionResult } from "../db";
import { log } from "../log";
import { recordPayment, recordPaymentAttempt, type PaymentResult } from "../orders";
import type { Order, PaymentMethod, PaymentProvider } from "../types";
import { findOrderCodes } from "../validation";
import { momo, vnpay, zalopay, type VerifiedPayment } from "./gateways";

export type GatewayProvider = Exclude<PaymentProvider, "bank">;

export const isGatewayProvider = (v: string): v is GatewayProvider => v === "momo" || v === "zalopay" || v === "vnpay";

/** Which gateway processes an online method: cards go through VNPay, else ZaloPay's card gateway. */
export function providerFor(method: PaymentMethod, s: Settings): GatewayProvider | null {
	if (method === "momo") return s.momo ? "momo" : null;
	if (method === "zalopay") return s.zalopay ? "zalopay" : null;
	if (method === "card") return s.vnpay ? "vnpay" : s.zalopay ? "zalopay" : null;
	return null;
}

const gateways = { momo, zalopay, vnpay };

export const orderIdFromRef = (provider: GatewayProvider, ref: string) => gateways[provider].orderId(ref);

/** Creates a gateway payment for the order and returns the URL to send the shopper to. */
export async function startPayment(db: D1Database, s: Settings, order: Order, ip?: string): Promise<string> {
	const provider = providerFor(order.paymentMethod, s);
	if (!provider) throw new Error(`No gateway for ${order.paymentMethod}`);
	const attempts = (order.payment?.attempts ?? 0) + 1;
	const ref = gateways[provider].ref(order.id, attempts);
	// Record the attempt first: if the gateway call fails half-way, the retry gets a fresh reference.
	const current = await recordPaymentAttempt(db, order, provider, ref, attempts);
	const input = {
		order: current,
		ref,
		method: order.paymentMethod,
		returnUrl: `${s.siteUrl}/api/payments/${provider}/return`,
		notifyUrl: `${s.siteUrl}/api/payments/${provider}/ipn`,
		ip,
	};
	const url =
		provider === "momo"
			? await momo.create(s.momo!, input)
			: provider === "zalopay"
				? await zalopay.create(s.zalopay!, input)
				: await vnpay.create(s.vnpay!, input);
	log.info("payment.started", { orderId: order.id, provider, attempts, amount: order.total });
	return url;
}

/** Verifies a gateway's signed browser return (query string). */
export async function verifyReturn(provider: GatewayProvider, s: Settings, q: Record<string, string>): Promise<VerifiedPayment | null> {
	if (provider === "momo") return s.momo ? momo.verify(s.momo, q) : null;
	if (provider === "zalopay") return s.zalopay ? zalopay.verifyRedirect(s.zalopay, q) : null;
	return s.vnpay ? vnpay.verify(s.vnpay, q) : null;
}

export async function confirmGatewayPayment(db: D1Database, provider: GatewayProvider, payment: VerifiedPayment) {
	const orderId = orderIdFromRef(provider, payment.ref);
	if (!orderId) return { result: "not_found" as const };
	return recordPayment(db, orderId, { provider, ref: payment.ref, amount: payment.amount, transactionId: payment.transactionId });
}

// ------------------------------------------------------------------ bank transfers (SePay)

/** The webhook body SePay posts for each transaction on the linked bank account. */
export interface SepayTransaction {
	id: number | string;
	gateway?: string;
	accountNumber?: string;
	code?: string | null;
	content?: string;
	description?: string;
	transferType?: "in" | "out";
	transferAmount?: number;
	referenceCode?: string;
}

export function sepayAuthorized(s: Settings, header: string | null | undefined): boolean {
	if (!s.sepayKey || !header) return false;
	return safeEqual(header.trim(), `Apikey ${s.sepayKey}`);
}

/**
 * Matches an incoming transfer on the BIDV account to an order by the order code in its memo and
 * the exact amount, then marks the order paid. Each transaction id is processed once.
 */
export async function handleBankTransaction(db: D1Database, s: Settings, tx: SepayTransaction): Promise<string> {
	if (tx.transferType !== "in" || !tx.transferAmount || tx.id === undefined) return "ignored";
	if (s.bank && tx.accountNumber && tx.accountNumber.replace(/\s/g, "") !== s.bank.accountNo) return "other_account";
	const id = `sepay:${tx.id}`;
	const amount = Math.round(Number(tx.transferAmount));
	if (!(await claimBankTransaction(db, id, amount))) return "duplicate";

	try {
		const codes = findOrderCodes(`${tx.code ?? ""} ${tx.content ?? ""} ${tx.description ?? ""}`);
		let outcome: PaymentResult | "unmatched" = "unmatched";
		let matched: string | null = null;
		for (const code of codes) {
			const order = await getOrder(db, code);
			if (!order) continue;
			matched = order.id;
			({ result: outcome } = await recordPayment(db, order.id, {
				provider: "bank",
				ref: id,
				amount,
				...(tx.referenceCode ? { transactionId: tx.referenceCode } : {}),
			}));
			break;
		}
		await setBankTransactionResult(db, id, matched, outcome);
		log.info("bank.transaction", { orderId: matched, amount, result: outcome });
		return outcome;
	} catch (error) {
		// Let SePay retry this transaction later.
		await releaseBankTransaction(db, id);
		throw error;
	}
}
