import { bindings, defineConfig, triggers } from "cf/config";
import * as entrypoint from "./src/index.tsx" with { type: "cf-worker" };

// Storefront Worker: server-rendered pages + JSON APIs on Workers, catalog and orders in D1,
// static media from Workers Static Assets (public/), a cron that expires unconfirmed orders.
//
// Public settings are text bindings below. Secrets: ADMIN_PASSWORD is required. The payment
// gateway, SePay and Turnstile keys are optional (each feature turns on only when its keys are
// present), so they are declared only in development, where `.dev.vars` supplies them; in
// production upload them with `cf deploy --secrets-file` (see README).

const OPTIONAL_SECRETS = [
	"MOMO_PARTNER_CODE",
	"MOMO_ACCESS_KEY",
	"MOMO_SECRET_KEY",
	"ZALOPAY_APP_ID",
	"ZALOPAY_KEY1",
	"ZALOPAY_KEY2",
	"VNPAY_TMN_CODE",
	"VNPAY_HASH_SECRET",
	"SEPAY_API_KEY",
	"TURNSTILE_SECRET_KEY",
] as const;

export default defineConfig(({ mode }) => {
	const dev = mode === "development";
	return {
		worker: {
			name: "anitoy-mall",
			compatibilityDate: "2026-10-23",
			entrypoint,
			observability: { enabled: true },
			env: {
				DB: bindings.d1({ name: "anitoy-mall" }),

				// Spam protection, per client IP and Cloudflare location (see src/lib/limits.ts).
				ORDER_LIMITER: bindings.rateLimit({ namespace: "1001", simple: { limit: 5, period: 60 } }),
				LOOKUP_LIMITER: bindings.rateLimit({ namespace: "1002", simple: { limit: 10, period: 60 } }),
				API_LIMITER: bindings.rateLimit({ namespace: "1003", simple: { limit: 60, period: 60 } }),

				// Public origin used for canonical URLs, the sitemap, feeds and payment return URLs.
				SITE_URL: bindings.text(""),

				// Shipping and returns, as shown on product pages and sent to Google Merchant Center.
				SHIPPING_FEE: bindings.text("30000"),
				FREE_SHIPPING_THRESHOLD: bindings.text("150000"),
				DELIVERY_ETA: bindings.text("2–5"),
				RETURN_DAYS: bindings.text("0"),

				// VietQR transfers go straight to this BIDV account (BIN 970418). Shown to paying
				// customers, so it is public. VietQR is offered once the account number and name are set.
				// Development uses an obviously fake account.
				BANK_BIN: bindings.text("970418"),
				BANK_NAME: bindings.text("BIDV"),
				BANK_ACCOUNT_NO: bindings.text(dev ? "1234567890" : ""),
				BANK_ACCOUNT_NAME: bindings.text(dev ? "NGUYEN VAN A" : ""),

				CONTACT_PHONE: bindings.text(""),
				CONTACT_EMAIL: bindings.text(""),
				CONTACT_ZALO: bindings.text(""),

				// Minutes before an unconfirmed, unpaid order is cancelled and its stock released.
				ORDER_TTL_ONLINE: bindings.text("30"),
				ORDER_TTL_BANK: bindings.text("360"),
				ORDER_TTL_COD: bindings.text("1440"),

				// Gateway endpoints default to each provider's sandbox. Switch to production when going live.
				MOMO_ENDPOINT: bindings.text("https://test-payment.momo.vn"),
				ZALOPAY_ENDPOINT: bindings.text("https://sb-openapi.zalopay.vn"),
				VNPAY_PAY_URL: bindings.text("https://sandbox.vnpayment.vn/paymentv2/vpcpay.html"),

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
