import { sha256Hex } from "./crypto";
import { log } from "./log";

// Abuse protection for the public order endpoints, in three layers:
// 1. Workers Rate Limiting bindings, per client IP and per Cloudflare location (fast, approximate);
// 2. durable limits in D1 (open orders per phone, orders per IP per hour; see orders.ts);
// 3. expiry: unconfirmed orders are cancelled on a schedule so they stop holding stock.
// Optional Turnstile on checkout adds a bot check on top.

export function clientIp(request: Request): string {
	return request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

/** IPs are personal data: only a salted hash is stored with an order. */
export async function ipHash(ip: string): Promise<string | null> {
	return ip === "unknown" ? null : (await sha256Hex(`anitoy-mall:${ip}`)).slice(0, 32);
}

/** True when the request may proceed. Fails open if the limiter itself errors. */
export async function allow(limiter: RateLimit | undefined, key: string): Promise<boolean> {
	if (!limiter) return true;
	try {
		const { success } = await limiter.limit({ key });
		if (!success) log.warn("ratelimit.blocked", { bucket: key.split(":")[0] });
		return success;
	} catch (error) {
		log.error("ratelimit.error", { error: String(error) });
		return true;
	}
}

/** Cloudflare Turnstile server-side check (Siteverify). */
export async function verifyTurnstile(secret: string, token: string | undefined, ip: string): Promise<boolean> {
	if (!token) return false;
	const body = new FormData();
	body.append("secret", secret);
	body.append("response", token);
	if (ip !== "unknown") body.append("remoteip", ip);
	try {
		const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
		const json = (await res.json()) as { success?: boolean };
		return json.success === true;
	} catch (error) {
		log.error("turnstile.error", { error: String(error) });
		return false;
	}
}
