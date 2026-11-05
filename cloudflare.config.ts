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

const OPTIONAL_SECRETS = ["SEPAY_API_KEY", "TURNSTILE_SECRET_KEY"] as const;

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

				// Shipping and returns, as shown on product pages and sent to Google Merchant Center.
				SHIPPING_FEE: bindings.text("30000"),
				FREE_SHIPPING_THRESHOLD: bindings.text("150000"),
				DELIVERY_ETA: bindings.text("2–5"),
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
