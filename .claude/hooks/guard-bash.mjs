// PreToolUse guard for Bash and PowerShell commands: keeps secrets and customer data out of reach,
// leaves the Cloudflare account and deploys to the user, and protects git history.
// See CLAUDE.md, "Hard rules".

import { existsSync } from "node:fs";
import path from "node:path";
import { ask, deny, projectDir, runGuard, SENSITIVE_HINT } from "./lib.mjs";

const SENSITIVE_IN_COMMAND = [
	/(^|[\s'"=:(/])\.dev\.vars(\.(?!example\b)[\w.-]+)?(?=$|[\s'";|&)<>,])/i,
	/(^|[\s'"=:(/])\.env(\.(?!example\b)[\w.-]+)?(?=$|[\s'";|&)<>,])/i,
	/(^|[\s'"=:(/])secrets[\w.-]*\.(env|json)\b/i,
	/\.cloudflare\/state\b/i,
	/(^|[\s'"=:(/])\.wrangler(?=$|[/\s'";|&)<>,])/i,
	/\.(pem|p12|pfx)\b/i,
];

// Printing environment variables that hold credentials.
const SECRET_ENV = /\$(\{|env:)?\w*(SECRET|PASSWORD|TOKEN|ACCESS_KEY|HASH|KEY1|KEY2|PRIVATE|API_KEY)\w*/i;
const ENV_DUMP = /^\s*(printenv|env|set|export\s+-p|(Get-ChildItem|gci|dir|ls)\s+env:)\s*$/i;

/** Split on shell operators so each command can be checked on its own. */
const segmentsOf = (command) => command.split(/&&|\|\||[;|\n]/).map((s) => s.trim()).filter(Boolean);

const words = (s) => (s.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((t) => t.replace(/^["']|["']$/g, ""));

/** Arguments after `git <sub>`, skipping git's own options such as `-C dir`. */
function gitArgs(segment) {
	const tokens = words(segment);
	const start = tokens.findIndex((t) => /^git(\.exe)?$/i.test(t));
	if (start < 0) return null;
	let i = start + 1;
	while (i < tokens.length && tokens[i].startsWith("-")) i += /^(-C|-c|--git-dir|--work-tree)$/.test(tokens[i]) ? 2 : 1;
	return { sub: tokens[i], args: tokens.slice(i + 1) };
}

function checkGit(segment) {
	const git = gitArgs(segment);
	if (!git?.sub) return;
	const { sub, args } = git;
	const has = (...flags) => args.some((a) => flags.includes(a));
	const shortFlag = (letter) => args.some((a) => /^-[a-zA-Z]+$/.test(a) && a.includes(letter));

	if (has("--no-verify")) deny("`--no-verify` skips the repository's git hooks. Fix what the hook reports instead.");
	if (sub === "push") {
		if (has("--force", "--mirror", "--all") || shortFlag("f") || args.some((a) => a.startsWith("+"))) {
			deny("Force, mirror and push-all are not allowed. Push normally, or ask the user.");
		}
		if (has("--force-with-lease", "--delete") || shortFlag("d")) ask("This rewrites or deletes a remote branch.");
	}
	if (sub === "add" && (has("--force") || shortFlag("f"))) {
		deny("`git add --force` adds ignored files, which here are secrets (.dev.vars, secrets*.env) and the local database.");
	}
	if (sub === "clean") {
		if (shortFlag("x") || shortFlag("X")) deny("`git clean -x` deletes ignored files, including .dev.vars and the local database.");
		if (shortFlag("f") || has("--force")) ask("`git clean -f` permanently deletes untracked files.");
	}
	if (sub === "reset" && has("--hard")) ask("`git reset --hard` discards uncommitted work.");
	if ((sub === "checkout" || sub === "restore") && args.some((a) => a === "." || a === ":/") && !has("--staged")) {
		ask("This discards uncommitted changes to the working tree.");
	}
	if (sub === "stash" && /^(drop|clear)$/.test(args[0] ?? "")) ask("This permanently deletes stashed work.");
	if (sub === "branch" && (has("-D") || (has("--delete") && has("--force")))) ask("This force-deletes a local branch.");
	if (sub === "commit" && has("--amend")) ask("Amending rewrites the last commit; prefer a new commit.");
	if (sub === "rebase" || sub === "filter-branch" || sub === "filter-repo") deny("History rewriting is not allowed here. Ask the user.");
}

const PROTECTED_DIRS = /^(\/|~|\.|\.\.|\*|\.\/\*|\.git|src|public|data|scripts|\.claude|\$HOME|~\/|[a-z]:\/?|\/[a-z])$/i;

/** True when deleting `target` would remove the project or one of its top-level source folders. */
function isProtectedTarget(target, root) {
	const t = target.replace(/\\/g, "/").replace(/(.)\/+$/, "$1");
	if (PROTECTED_DIRS.test(t)) return true;
	// Absolute paths (C:/x or Git Bash's /c/x): protect the project root and every folder above it.
	const abs = t.replace(/^\/([a-z])(\/|$)/i, "$1:/");
	if (!/^[a-z]:\//i.test(abs)) return false;
	const rootPath = root.replace(/\\/g, "/").toLowerCase();
	const candidate = abs.toLowerCase().replace(/\/$/, "");
	return rootPath === candidate || rootPath.startsWith(`${candidate}/`);
}

function checkDelete(segment, root) {
	const rm = segment.match(/^\s*(sudo\s+)?rm\s+(.*)$/i);
	const ps = segment.match(/^\s*(Remove-Item|ri|rmdir|rd|del|erase)\s+(.*)$/i);
	let targets = [];
	if (rm) {
		const tokens = words(rm[2]);
		if (!tokens.some((t) => /^-[a-zA-Z]*[rR]/.test(t) || t === "--recursive")) return;
		targets = tokens.filter((t) => t && !t.startsWith("-"));
	} else if (ps && /(^|\s)(-Recurse\b|\/s\b)/i.test(ps[2])) {
		targets = words(ps[2]).filter((t) => !t.startsWith("-") && !/^\/[a-z?]$/i.test(t));
	} else return;
	if (targets.some((t) => isProtectedTarget(t, root))) deny(`Refusing a recursive delete of ${targets.join(" ")}.`);
	else if (targets.some((t) => /^(\.\/)?\.cloudflare\/?$/.test(t.replace(/\\/g, "/")))) ask("This deletes the local database and build output in .cloudflare/.");
}

// cf subcommands that never reach the Cloudflare API or only change local files.
const CF_LOCAL = /^(dev|build|cli|docs|schema)$/;
const CF_MUTATING =
	/^(deploy|delete|create|update|edit|put|apply|raw|query|rollback|purge|bulk|undelete|patch|set|remove|import|upload|restore|time-travel|previews|versions|deployments|triggers|secrets?|login|logout|migrate|init)$/;

/** `cf …` / `cloudflare …` / `npx cf …` / `npm exec cf …`, as words after the CLI name. */
function cfArgs(segment) {
	const tokens = words(segment);
	let i = 0;
	while (i < tokens.length && /^\w+=/.test(tokens[i])) i++; // VAR=value prefixes
	if (/^(npx|pnpx|bunx)(\.cmd)?$/i.test(tokens[i] ?? "")) i++;
	else if (/^(npm|pnpm)(\.cmd)?$/i.test(tokens[i] ?? "") && tokens[i + 1] === "exec") i += 2;
	while (i < tokens.length && tokens[i].startsWith("-")) i++;
	if (!/^(cf|cloudflare)(@[\w.-]+)?(\.cmd)?$/i.test(tokens[i] ?? "")) return null;
	return tokens.slice(i + 1);
}

function checkCloudflare(segment) {
	const args = cfArgs(segment);
	if (args) {
		const flags = args.filter((a) => a.startsWith("-"));
		const subs = args.filter((a) => !a.startsWith("-"));
		const [first = "", second = ""] = subs;
		if (flags.some((f) => /^(--help|-h|--version|-v)$/.test(f)) || flags.includes("--dry-run")) return;
		if (CF_LOCAL.test(first) || (first === "workers" && /^(types|check)$/.test(second)) || (first === "auth" && second === "whoami")) return;
		if (flags.includes("--local")) return;
		if (first === "deploy" || (first === "auth" && /^(login|logout)$/.test(second))) {
			deny("Deploys and Cloudflare sign-in are run by the user. Give them the command (e.g. `npx cf deploy --secrets-file …`).");
			return;
		}
		if (subs.some((s) => CF_MUTATING.test(s))) {
			deny(`\`cf ${subs.join(" ")}\` changes the Cloudflare account or production data. Give the user the command to run instead.`);
			return;
		}
		ask(`\`cf ${subs.join(" ")}\` calls the Cloudflare API on the user's account.`);
		return;
	}
	const wrangler = segment.match(/\bwrangler(\.cmd)?\s+(\S+)(.*)$/i);
	if (wrangler) {
		const sub = wrangler[2].toLowerCase();
		const rest = wrangler[3] ?? "";
		if (/^(--version|-v|--help|-h|types|dev)$/.test(sub) || /--local\b/.test(rest)) return;
		if (sub === "tail") ask("`wrangler tail` streams production logs.");
		else deny("This project uses the cf CLI, and Wrangler commands that reach the account (deploy, secret, d1, kv, r2, versions…) are run by the user.");
	}
	if (/\bapi\.cloudflare\.com\b/i.test(segment)) ask("This calls the Cloudflare API directly.");
}

function checkGitHub(segment) {
	if (/\bgh\s+(workflow\s+run|secret\b|variable\s+(set|delete)|repo\s+(delete|edit|rename|archive)|release\s+delete)/i.test(segment)) {
		deny("This changes the GitHub repository's settings, secrets or workflows. Ask the user.");
	}
	if (/\bgh\s+pr\s+merge\b/i.test(segment)) ask("Merging a pull request into main.");
}

function checkPackages(segment, root) {
	const tokens = segment.trim().split(/\s+/);
	if (/^(npm|pnpm|yarn)(\.cmd)?$/i.test(tokens[0] ?? "")) {
		let i = 1;
		while (i < tokens.length && tokens[i].startsWith("-")) i += /^(--prefix|-C|--dir|--cwd)$/.test(tokens[i]) ? 2 : 1;
		const sub = tokens[i] ?? "";
		const rest = tokens.slice(i + 1);
		const packages = rest.filter((t) => !t.startsWith("-"));
		if (/^publish$/i.test(sub)) deny("This package is private and must not be published.");
		if (/^(run|run-script)$/i.test(sub)) {
			if (/^deploy$/.test(rest[0] ?? "")) deny("Deploys are run by the user.");
			if (/^import$/.test(rest[0] ?? "")) {
				ask("`npm run import` reads the live TikTok Shop and rewrites src/data/catalog.json and public/media/.");
			}
		}
		if (/^(install|i|add|isntall)$/i.test(sub) && packages.length) {
			ask(`Adding or changing dependencies (${packages.join(", ")}) needs the user's OK.`);
		}
		if (/^(uninstall|remove|rm|un|update|upgrade|up)$/i.test(sub)) ask("Removing or upgrading dependencies needs the user's OK.");
		if (/^audit$/i.test(sub) && rest.includes("--force")) ask("`npm audit fix --force` can install breaking major versions.");
	}
	if (/node\b.*scripts[/\\]import-tiktok\.mjs/.test(segment)) {
		ask("The importer reads the live TikTok Shop and rewrites src/data/catalog.json and public/media/.");
	}
	// npx downloads and runs any package that is not installed locally.
	if (/^npx(\.cmd)?$/i.test(tokens[0] ?? "")) {
		const name = tokens.slice(1).find((t) => !t.startsWith("-"));
		const bin = name?.replace(/^(@[^/]+\/)?([^@]+).*$/, "$2");
		if (name && !(bin && existsSync(path.join(root, "node_modules", ".bin", bin)))) ask(`npx would download and run "${name}" from the npm registry.`);
	}
}

await runGuard(async (input) => {
	const command = String(input.tool_input?.command ?? "");
	if (!command.trim()) return;
	const root = projectDir(input);
	const normal = command.replace(/\\/g, "/");

	if (SENSITIVE_IN_COMMAND.some((re) => re.test(normal))) {
		deny(`This command touches a protected file (.dev.vars, .env*, secrets*.env, .cloudflare/state, .wrangler or a key). ${SENSITIVE_HINT}`);
	}
	if (SECRET_ENV.test(command)) deny("This command reads an environment variable that holds a credential. Don't print secrets.");
	if (/(curl|wget|iwr|irm|Invoke-WebRequest|Invoke-RestMethod)\b[^|]*\|\s*(sh|bash|zsh|iex|Invoke-Expression|node|python)\b/i.test(command)) {
		deny("Piping a download into an interpreter runs untrusted code.");
	}

	for (const segment of segmentsOf(command)) {
		if (ENV_DUMP.test(segment)) deny("Dumping the environment can print credentials.");
		checkCloudflare(segment);
		checkGitHub(segment);
		checkGit(segment);
		checkDelete(segment.replace(/\\/g, "/"), root);
		checkPackages(segment, root);
	}
});
