// Secrets are uploaded separately from cloudflare.config.ts (`.dev.vars` locally, `cf deploy
// --secrets-file` in production). All are optional: each feature turns on when its keys exist.
interface Env {
	/** Password for /admin (user "admin"). Admin stays locked until it is set. */
	ADMIN_PASSWORD?: string;

	MOMO_PARTNER_CODE?: string;
	MOMO_ACCESS_KEY?: string;
	MOMO_SECRET_KEY?: string;

	ZALOPAY_APP_ID?: string;
	ZALOPAY_KEY1?: string;
	ZALOPAY_KEY2?: string;

	VNPAY_TMN_CODE?: string;
	VNPAY_HASH_SECRET?: string;

	/** SePay webhook API key: auto-confirms VietQR transfers that land in the BIDV account. */
	SEPAY_API_KEY?: string;

	TURNSTILE_SECRET_KEY?: string;
}
