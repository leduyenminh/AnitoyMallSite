import { bindings, defineConfig, triggers } from "cf/config";
import * as entrypoint from "./src/index.tsx" with { type: "cf-worker" };

// Storefront Worker: server-rendered pages + JSON APIs on Workers, catalog and orders in D1,
// static media from Workers Static Assets (public/), a cron that expires unconfirmed orders.
//
// Payments: cash on delivery, and VietQR transfers straight into the shop's BIDV account.
//
// Public settings are text bindings below. Secrets: ADMIN_PASSWORD is required. The SePay and
// Turnstile keys are optional (each feature turns on only when its key is present), so they are
// declared only in development, where `.dev.vars` supplies them; in production upload them with
// `cf deploy --secrets-file` (see README).

const OPTIONAL_SECRETS = ["SEPAY_API_KEY", "TURNSTILE_SECRET_KEY", "GHN_TOKEN", "GHN_WEBHOOK_SECRET"] as const;

export default defineConfig(({ mode, isPreview }) => {
	const dev = mode === "development";
	return {
		worker: {
			name: "anitoy-mall",
			compatibilityDate: "2026-10-23",
			entrypoint,
			observability: { enabled: true },
			// anitoymall.com is a zone on the same Cloudflare account; www redirects to the bare
			// domain in src/index.tsx. Development runs on localhost.
			domains: dev ? [] : ["anitoymall.com", "www.anitoymall.com"],
			env: {
				DB: bindings.d1({ name: "anitoy-mall" }),

				// Spam protection, per client IP and Cloudflare location (see src/lib/limits.ts).
				ORDER_LIMITER: bindings.rateLimit({ namespace: "1001", simple: { limit: 5, period: 60 } }),
				LOOKUP_LIMITER: bindings.rateLimit({ namespace: "1002", simple: { limit: 10, period: 60 } }),
				API_LIMITER: bindings.rateLimit({ namespace: "1003", simple: { limit: 60, period: 60 } }),

				// Public origin used for canonical URLs, the sitemap and the Merchant feed.
				// Empty in development and previews, which then use their own request origin.
				SITE_URL: bindings.text(dev || isPreview ? "" : "https://anitoymall.com"),

				// Website price = TikTok list price − TikTok's fees, from a TikTok Shop settlement
				// (10/2026): transaction fee 6% + TikTok commission 13% + Voucher Xtra 5% + affiliate
				// commission ≈3.51% = 27.51% (2751 basis points), minus the 3,000đ order processing fee,
				// rounded to the nearest 1,000đ. Taxes TikTok withholds (VAT 1%, PIT 0.5%) are owed on
				// website sales too, so they are not deducted. Applied when TikTok prices are copied into
				// the database (/admin/san-pham → "Áp dụng giá từ TikTok"); seller edits in /admin win.
				TIKTOK_FEE_BPS: bindings.text("2751"),
				TIKTOK_FIXED_FEE: bindings.text("3000"),
				PRICE_ROUNDING: bindings.text("1000"),

				// Shipping and returns, as shown on product pages and sent to Google Merchant Center.
				SHIPPING_FEE: bindings.text("30000"),
				FREE_SHIPPING_THRESHOLD: bindings.text("150000"),
				DELIVERY_ETA: bindings.text("2–5"),
				// Packed size of one item (every item weighs under 200 g; TikTok bills the box at
				// 333 g, i.e. 2,000 cm³). An order's items stack: weights add up, heights stack.
				PARCEL_WEIGHT_G: bindings.text("200"),
				PARCEL_SIZE_CM: bindings.text("20x10x10"),

				// GHN prices delivery inside Ho Chi Minh City (src/lib/shipping.ts). It turns on once
				// the GHN_TOKEN secret, the shop id (khachhang.ghn.vn → shop list) and the shop's phone
				// are set; until then, and outside HCM until Viettel Post is connected, the flat
				// SHIPPING_FEE applies. The phone is the recipient of fee previews: no order is created
				// and no customer data is sent. GHN's staging API is https://dev-online-gateway.ghn.vn.
				GHN_API_URL: bindings.text("https://online-gateway.ghn.vn"),
				GHN_SHOP_ID: bindings.text("6764257"),
				SHIP_FROM_PHONE: bindings.text("0368093125"),
				RETURN_DAYS: bindings.text("0"),

				// VietQR transfers go straight to this BIDV account (BIN 970418). Shown to paying
				// customers, so it is public. VietQR is offered once the account number and name are set.
				// Development uses an obviously fake account, so test orders never show the real one.
				BANK_BIN: bindings.text("970418"),
				BANK_NAME: bindings.text("BIDV"),
				BANK_ACCOUNT_NO: bindings.text(dev ? "1234567890" : "1440147613"),
				BANK_ACCOUNT_NAME: bindings.text(dev ? "NGUYEN VAN A" : "LE DUYEN MINH"),

				CONTACT_PHONE: bindings.text(""),
				CONTACT_EMAIL: bindings.text(""),
				CONTACT_ZALO: bindings.text(""),

				// Minutes before an unconfirmed, unpaid order is cancelled and its stock released.
				ORDER_TTL_BANK: bindings.text("360"),
				ORDER_TTL_COD: bindings.text("1440"),

				// Cloudflare Turnstile site key (public). Checkout shows the widget only when this and
				// the TURNSTILE_SECRET_KEY secret are set.
				TURNSTILE_SITE_KEY: bindings.text(""),
				// "1" serves resized images through Cloudflare Images (/cdn-cgi/image). Needs Image
				// Transformations enabled on the zone; leave "0" on workers.dev.
				IMAGE_RESIZING: bindings.text("0"),

				ADMIN_PASSWORD: bindings.secret(),
				...(dev ? Object.fromEntries(OPTIONAL_SECRETS.map((name) => [name, bindings.secret()])) : {}),
			},
			triggers: [triggers.scheduled({ schedule: "*/5 * * * *" })],
		},
	};
});
