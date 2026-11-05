// PostToolUse hook for file edits: after Claude changes a sensitive module, remind it which
// CLAUDE.md invariants the change touches. Each reminder is given once per file per session.

import path from "node:path";
import { projectDir, readCache, readInput, relPath, writeCache } from "./lib.mjs";

const REMINDERS = [
	[/^src\/lib\/db\.ts$/, "Database (invariants 3, 4, 11): stock moves only in placeOrder / cancelOrder / updateSku, inside one batch; saveOrder and cancelOrder keep optimistic locking on version and the last_op restock guard; migrations are append-only and new blob fields optional. Test against createTestD1()."],
	[/^src\/lib\/types\.ts$/, "Stored types (invariant 11): production rows already exist. New fields optional or defaulted; never rename or remove fields; keep personal data out of logs, lookups, feeds and JSON-LD (8)."],
	[/^src\/lib\/orders\.ts$/, "Orders (invariants 2-8): server pricing via buildQuote, atomic placeOrder, transitions through saveOrder/cancelOrder with version, append-only history, paid only for the exact verified amount, expiresAt set for pending unpaid orders and cleared on confirm/pay, spam caps intact, masked lookup."],
	[/^src\/lib\/(payments\/|money\.ts$)/, "Money and payments (invariants 1, 5, Hard rules): integer đồng; COD and VietQR to the BIDV account only, no wallets, cards or gateways; SePay Apikey + account + memo checked before any state change, amount must equal order.total, each bank transaction processed once."],
	[/^src\/lib\/quote\.ts$/, "Pricing (invariant 2): the server price is the only price charged; client prices only flag price_changed; drafts and SKUs priced 0 are unavailable."],
	[/^src\/lib\/limits\.ts$|^cloudflare\.config\.ts$/, "Limits and config (invariants 6, 7, Hard rules): keep the rate limiters, the 5-minute expiry cron and the order TTLs; public values only in text bindings, secrets via bindings.secret(); add new settings to config.ts, env.d.ts, .dev.vars.example and the README."],
	[/^src\/index\.tsx$/, "Routes (invariants 7-10): validate input with zod, rate limit endpoints that create or reveal orders, no-store + noindex for order/cart/checkout/admin/API, edgeCache only on public catalog pages, admin only under /admin and /api/admin behind adminAuth, the SePay webhook checks its Apikey before acting."],
	[/^src\/lib\/validation\.ts$/, "Validation (invariant 10): bounded lengths everywhere; order codes keep the unambiguous alphabet; provinces stay the 34 units in force since 1 July 2025."],
	[/^src\/lib\/(seo\.ts|catalog\.ts)$|^src\/data\/|^data\//, "Catalog facts (invariant 12): these reach Google Merchant Center and shoppers. Never invent prices, stock, ratings, reviews or list prices; TikTok ratings never become aggregateRating; descriptions stay plain text."],
	[/^src\/views\//, "Views (invariants 8, 12-14): descriptions render as plain text; raw HTML only for THEME_BOOT/JSON-LD in layout.tsx and the QR SVG in order.tsx; visible text in Vietnamese; check the page in the browser in at least one theme."],
	[/^public\/assets\/.*\.js$/, "Browser script (invariant 13): every value put into innerHTML goes through esc() or money(); no inline scripts (CSP); prices shown in the browser are never trusted by the server."],
	[/^scripts\/import-tiktok\.mjs$/, "Importer (Hard rules, invariant 12): reads public listing pages only, never works around TikTok security checks, keeps previous data for listings it can't read, and imports items without a listing as drafts."],
];

const input = await readInput().catch(() => ({}));
const root = projectDir(input);
const file = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
const rel = file ? relPath(path.resolve(root, file), root) : null;
const hits = rel ? REMINDERS.filter(([re]) => re.test(rel)).map(([, text]) => text) : [];

if (hits.length) {
	const cacheName = `reminders-${String(input.session_id ?? "session").replace(/[^\w-]/g, "")}.json`;
	const seen = readCache(root, cacheName, {});
	if (!seen[rel]) {
		seen[rel] = true;
		writeCache(root, cacheName, seen);
		process.stdout.write(
			JSON.stringify({
				hookSpecificOutput: {
					hookEventName: "PostToolUse",
					additionalContext: `[Anitoy] You edited ${rel}. Check before finishing:\n- ${hits.join("\n- ")}`,
				},
			}),
		);
	}
}
