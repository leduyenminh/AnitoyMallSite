// Secrets are uploaded separately from cloudflare.config.ts (`.dev.vars` locally, `cf deploy
// --secrets-file` in production). Only ADMIN_PASSWORD is required; each optional feature turns
// on when its key exists.
interface Env {
	/** Password for /admin (user "admin"). Admin stays locked until it is set. */
	ADMIN_PASSWORD?: string;

	/** SePay webhook API key: auto-confirms VietQR transfers that land in the BIDV account. */
	SEPAY_API_KEY?: string;

	TURNSTILE_SECRET_KEY?: string;

	/** GHN API token (khachhang.ghn.vn): books Ho Chi Minh City parcels from /admin and checks HCM wards at checkout. */
	GHN_TOKEN?: string;

	/** Random value GHN sends as the X-Webhook-Token header of order status callbacks. */
	GHN_WEBHOOK_SECRET?: string;
}
