import type { PaymentMethod } from "./types";

export const site = {
	name: "Mall of Anitoy",
	shortName: "Anitoy",
	tagline: "Mô hình anime chibi decor bàn học, bàn làm việc",
	tiktok: {
		handle: "leduyenminh",
		profileUrl: "https://www.tiktok.com/@leduyenminh",
		shopUrl: "https://www.tiktok.com/@leduyenminh",
	},
	locale: "vi-VN",
	currency: "VND",
	country: "VN",
} as const;

export const collections: Record<string, { name: string; blurb: string }> = {
	frieren: { name: "Frieren", blurb: "Frieren, Fern, Stark và Himmel – mô hình chibi, figure 20cm và móc khoá Sousou no Frieren." },
	neko: { name: "Neko Kawaii", blurb: "Osakana neko, Kinako – hội cô gái tai mèo My cat is a kawaii girl." },
	kimetsu: { name: "Kimetsu no Yaiba", blurb: "Tanjirou, Nezuko, Zenitsu, Inosuke, Giyu và Shinobu." },
	khac: { name: "Anime & Game", blurb: "Chainsaw Man, Honkai: Star Rail, Genshin Impact và nhiều hơn nữa." },
};

export const categories: Record<string, { name: string; blurb: string }> = {
	mini: { name: "Mô hình mini", blurb: "Mô hình chibi 9–12cm, vừa xinh cho góc bàn học." },
	figure: { name: "Figure 20cm", blurb: "Figure cỡ lớn 20cm, chi tiết sắc nét để trưng bày." },
	accessory: { name: "Móc khoá & phụ kiện", blurb: "Móc khoá acrylic, standee, dây đeo điện thoại." },
};

const num = (value: string | undefined, fallback: number) => {
	const n = Number(value);
	return value !== undefined && value !== "" && Number.isFinite(n) ? n : fallback;
};

export interface Settings {
	siteUrl: string;
	shipping: { fee: number; freeThreshold: number; eta: string };
	returnDays: number;
	bank: { bin: string; name: string; accountNo: string; accountName: string } | null;
	contact: { phone?: string; email?: string; zalo?: string };
	/** Minutes before an unconfirmed, unpaid order expires, per kind of payment. */
	ttl: { online: number; bank: number; cod: number };
	momo: { partnerCode: string; accessKey: string; secretKey: string; endpoint: string } | null;
	zalopay: { appId: string; key1: string; key2: string; endpoint: string } | null;
	vnpay: { tmnCode: string; hashSecret: string; payUrl: string } | null;
	sepayKey: string | null;
	turnstile: { siteKey: string; secret: string } | null;
	imageResizing: boolean;
	adminPassword: string | null;
}

/** Parsed settings. `origin` is the request origin, used when SITE_URL is not set. */
export function settings(env: Env, origin = "http://localhost:5173"): Settings {
	const trim = (v: string | undefined) => (v ?? "").trim();
	const bankAccountNo = trim(env.BANK_ACCOUNT_NO);
	const bankAccountName = trim(env.BANK_ACCOUNT_NAME);
	return {
		siteUrl: (trim(env.SITE_URL) || origin).replace(/\/$/, ""),
		shipping: {
			fee: num(env.SHIPPING_FEE, 30000),
			freeThreshold: num(env.FREE_SHIPPING_THRESHOLD, 150000),
			eta: trim(env.DELIVERY_ETA) || "2–5",
		},
		returnDays: num(env.RETURN_DAYS, 0),
		bank:
			bankAccountNo && bankAccountName
				? { bin: trim(env.BANK_BIN) || "970418", name: trim(env.BANK_NAME) || "BIDV", accountNo: bankAccountNo, accountName: bankAccountName }
				: null,
		contact: {
			phone: trim(env.CONTACT_PHONE) || undefined,
			email: trim(env.CONTACT_EMAIL) || undefined,
			zalo: trim(env.CONTACT_ZALO) || undefined,
		},
		ttl: { online: num(env.ORDER_TTL_ONLINE, 30), bank: num(env.ORDER_TTL_BANK, 360), cod: num(env.ORDER_TTL_COD, 1440) },
		momo:
			env.MOMO_PARTNER_CODE && env.MOMO_ACCESS_KEY && env.MOMO_SECRET_KEY
				? {
						partnerCode: env.MOMO_PARTNER_CODE,
						accessKey: env.MOMO_ACCESS_KEY,
						secretKey: env.MOMO_SECRET_KEY,
						endpoint: (trim(env.MOMO_ENDPOINT) || "https://test-payment.momo.vn").replace(/\/$/, ""),
					}
				: null,
		zalopay:
			env.ZALOPAY_APP_ID && env.ZALOPAY_KEY1 && env.ZALOPAY_KEY2
				? {
						appId: env.ZALOPAY_APP_ID,
						key1: env.ZALOPAY_KEY1,
						key2: env.ZALOPAY_KEY2,
						endpoint: (trim(env.ZALOPAY_ENDPOINT) || "https://sb-openapi.zalopay.vn").replace(/\/$/, ""),
					}
				: null,
		vnpay:
			env.VNPAY_TMN_CODE && env.VNPAY_HASH_SECRET
				? {
						tmnCode: env.VNPAY_TMN_CODE,
						hashSecret: env.VNPAY_HASH_SECRET,
						payUrl: trim(env.VNPAY_PAY_URL) || "https://sandbox.vnpayment.vn/paymentv2/vpcpay.html",
					}
				: null,
		sepayKey: env.SEPAY_API_KEY || null,
		turnstile:
			trim(env.TURNSTILE_SITE_KEY) && env.TURNSTILE_SECRET_KEY
				? { siteKey: trim(env.TURNSTILE_SITE_KEY), secret: env.TURNSTILE_SECRET_KEY }
				: null,
		imageResizing: trim(env.IMAGE_RESIZING) === "1",
		adminPassword: env.ADMIN_PASSWORD || null,
	};
}

/** Checkout methods in display order; online ones appear once their gateway keys are set. */
export function enabledPaymentMethods(s: Settings): PaymentMethod[] {
	return [
		"cod",
		...(s.bank ? (["vietqr"] as const) : []),
		...(s.momo ? (["momo"] as const) : []),
		...(s.zalopay ? (["zalopay"] as const) : []),
		...(s.vnpay || s.zalopay ? (["card"] as const) : []),
	];
}

export const paymentLabels: Record<PaymentMethod, { title: string; hint: string }> = {
	cod: { title: "Thanh toán khi nhận hàng (COD)", hint: "Trả tiền mặt cho shipper khi nhận hàng." },
	vietqr: { title: "Chuyển khoản VietQR", hint: "Quét mã QR bằng app ngân hàng bất kỳ, tiền về thẳng tài khoản BIDV của shop." },
	momo: { title: "Ví MoMo", hint: "Thanh toán bằng ví MoMo." },
	zalopay: { title: "Ví ZaloPay", hint: "Thanh toán bằng ví ZaloPay." },
	card: { title: "Thẻ tín dụng / ghi nợ", hint: "Visa, Mastercard, JCB – cổng thanh toán bảo mật." },
};
