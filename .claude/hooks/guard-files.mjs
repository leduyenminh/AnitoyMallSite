// PreToolUse guard for file tools (Read, Grep, Edit, Write, MultiEdit, NotebookEdit): keeps secrets
// and customer data out of reach and refuses edits that break the rules in CLAUDE.md.
// Content rules look at what the edit adds (or removes), so existing code never blocks an unrelated edit.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { ask, deny, isSensitivePath, projectDir, relPath, runGuard, SENSITIVE_HINT } from "./lib.mjs";

const CODE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const TEST = /(\.test\.(ts|tsx|js|mjs)$)|(^|\/)__tests__\/|^src\/lib\/testing\//;

const GENERATED = [
	[/^package-lock\.json$/, "The lockfile changes only through npm install/uninstall."],
	[/^(node_modules|\.cloudflare|dist|coverage)\//, "Build output, generated types and dependencies are generated."],
];

const HARD_SECRETS = [
	/\b(AKIA|ASIA)[0-9A-Z]{16}\b/,
	/-----BEGIN [A-Z ]*PRIVATE KEY-----/,
	/\b(ghp_[A-Za-z0-9]{36}|gho_[A-Za-z0-9]{36}|github_pat_\w{20,}|xox[abprs]-[\w-]{10,}|sk-ant-[\w-]{20,}|sk_live_\w{10,})/,
	/\bAuthorization["']?\s*[:=]\s*["'`](Apikey|Bearer|Basic)\s+[^"'`\s$]{8,}/i,
];
const SECRET_ASSIGNMENT =
	/\b(secret|password|passwd|api_?key|access_?key|secret_?key|hash_?secret|app_?secret|client_?secret|private_?key|key1|key2|token)\w*["']?\s*[:=]\s*["'`][^"'`\s]{8,}["'`]/i;
// Secret-looking names given a literal value in cloudflare.config.ts (public settings only there).
const SECRET_TEXT_BINDING = /\b(?!\w*SITE_KEY\b)(\w*(SECRET|PASSWORD|TOKEN|API_KEY|ACCESS_KEY|HASH|KEY1|KEY2|PRIVATE)\w*)\s*:\s*bindings\.text\(\s*(?!["']["'])/;

const LOG_CALL = /\b(log\.(info|warn|error)|console\.(log|info|warn|error|debug|trace))\s*\(/g;
const PII_KEYS =
	"customer|name|phone|email|address|street|ward|province|note|accessToken|token|ip|userAgent|headers|authorization|cookie|password|secret|body|order|input|payload|raw|req|request|tx|content|description|memo";
const PII_ARG = new RegExp(`(^|[{,(\\s])\\s*(\\.\\.\\.\\s*)?(${PII_KEYS})\\s*(?=[,}:)]|$)`, "m");
const PII_MEMBER = /\.(customer|phone|email|address|accessToken|note|street|ward|content|description)\b|\bheader\s*\(|\bheaders\.get\s*\(|\bjson\s*\(\s*\)/;

// Vietnamese and English (/en) order, cart and checkout pages, admin and the APIs.
const PRIVATE_ROUTE = /app\.(get|post|all|use)\(\s*["'`]\/(don-hang|admin|thanh-toan|gio-hang|api\/|en\/(cart|checkout|orders)\b)/;
// The shop takes COD and VietQR to its BIDV account only (CLAUDE.md, Hard rules).
const GATEWAY = /\b(momo|zalopay|zalo_?pay|vnpay|vnpayment|payoo|onepay|stripe|paypal|napas_?card|card)\b|MOMO_|ZALOPAY_|VNPAY_/i;
const PAYMENT_METHOD_LINE = /PaymentMethod\s*=|paymentMethod:\s*z\.enum|enabledPaymentMethods/;

/** File content after the edit, or null when it cannot be reconstructed. */
function contentAfter(tool, input, file) {
	if (tool === "Write") return String(input.content ?? "");
	if (tool === "NotebookEdit" || !existsSync(file)) return null;
	let text = readFileSync(file, "utf8");
	const edits = tool === "MultiEdit" ? (input.edits ?? []) : [input];
	for (const e of edits) {
		if (e.old_string == null || !text.includes(e.old_string)) return null;
		text = e.replace_all ? text.split(e.old_string).join(e.new_string ?? "") : text.replace(e.old_string, () => e.new_string ?? "");
	}
	return text;
}

/** Lines present on one side of the edit and not the other (trimmed, multiset difference). */
function lineDiff(tool, input, file, after) {
	const count = (lines) => lines.reduce((m, l) => m.set(l, (m.get(l) ?? 0) + 1), new Map());
	let before = "";
	let now = after ?? "";
	if (tool === "Edit" || tool === "MultiEdit") {
		const edits = tool === "MultiEdit" ? (input.edits ?? []) : [input];
		before = edits.map((e) => e.old_string ?? "").join("\n");
		now = edits.map((e) => e.new_string ?? "").join("\n");
	} else if (tool === "Write" && existsSync(file)) {
		before = readFileSync(file, "utf8");
	} else if (tool === "NotebookEdit") {
		now = String(input.new_source ?? "");
	}
	const split = (t) => t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
	const minus = (a, b) => {
		const left = count(b);
		return a.filter((l) => {
			const n = left.get(l) ?? 0;
			if (n > 0) {
				left.set(l, n - 1);
				return false;
			}
			return true;
		});
	};
	const b = split(before);
	const a = split(now);
	return { added: minus(a, b), removed: minus(b, a) };
}

/** Arguments of every log/console call in `text`, with the source they span. */
function logCalls(text) {
	const calls = [];
	for (const match of text.matchAll(LOG_CALL)) {
		let depth = 1;
		let i = match.index + match[0].length;
		const start = i;
		while (i < text.length && depth > 0 && i - start < 4000) {
			const c = text[i];
			if (c === '"' || c === "'" || c === "`") {
				const close = text.indexOf(c, i + 1);
				i = close < 0 ? text.length : close;
			} else if (c === "(") depth++;
			else if (c === ")") depth--;
			i++;
		}
		calls.push({ callee: match[1], source: text.slice(match.index, i), args: text.slice(start, i - 1) });
	}
	return calls;
}

const stripQuoted = (s) => s.replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, '""');
const countOf = (text, needle) => (text ? text.split(needle).length - 1 : 0);

/** The text of the `migrations` array in src/lib/db.ts. */
function migrationsBlock(text) {
	const start = text?.indexOf("const migrations");
	if (start == null || start < 0) return null;
	const end = text.indexOf("\n];", start);
	return end < 0 ? null : text.slice(start, end).trimEnd();
}

function checkContent(rel, tool, input, file) {
	const before = existsSync(file) ? readFileSync(file, "utf8") : "";
	const after = contentAfter(tool, input, file);
	const { added, removed } = lineDiff(tool, input, file, after);
	const addedText = added.join("\n");
	const removedText = removed.join("\n");
	const isCode = CODE.test(rel);
	const isTest = TEST.test(rel);
	const inSrc = rel.startsWith("src/");

	// ---- secrets
	if (HARD_SECRETS.some((re) => re.test(addedText))) deny("The edit adds what looks like a real credential. Secrets are uploaded by the user, never committed.");
	if (isCode && !isTest && SECRET_ASSIGNMENT.test(addedText)) {
		deny("The edit hard-codes a secret-like value. Declare it with bindings.secret() and read it from env (CLAUDE.md, Hard rules).");
	}
	if (rel === "cloudflare.config.ts" && added.some((l) => SECRET_TEXT_BINDING.test(l))) {
		deny("cloudflare.config.ts is committed and its text bindings are public. Declare secrets with bindings.secret() instead.");
	}
	if (/^\.dev\.vars\.example$|^\.env\.example$/.test(rel) && added.some((l) => /^[A-Z0-9_]+=\S/.test(l))) {
		deny(`${rel} is committed: leave every value empty.`);
	}
	if (rel === ".gitignore" && removed.some((l) => /dev\.vars|\.env|secrets|\.cloudflare|\.wrangler/.test(l))) {
		ask(".gitignore: this stops ignoring secrets or the local database.");
	}

	// ---- code hygiene
	if (isCode && /@ts-(ignore|nocheck)\b/.test(addedText)) deny("Fix the type error instead of adding @ts-ignore / @ts-nocheck.");
	if (isTest && /\b(it|test|describe)\.(only|skip)\s*\(|\bx(it|describe)\s*\(/.test(addedText)) {
		deny("Don't skip or focus tests. Make them pass, or tell the user why an expectation is wrong.");
	}
	if (isTest && removed.some((l) => /\bexpect\(/.test(l)) && !added.some((l) => /\bexpect\(/.test(l))) {
		ask("The edit removes test assertions without adding any. Never loosen tests to get green.");
	}

	// Does the edit add any line of `source`? Lines need real content, so an added "});" doesn't tie
	// the edit to every call that contains one.
	const meaningful = (l) => l.length >= 6 && /[A-Za-z]/.test(l);
	const touches = (source) => {
		const lines = source.split(/\r?\n/).map((l) => l.trim()).filter(meaningful);
		return added.filter(meaningful).some((a) => lines.some((l) => a.includes(l) || l.includes(a)));
	};

	if (inSrc && isCode && !isTest && after != null) {
		for (const call of logCalls(after)) {
			if (!touches(call.source)) continue;
			if (call.callee.startsWith("console") && rel !== "src/lib/log.ts") {
				deny("Use `log` from src/lib/log.ts (structured JSON logs) instead of console.* in src/.");
			}
			const args = stripQuoted(call.args);
			if (PII_ARG.test(args) || PII_MEMBER.test(args)) {
				deny(
					`This log call may write personal data or a whole object: ${call.source.replace(/\s+/g, " ").slice(0, 160)}. ` +
						"Log ids, counts, statuses and amounts only (CLAUDE.md invariant 8).",
				);
			}
		}
		if (/dangerouslySetInnerHTML/.test(addedText) && rel !== "src/views/layout.tsx") {
			deny("No dangerouslySetInnerHTML outside the theme script and JSON-LD in src/views/layout.tsx (CLAUDE.md invariant 13).");
		}
		if (/\braw\s*\(|from\s+["']hono\/html["']/.test(addedText) && rel !== "src/views/pages/order.tsx") {
			deny("raw() HTML is only allowed for the generated VietQR SVG in src/views/pages/order.tsx (CLAUDE.md invariant 13).");
		}
	}

	// ---- browser scripts
	if (/^public\/assets\/.*\.js$/.test(rel) && added.some((l) => /\.(innerHTML|outerHTML)\s*[+]?=|insertAdjacentHTML/.test(l) && /\$\{(?!\s*(esc|money)\()/.test(l))) {
		ask("This puts interpolated values into innerHTML. Wrap every value in esc() (or money() for amounts) (CLAUDE.md invariant 13).");
	}

	// ---- routes, limits, caching
	if (rel === "src/index.tsx") {
		if (added.some((l) => PRIVATE_ROUTE.test(l) && /edgeCache/.test(l))) {
			deny("Order, cart, checkout, admin and API routes must never be edge-cached (CLAUDE.md invariant 8).");
		}
		if (after != null && countOf(after, "allow(c.env.") < countOf(before, "allow(c.env.")) {
			ask("The edit removes a rate limit from a public endpoint (CLAUDE.md invariant 7).");
		}
		if (after != null && countOf(after, "adminAuth") < countOf(before, "adminAuth")) {
			ask("The edit removes an adminAuth guard (CLAUDE.md invariant 9).");
		}
		if (removed.some((l) => /expireOrders/.test(l)) && !added.some((l) => /expireOrders/.test(l))) {
			ask("The edit removes the order-expiry cron handler (CLAUDE.md invariant 6).");
		}
	}
	if (rel === "src/lib/orders.ts" && removed.some((l) => /MAX_OPEN_ORDERS_PER_PHONE|MAX_ORDERS_PER_IP_PER_HOUR|website\)|verifyHuman/.test(l))) {
		ask("The edit changes the per-phone / per-IP order caps, the honeypot or the Turnstile check (CLAUDE.md invariant 7).");
	}
	if (rel === "cloudflare.config.ts") {
		if (removed.some((l) => /rateLimit\(|triggers\.scheduled|ORDER_TTL_/.test(l))) {
			ask("The edit changes a rate limiter, the expiry cron or an order TTL (CLAUDE.md invariants 6 and 7).");
		}
		if (removed.some((l) => /BANK_(ACCOUNT_NO|ACCOUNT_NAME|BIN)\s*:/.test(l))) {
			ask("The edit changes the BIDV account that receives customers' VietQR transfers. Only the user decides this.");
		}
	}
	const configCode = (inSrc && isCode && !isTest) || rel === "cloudflare.config.ts";
	if (configCode && added.some((l) => GATEWAY.test(l) && (PAYMENT_METHOD_LINE.test(l) || /payments?\//.test(rel) || /\bsecret\(|ENDPOINT|PAY_URL|MOMO_|ZALOPAY_|VNPAY_/.test(l)))) {
		ask("The edit looks like it adds a wallet, card or payment gateway. The shop takes only COD and VietQR to its BIDV account (CLAUDE.md, Hard rules).");
	}
	if (/^src\/lib\/(types|validation)\.ts$/.test(rel) && added.some((l) => PAYMENT_METHOD_LINE.test(l) && /["'](?!cod["']|vietqr["'])[a-z_]+["']/.test(l.replace(/^[^=:(]*[=:(]/, "")))) {
		ask("The edit adds a payment method other than COD and VietQR (CLAUDE.md, Hard rules).");
	}

	// ---- stored data
	if (rel === "src/lib/db.ts" && after != null) {
		const was = migrationsBlock(before);
		const now = migrationsBlock(after);
		if (was && (!now || !now.startsWith(was.replace(/\s*$/, "")))) {
			ask("The edit changes a shipped D1 migration. Migrations are append-only: add a new entry instead (CLAUDE.md invariant 11).");
		}
	}
	if (rel === "src/lib/types.ts" && removed.some((l) => /^\w+\??:/.test(l))) {
		ask("The edit removes or renames a stored field. Older rows still have it (CLAUDE.md invariant 11).");
	}
}

await runGuard(async (input) => {
	const tool = input.tool_name;
	const ti = input.tool_input ?? {};
	const root = projectDir(input);

	if (tool === "Grep") {
		const target = [ti.path, ti.glob].filter(Boolean).join(" ");
		if (target && (isSensitivePath(ti.path ?? "") || /\.dev\.vars(?!\.example)|\.env(?!\.example)|secrets[\w.-]*\.env|\.cloudflare[/\\]state|\.wrangler/.test(target))) {
			deny(`Searching ${target} is not allowed. ${SENSITIVE_HINT}`);
		}
		return;
	}

	const file = ti.file_path ?? ti.notebook_path;
	if (!file) return;
	const abs = path.resolve(root, file);
	if (isSensitivePath(abs)) deny(`${path.basename(abs)} is protected. ${SENSITIVE_HINT}`);
	if (tool === "Read") return;

	// Another session's worktree under .claude/worktrees belongs to that session.
	const worktree = abs.replace(/\\/g, "/").match(/^(.*\/\.claude\/worktrees\/[^/]+)(\/|$)/i);
	const rootNormal = root.replace(/\\/g, "/").toLowerCase();
	if (worktree && !rootNormal.startsWith(worktree[1].toLowerCase())) {
		deny(`${worktree[1]} is another session's git worktree. Edit files in this session's checkout only.`);
	}

	const rel = relPath(abs, root);
	if (!rel) return;
	for (const [re, why] of GENERATED) if (re.test(rel)) deny(`${rel}: ${why}`);
	checkContent(rel, tool, ti, abs);
});
