import type { Lang } from "./i18n";
import { type PricingRule, pricingRule } from "./pricing";
import type { GhnConfig, Parcel, ShippingSettings } from "./shipping";
import type { PaymentMethod } from "./types";

export const site = {
	name: "Mall of Anitoy",
	shortName: "Anitoy",
	tagline: "Mô hình anime chibi decor bàn học, bàn làm việc",
	taglineEn: "Anime chibi figures to decorate your study or work desk",
	tiktok: {
		handle: "leduyenminh",
		profileUrl: "https://www.tiktok.com/@leduyenminh",
		shopUrl: "https://www.tiktok.com/@leduyenminh",
	},
	locale: "vi-VN",
	currency: "VND",
	country: "VN",
} as const;

/** A collection or category: Vietnamese name and blurb, and the English ones for /en. */
export interface Group {
	name: string;
	blurb: string;
	en: { name: string; blurb: string };
}

export const collections: Record<string, Group> = {
	frieren: {
		name: "Frieren",
		blurb: "Frieren, Fern, Stark và Himmel – mô hình chibi, figure 20cm và móc khoá Sousou no Frieren.",
		en: { name: "Frieren", blurb: "Frieren, Fern, Stark and Himmel – chibi figures, 20 cm figures and keychains from Frieren: Beyond Journey's End." },
	},
	neko: {
		name: "Neko Kawaii",
		blurb: "Osakana neko, Kinako – hội cô gái tai mèo My cat is a kawaii girl.",
		en: { name: "Neko Kawaii", blurb: "Osakana neko and Kinako – the cat-eared girls of My Cat Is a Kawaii Girl." },
	},
	kimetsu: {
		name: "Kimetsu no Yaiba",
		blurb: "Tanjirou, Nezuko, Zenitsu, Inosuke, Giyu và Shinobu.",
		en: { name: "Demon Slayer", blurb: "Demon Slayer: Kimetsu no Yaiba – Tanjirou, Nezuko, Zenitsu, Inosuke, Giyu and Shinobu." },
	},
	khac: {
		name: "Anime & Game",
		blurb: "Chainsaw Man, Honkai: Star Rail, Genshin Impact và nhiều hơn nữa.",
		en: { name: "Anime & Game", blurb: "Chainsaw Man, Honkai: Star Rail, Genshin Impact and more." },
	},
};

export const categories: Record<string, Group> = {
	mini: {
		name: "Mô hình mini",
		blurb: "Mô hình chibi 9–12cm, vừa xinh cho góc bàn học.",
		en: { name: "Mini figures", blurb: "9–12 cm chibi figures, just the right size for a desk corner." },
	},
	figure: {
		name: "Figure 20cm",
		blurb: "Figure cỡ lớn 20cm, chi tiết sắc nét để trưng bày.",
		en: { name: "20 cm figures", blurb: "Large 20 cm figures with crisp detail, made for display." },
	},
	accessory: {
		name: "Móc khoá & phụ kiện",
		blurb: "Móc khoá acrylic, standee, dây đeo điện thoại.",
		en: { name: "Keychains & accessories", blurb: "Acrylic keychains, standees and phone straps." },
	},
};

/** A collection's or category's name and blurb in `lang`. */
export const groupText = (g: Group, lang: Lang) => (lang === "en" ? g.en : g);

const num = (value: string | undefined, fallback: number) => {
	const n = Number(value);
	return value !== undefined && value !== "" && Number.isFinite(n) ? n : fallback;
};

export interface Settings {
	siteUrl: string;
	/** How website prices are derived from TikTok prices (src/lib/pricing.ts). */
	pricing: PricingRule;
	shipping: ShippingSettings;
	returnDays: number;
	bank: { bin: string; name: string; accountNo: string; accountName: string } | null;
	contact: { phone?: string; email?: string; zalo?: string };
	/** Minutes before an unconfirmed, unpaid order expires, per kind of payment. */
	ttl: { bank: number; cod: number };
	sepayKey: string | null;
	turnstile: { siteKey: string; secret: string } | null;
	imageResizing: boolean;
	adminPassword: string | null;
}

/**
 * Where a page request on www.<site> should be sent: the same path on the bare domain from
 * SITE_URL, so search engines see one site. Only GET/HEAD page requests are redirected: a 301
 * would turn a POST into a GET, and server-to-server callers such as the SePay webhook don't
 * follow redirects, so /api/* is always answered where it was called.
 */
export function wwwRedirect(requestUrl: URL, siteUrl: string, method: string): string | null {
	if (method !== "GET" && method !== "HEAD") return null;
	if (requestUrl.pathname.startsWith("/api/")) return null;
	let site: URL;
	try {
		site = new URL(siteUrl);
	} catch {
		return null;
	}
	if (requestUrl.hostname !== `www.${site.hostname}`) return null;
	return `${site.origin}${requestUrl.pathname}${requestUrl.search}`;
}

/** One packed item when the setting is missing or malformed: under 200 g in a 20×10×10 cm box. */
export const DEFAULT_PARCEL: Parcel = { weight: 200, length: 20, width: 10, height: 10 };

/** Parses a weight in grams and "20x10x10" (cm); falls back to `fallback` when malformed. */
export function parseParcel(weight: string | undefined, size: string | undefined, fallback: Parcel = DEFAULT_PARCEL): Parcel {
	const w = Number((weight ?? "").trim());
	const dims = (size ?? "").trim().toLowerCase().split("x").map(Number);
	const ok = (n: number, max: number) => Number.isInteger(n) && n > 0 && n <= max;
	if (!ok(w, 50_000) || dims.length !== 3 || !dims.every((d) => ok(d, 200))) return fallback;
	const [length, width, height] = dims as [number, number, number];
	return { weight: w, length, width, height };
}

/** GHN is used once its token, shop id and the shop's phone are all set. */
function ghnConfig(env: Env): GhnConfig | null {
	const token = (env.GHN_TOKEN ?? "").trim();
	const shopId = Number((env.GHN_SHOP_ID ?? "").trim());
	const phone = (env.SHIP_FROM_PHONE ?? "").trim();
	if (!token || !Number.isSafeInteger(shopId) || shopId <= 0 || !phone) return null;
	return {
		apiUrl: ((env.GHN_API_URL ?? "").trim() || "https://online-gateway.ghn.vn").replace(/\/$/, ""),
		token,
		shopId,
		previewName: site.name,
		previewPhone: phone,
		webhookSecret: (env.GHN_WEBHOOK_SECRET ?? "").trim() || null,
	};
}

/** Parsed settings. `origin` is the request origin, used when SITE_URL is not set. */
export function settings(env: Env, origin = "http://localhost:5173"): Settings {
	const trim = (v: string | undefined) => (v ?? "").trim();
	const bankAccountNo = trim(env.BANK_ACCOUNT_NO);
	const bankAccountName = trim(env.BANK_ACCOUNT_NAME);
	return {
		siteUrl: (trim(env.SITE_URL) || origin).replace(/\/$/, ""),
		pricing: pricingRule(env.TIKTOK_FEE_BPS, env.TIKTOK_FIXED_FEE, env.PRICE_ROUNDING),
		shipping: {
			fee: num(env.SHIPPING_FEE, 30000),
			freeThreshold: num(env.FREE_SHIPPING_THRESHOLD, 150000),
			eta: trim(env.DELIVERY_ETA) || "2–5",
			parcel: parseParcel(env.PARCEL_WEIGHT_G, env.PARCEL_SIZE_CM),
			ghn: ghnConfig(env),
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
		ttl: { bank: num(env.ORDER_TTL_BANK, 360), cod: num(env.ORDER_TTL_COD, 1440) },
		sepayKey: env.SEPAY_API_KEY || null,
		turnstile:
			trim(env.TURNSTILE_SITE_KEY) && env.TURNSTILE_SECRET_KEY
				? { siteKey: trim(env.TURNSTILE_SITE_KEY), secret: env.TURNSTILE_SECRET_KEY }
				: null,
		imageResizing: trim(env.IMAGE_RESIZING) === "1",
		adminPassword: env.ADMIN_PASSWORD || null,
	};
}

/** Checkout methods in display order: COD always, VietQR once the BIDV account is set. */
export function enabledPaymentMethods(s: Settings): PaymentMethod[] {
	return ["cod", ...(s.bank ? (["vietqr"] as const) : [])];
}

export const paymentLabelsByLang: Record<Lang, Record<PaymentMethod, { title: string; hint: string }>> = {
	vi: {
		cod: { title: "Thanh toán khi nhận hàng (COD)", hint: "Trả tiền mặt cho shipper khi nhận hàng." },
		vietqr: { title: "Chuyển khoản VietQR", hint: "Quét mã QR bằng app ngân hàng bất kỳ, tiền về thẳng tài khoản BIDV của shop." },
	},
	en: {
		cod: { title: "Cash on delivery (COD)", hint: "Pay the courier in cash when your parcel arrives." },
		vietqr: {
			title: "VietQR bank transfer",
			hint: "Scan the QR code with any Vietnamese banking app; the money goes straight into the shop's BIDV account.",
		},
	},
};

/** Vietnamese labels (admin and the Vietnamese storefront). */
export const paymentLabels = paymentLabelsByLang.vi;
