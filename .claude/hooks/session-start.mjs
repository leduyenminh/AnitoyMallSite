// SessionStart hook: state the branch and who owns deploys, so the session starts on the right footing.

import { currentBranch, projectDir, readInput } from "./lib.mjs";

const input = await readInput().catch(() => ({}));
const branch = currentBranch(projectDir(input));
const context =
	`[Anitoy] ${branch ? `Current branch: ${branch}. ` : ""}This shop handles real orders and personal data: follow CLAUDE.md. ` +
	"Deploys, `cf auth` and every remote Cloudflare (D1/KV/R2) command are the user's to run; `main` has no auto-deploy, so commit or push only when asked. " +
	"Never open .dev.vars, secrets*.env or .cloudflare/state.";

process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: context } }));
