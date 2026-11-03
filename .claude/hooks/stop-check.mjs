// Stop hook: before Claude finishes, run `npm run check` (typecheck, tests, browser-script syntax)
// on uncommitted code changes and send failures back so they get fixed (or reported). A change
// set that already passed is not checked again. To avoid loops, a second failure in a row is
// shown to the user instead.

import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { projectDir, readCache, readInput, writeCache } from "./lib.mjs";

const CODE = /^(src|scripts|public\/assets)\/|^(package\.json|tsconfig\.json|cloudflare\.config\.ts|vite\.config\.ts)$/;
const OUTPUT_LINES = 60;

function changedFiles(root) {
	const out = execFileSync("git", ["-C", root, "status", "--porcelain=v1", "-z", "-uall"], { encoding: "utf8" });
	const entries = out.split("\0").filter(Boolean);
	const files = [];
	for (let i = 0; i < entries.length; i++) {
		const status = entries[i].slice(0, 2);
		files.push({ status, path: entries[i].slice(3) });
		if (/[RC]/.test(status)) i++; // the next entry is the rename source
	}
	return files;
}

function fingerprint(root, files) {
	const hash = createHash("sha256");
	for (const f of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
		const abs = path.join(root, f.path);
		hash.update(`${f.status} ${f.path}\n`);
		if (existsSync(abs)) hash.update(readFileSync(abs));
	}
	return hash.digest("hex");
}

function run(command, root) {
	return new Promise((resolve) => {
		const child = spawn(command, { cwd: root, shell: true, env: { ...process.env, FORCE_COLOR: "0", CI: "1" } });
		let output = "";
		child.stdout.on("data", (d) => (output += d));
		child.stderr.on("data", (d) => (output += d));
		const timer = setTimeout(() => child.kill(), 8 * 60_000);
		child.on("close", (code) => {
			clearTimeout(timer);
			resolve({ command, code: code ?? 1, output: output.replace(/\x1b\[[0-9;]*m/g, "") });
		});
	});
}

const input = await readInput().catch(() => ({}));
const root = projectDir(input);

let files;
try {
	files = changedFiles(root).filter((f) => CODE.test(f.path));
} catch {
	process.exit(0); // not a git checkout
}
if (!files.length) process.exit(0);

const print = readCache(root, "stop-check.json", {});
const current = fingerprint(root, files);
if (print.passed === current) process.exit(0);

if (!existsSync(path.join(root, "node_modules"))) {
	process.stdout.write(JSON.stringify({ systemMessage: "[Anitoy] Checks skipped: run npm install first." }));
	process.exit(0);
}

const result = await run("npm run check", root);
if (result.code === 0) {
	writeCache(root, "stop-check.json", { passed: current, at: new Date().toISOString() });
	process.exit(0);
}

const details = `### npm run check (exit ${result.code})\n${result.output.trim().split(/\r?\n/).slice(-OUTPUT_LINES).join("\n")}`;
if (input.stop_hook_active) {
	// Already sent back once: let Claude stop, and make sure the user sees what is failing.
	process.stdout.write(JSON.stringify({ systemMessage: "[Anitoy] `npm run check` still fails on the uncommitted changes." }));
} else {
	process.stdout.write(
		JSON.stringify({
			decision: "block",
			reason:
				"[Anitoy stop check] `npm run check` fails on the uncommitted changes. Fix it, or if it cannot be fixed, " +
				`tell the user exactly what fails and why. Never skip or weaken tests to get green.\n\n${details}`,
		}),
	);
}
