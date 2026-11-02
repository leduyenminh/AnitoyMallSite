import { hmacHex, safeEqual } from "../crypto";
import type { Settings } from "../config";
import type { Order, PaymentMethod } from "../types";

// Clients for the Vietnamese gateways: MoMo (wallet), ZaloPay (wallet, and its card gateway),
// VNPay (international cards). Each creates a payment and returns the URL to send the shopper
// to, and verifies the signed result the gateway sends back (server notification and browser
// return). Money settles to the merchant bank account registered with each gateway.

type Momo = NonNullable<Settings["momo"]>;
type ZaloPay = NonNullable<Settings["zalopay"]>;
type VnPay = NonNullable<Settings["vnpay"]>;

export interface VerifiedPayment {
	/** Our reference for the attempt (contains the order id). */
	ref: string;
	success: boolean;
	amount: number;
	transactionId?: string;
}

export interface CreateInput {
	order: Order;
	ref: string;
	method: PaymentMethod;
	returnUrl: string;
	notifyUrl: string;
	ip?: string;
}

/** Vietnam time (GMT+7) pieces, independent of the runtime timezone. */
export function vnTime(date: Date) {
	const d = new Date(date.getTime() + 7 * 3600_000);
	const p = (n: number) => String(n).padStart(2, "0");
	return {
		yymmdd: `${p(d.getUTCFullYear() % 100)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`,
		stamp: `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`,
	};
}

/** ASCII-only description (gateways reject diacritics and special characters). */
const describe = (order: Order) => `Thanh toan don hang ${order.id} Mall of Anitoy`;

// ------------------------------------------------------------------ MoMo

export const momo = {
	ref: (orderId: string, attempt: number) => `${orderId}-${attempt}`,
	orderId: (ref: string) => (ref ?? "").split("-")[0] ?? "",

	async create(s: Momo, input: CreateInput): Promise<string> {
		const body = {
			partnerCode: s.partnerCode,
			requestId: `${input.ref}-${Date.now()}`,
			amount: input.order.total,
			orderId: input.ref,
			orderInfo: describe(input.order),
			redirectUrl: input.returnUrl,
			ipnUrl: input.notifyUrl,
			requestType: "captureWallet",
			extraData: "",
			lang: "vi",
		};
		const raw =
			`accessKey=${s.accessKey}&amount=${body.amount}&extraData=${body.extraData}&ipnUrl=${body.ipnUrl}` +
			`&orderId=${body.orderId}&orderInfo=${body.orderInfo}&partnerCode=${body.partnerCode}` +
			`&redirectUrl=${body.redirectUrl}&requestId=${body.requestId}&requestType=${body.requestType}`;
		const res = await fetch(`${s.endpoint}/v2/gateway/api/create`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ ...body, signature: await hmacHex("SHA-256", s.secretKey, raw) }),
		});
		const json = (await res.json()) as { resultCode?: number; message?: string; payUrl?: string };
		if (json.resultCode !== 0 || !json.payUrl) throw new Error(`MoMo create failed: ${json.resultCode} ${json.message ?? ""}`.trim());
		return json.payUrl;
	},

	/** The IPN body and the redirect query carry the same signed fields. */
	async verify(s: Momo, p: Record<string, unknown>): Promise<VerifiedPayment | null> {
		const v = (k: string) => (p[k] ?? "").toString();
		const raw =
			`accessKey=${s.accessKey}&amount=${v("amount")}&extraData=${v("extraData")}&message=${v("message")}` +
			`&orderId=${v("orderId")}&orderInfo=${v("orderInfo")}&orderType=${v("orderType")}&partnerCode=${v("partnerCode")}` +
			`&payType=${v("payType")}&requestId=${v("requestId")}&responseTime=${v("responseTime")}` +
			`&resultCode=${v("resultCode")}&transId=${v("transId")}`;
		if (!v("signature") || !safeEqual(await hmacHex("SHA-256", s.secretKey, raw), v("signature"), true)) return null;
		return { ref: v("orderId"), success: v("resultCode") === "0", amount: Number(v("amount")), transactionId: v("transId") || undefined };
	},
};

// ------------------------------------------------------------------ ZaloPay

export const zalopay = {
	/** app_trans_id: yymmdd (GMT+7) + "_" + unique id. */
	ref: (orderId: string, attempt: number, now = new Date()) => `${vnTime(now).yymmdd}_${orderId}_${attempt}`,
	orderId: (ref: string) => (ref ?? "").split("_")[1] ?? "",

	async create(s: ZaloPay, input: CreateInput): Promise<string> {
		const preferred = input.method === "card" ? ["international_card"] : ["zalopay_wallet"];
		const params = {
			app_id: s.appId,
			app_user: "guest",
			app_trans_id: input.ref,
			app_time: String(Date.now()),
			amount: String(input.order.total),
			item: JSON.stringify(
				input.order.lines.map((l) => ({ itemid: l.skuId, itemname: l.title.slice(0, 100), itemprice: l.unitPrice, itemquantity: l.quantity })),
			),
			embed_data: JSON.stringify({ redirecturl: input.returnUrl, preferred_payment_method: preferred }),
			description: describe(input.order),
			bank_code: "",
			callback_url: input.notifyUrl,
		};
		const mac = await hmacHex(
			"SHA-256",
			s.key1,
			[params.app_id, params.app_trans_id, params.app_user, params.amount, params.app_time, params.embed_data, params.item].join("|"),
		);
		const res = await fetch(`${s.endpoint}/v2/create`, {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({ ...params, mac }),
		});
		const json = (await res.json()) as { return_code?: number; return_message?: string; sub_return_message?: string; order_url?: string };
		if (json.return_code !== 1 || !json.order_url) {
			throw new Error(`ZaloPay create failed: ${json.return_message} ${json.sub_return_message ?? ""}`.trim());
		}
		return json.order_url;
	},

	/** Server callback { data, mac, type }: mac = HMAC-SHA256(key2, data). */
	async verifyCallback(s: ZaloPay, body: { data?: string; mac?: string }): Promise<VerifiedPayment | null> {
		if (!body.data || !body.mac || !safeEqual(await hmacHex("SHA-256", s.key2, body.data), body.mac, true)) return null;
		const data = JSON.parse(body.data) as { app_trans_id: string; amount: number; zp_trans_id?: number };
		return { ref: String(data.app_trans_id ?? ""), success: true, amount: Number(data.amount), transactionId: data.zp_trans_id?.toString() };
	},

	/** Browser redirect: checksum = HMAC-SHA256(key2, appid|apptransid|pmcid|bankcode|amount|discountamount|status). */
	async verifyRedirect(s: ZaloPay, q: Record<string, string>): Promise<VerifiedPayment | null> {
		const input = [q.appid, q.apptransid, q.pmcid, q.bankcode, q.amount, q.discountamount, q.status].join("|");
		if (!q.checksum || !safeEqual(await hmacHex("SHA-256", s.key2, input), q.checksum, true)) return null;
		return { ref: q.apptransid ?? "", success: q.status === "1", amount: Number(q.amount) };
	},
};

// ------------------------------------------------------------------ VNPay

/** VNPay signs the sorted, URL-encoded query (spaces as "+") with HMAC-SHA512. */
export function vnpaySignData(params: Record<string, string>): string {
	const enc = (value: string) => encodeURIComponent(value).replace(/%20/g, "+");
	return Object.keys(params)
		.filter((k) => params[k] !== undefined && params[k] !== "")
		.sort()
		.map((k) => `${enc(k)}=${enc(params[k]!)}`)
		.join("&");
}

export const vnpay = {
	/** vnp_TxnRef: alphanumeric, unique per day. */
	ref: (orderId: string, attempt: number) => `${orderId}${String(attempt).padStart(2, "0")}`,
	orderId: (ref: string) => (ref ?? "").slice(0, 9),

	async create(s: VnPay, input: CreateInput, now = new Date()): Promise<string> {
		const params: Record<string, string> = {
			vnp_Version: "2.1.0",
			vnp_Command: "pay",
			vnp_TmnCode: s.tmnCode,
			vnp_Amount: String(input.order.total * 100),
			vnp_CreateDate: vnTime(now).stamp,
			vnp_ExpireDate: vnTime(new Date(now.getTime() + 30 * 60_000)).stamp,
			vnp_CurrCode: "VND",
			vnp_IpAddr: input.ip ?? "127.0.0.1",
			vnp_Locale: "vn",
			vnp_OrderInfo: describe(input.order),
			vnp_OrderType: "other",
			vnp_ReturnUrl: input.returnUrl,
			vnp_TxnRef: input.ref,
			...(input.method === "card" ? { vnp_BankCode: "INTCARD" } : {}),
		};
		const signData = vnpaySignData(params);
		return `${s.payUrl}?${signData}&vnp_SecureHash=${await hmacHex("SHA-512", s.hashSecret, signData)}`;
	},

	/** Same check for the return URL and the IPN (both GET with vnp_* params). */
	async verify(s: VnPay, q: Record<string, string>): Promise<VerifiedPayment | null> {
		const { vnp_SecureHash: hash, vnp_SecureHashType: _type, ...rest } = q;
		const params = Object.fromEntries(Object.entries(rest).filter(([k]) => k.startsWith("vnp_")));
		if (!hash || !safeEqual(await hmacHex("SHA-512", s.hashSecret, vnpaySignData(params)), hash, true)) return null;
		return {
			ref: q.vnp_TxnRef ?? "",
			success: q.vnp_ResponseCode === "00" && q.vnp_TransactionStatus === "00",
			amount: Number(q.vnp_Amount) / 100,
			transactionId: q.vnp_TransactionNo,
		};
	},
};
