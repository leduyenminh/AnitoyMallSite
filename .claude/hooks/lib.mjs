// Shared helpers for the Claude Code hooks in this folder (see CLAUDE.md, "Harness").
// Hooks read one JSON payload on stdin and answer with JSON on stdout.

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export async function readInput() {
	const chunks = [];
	for await (const chunk of process.stdin) chunks.push(chunk);
	const text = Buffer.concat(chunks).toString("utf8").trim();
	return text ? JSON.parse(text) : {};
}

export const projectDir = (input = {}) => path.resolve(process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd());

/** Repo-relative path with forward slashes, or null when the path is outside the project. */
export function relPath(file, root) {
	if (!file) return null;
	const rel = path.relative(root, path.resolve(root, file)).replace(/\\/g, "/");
	return rel.startsWith("../") || rel === ".." || path.isAbsolute(rel) ? null : rel;
}

// Every rule that matches is collected, so a later "deny" is never hidden behind an earlier "ask".
const verdicts = { deny: [], ask: [] };
export const deny = (reason) => void verdicts.deny.push(reason);
export const ask = (reason) => void verdicts.ask.push(reason);

function emit(decision, reasons) {
	const reason = `[Anitoy guard, see CLAUDE.md] ${[...new Set(reasons)].join(" | ")}`;
	process.stdout.write(
		JSON.stringify({
			hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: decision, permissionDecisionReason: reason },
		}),
	);
}

/** Run a PreToolUse guard; a guard that crashes refuses the action instead of silently allowing it. */
export async function runGuard(body) {
	try {
		await body(await readInput());
	} catch (error) {
		deny(`The guard hook failed (${error?.message ?? error}), so this action was not allowed. Tell the user.`);
	}
	if (verdicts.deny.length) emit("deny", verdicts.deny);
	else if (verdicts.ask.length) emit("ask", verdicts.ask);
}

/** Files whose contents must never reach the model: secrets and customer data. */
export function isSensitivePath(file) {
	const normal = file.replace(/\\/g, "/");
	const base = (normal.split("/").pop() ?? "").toLowerCase();
	if (/^\.dev\.vars(\..+)?$/.test(base) && base !== ".dev.vars.example") return true;
	if (/^\.env(\..+)?$/.test(base) && base !== ".env.example") return true;
	if (/^secrets.*\.(env|json)$/.test(base)) return true;
	if (/(^|\/)\.cloudflare\/state(\/|$)/i.test(normal) || /(^|\/)\.wrangler(\/|$)/i.test(normal)) return true;
	return /\.(pem|key|p12|pfx)$/.test(base);
}

export const SENSITIVE_HINT =
	"It holds secrets or customer data (CLAUDE.md, Hard rules). Use src/lib/types.ts, the migrations in src/lib/db.ts or .dev.vars.example instead, or ask the user to look.";

export function currentBranch(root) {
	try {
		return execFileSync("git", ["-C", root, "branch", "--show-current"], { encoding: "utf8" }).trim();
	} catch {
		return "";
	}
}

const cacheDir = (root) => path.join(root, ".claude", ".cache");

export function readCache(root, name, fallback) {
	try {
		return JSON.parse(readFileSync(path.join(cacheDir(root), name), "utf8"));
	} catch {
		return fallback;
	}
}

export function writeCache(root, name, value) {
	mkdirSync(cacheDir(root), { recursive: true });
	writeFileSync(path.join(cacheDir(root), name), JSON.stringify(value));
}
