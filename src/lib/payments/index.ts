import type { Settings } from "../config";
import { safeEqual } from "../crypto";
import { claimBankTransaction, getOrder, releaseBankTransaction, setBankTransactionResult } from "../db";
import { log } from "../log";
import { recordPayment, type PaymentResult } from "../orders";
import { findOrderCodes } from "../validation";

// The shop takes two kinds of payment: cash on delivery, and VietQR transfers straight into its
// BIDV account. Transfers are confirmed by the seller in /admin, or automatically through SePay,
// which posts every transaction on the linked account to /api/webhooks/sepay.

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
	// Only transfers into the configured BIDV account count; a missing account number never matches.
	if (!s.bank || tx.accountNumber?.replace(/\s/g, "") !== s.bank.accountNo) return "other_account";
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
