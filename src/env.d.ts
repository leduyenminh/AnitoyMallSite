// Secrets are uploaded separately from cloudflare.config.ts (`.dev.vars` locally, `cf deploy
// --secrets-file` in production). Only ADMIN_PASSWORD is required; each optional feature turns
// on when its key exists.
interface Env {
	/** Password for /admin (user "admin"). Admin stays locked until it is set. */
	ADMIN_PASSWORD?: string;

	/** SePay webhook API key: auto-confirms VietQR transfers that land in the BIDV account. */
	SEPAY_API_KEY?: string;

	TURNSTILE_SECRET_KEY?: string;
}
