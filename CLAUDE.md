# Mall of Anitoy storefront (Cloudflare)

Server-rendered shop on Cloudflare Workers (Hono) with D1, for the TikTok seller @leduyenminh. The catalog is cloned from its TikTok Shop listings; real customers' orders, money and personal data flow through this code, so correctness and data protection come before speed. README.md describes the architecture and setup; this file holds the rules for changing it.

## Commands

| Command | Use |
| --- | --- |
| `npm run check` | Typecheck + unit and database tests + syntax check of the browser scripts. Must pass before a change is done. |
| `npm test -- <path>` | Run one test file (vitest, `src/**/*.test.ts`). |
| `npm run dev` | Local dev server (`cf dev`, http://localhost:5173), local D1 in `.cloudflare/state/`. |
| `npx cf deploy --dry-run` | Build and validate the Worker without uploading anything. |

## Hard rules

These are enforced by hooks in `.claude/hooks/` where a check is possible. A hook block is a stop sign, not a puzzle: don't reach the same result another way (another command, an encoded path, a script that does it). Tell the user what was blocked and let them decide.

**Personal data and secrets**
- Never open, print, grep, copy or summarise `.dev.vars` (any `.dev.vars*` except `.dev.vars.example`), `.env*`, `secrets*.env`, or anything under `.cloudflare/state/` or `.wrangler/` (local D1 holds orders with names, phones and addresses). To learn a data shape, read `src/lib/types.ts` and the migrations in `src/lib/db.ts`.
- Search code with the Grep tool (it skips git-ignored files), not `grep -r` from the repo root.
- Test fixtures use obviously fake data (`0900000000`, `test@example.com`, `Nguyen Van A`, account `1234567890`). Never copy real order data into code, tests, commits or chat.
- No hard-coded secrets. Public settings are `bindings.text(...)` in `cloudflare.config.ts`. Secrets are declared with `bindings.secret()` (required ones always, optional ones only in development) and uploaded by the user with `cf deploy --secrets-file`. A new setting goes into `cloudflare.config.ts`, `src/lib/config.ts` (`settings()`), `src/env.d.ts` for secrets, `.dev.vars.example` (empty value) and the README.

**Production and the Cloudflare account**
- The user runs anything that touches the Cloudflare account: `cf deploy`, previews, versions, deployments, triggers, `cf auth`, and every `cf d1` / `kv` / `r2` command without `--local`. Never run Wrangler deploy or secret commands. `cf deploy --dry-run`, `cf workers types`, `cf cli search`, `cf schema`, `cf docs search` and `--help` are fine.
- Gateway endpoints stay on the sandbox (`test-payment.momo.vn`, `sb-openapi.zalopay.vn`, `sandbox.vnpayment.vn`) unless the user asks to go live.
- `main` has no automatic deploy. Commit or push only when the user asks; never force-push, rewrite history or use `--no-verify`.
- `npm run import` reads the live TikTok Shop and rewrites `src/data/catalog.json` and `public/media/`: ask first. Never work around TikTok's security checks or captchas.

## Domain invariants

Break one of these and the shop loses money, oversells or leaks customer data. If a request seems to need breaking one, stop and ask.

1. **Money is integer đồng.** No floats in stored or compared amounts. Format with `formatVnd` (`src/lib/money.ts`). Gateway units are converted only at the boundary in `src/lib/payments/gateways.ts` (VNPay sends amount × 100).
2. **The server prices every order.** `buildQuote` (`src/lib/quote.ts`) re-prices on every quote and again inside `createOrder`. A price sent by the client only flags `price_changed`; it is never charged. Drafts, archived products and SKUs priced 0 are not sellable.
3. **Stock moves atomically, in `src/lib/db.ts` only.** `placeOrder` inserts the order and decrements stock in one D1 batch, and `CHECK (stock >= 0)` aborts an oversell. `cancelOrder` returns stock in the same batch as the status change, guarded by a one-off `last_op` id so a lost race never restocks twice. Admin edits use `updateSku`, which applies stock as a change from the value the seller saw. Never read stock and then write it, and never `SET stock = <value read earlier>`.
4. **Order state changes only through `src/lib/orders.ts`** (`createOrder`, `recordPayment`, `recordPaymentAttempt`, `applyOrderAction`, `expireOrders`). They save through `saveOrder` / `cancelOrder` with optimistic locking on `version`, follow the `transitions` table and append to `history`. Never rewrite or drop history entries, and never write the `orders` table from anywhere else.
5. **An order is paid only after its payment was verified.** Gateway signatures (HMAC-SHA256 for MoMo and ZaloPay, HMAC-SHA512 for VNPay) are checked before anything else; SePay webhooks need the `Apikey` header, the configured BIDV account number, the order code in the memo and the exact amount. The amount must equal `order.total` (`recordPayment`). Handlers are idempotent: gateways retry, IPN and browser return both arrive, and bank transactions are claimed once in `bank_transactions`. Return-URL parameters are never trusted without the signature check.
6. **Unconfirmed orders expire.** Every pending, unpaid order gets `expiresAt` from `ttlMinutes`; confirming it or recording a payment clears it. The cron (`scheduled` in `src/index.tsx`, every 5 minutes) cancels overdue orders and releases their stock through `cancelOrder`. Paid or confirmed orders never expire. Keep the cron trigger in `cloudflare.config.ts`.
7. **Spam limits stay on.** `POST /api/orders`, the lookup, status, quote and pay endpoints call `allow()` with their rate limiter, keyed by `clientIp()`. `createOrder` also enforces `MAX_OPEN_ORDERS_PER_PHONE`, `MAX_ORDERS_PER_IP_PER_HOUR`, the honeypot field and Turnstile when configured. Don't remove or loosen these without the user's OK.
8. **Customer data stays private.** An order holds name, phone, email, address and note.
   - Log only ids, counts, statuses and amounts through `log` (`src/lib/log.ts`). Never log customer fields, whole orders, request bodies or headers. No `console.*` in `src/` outside `log.ts`.
   - Viewing an order needs its `accessToken`, compared with `safeEqual` (`getOrderForViewer`). "Tra cứu đơn hàng" (`lookupOrder`) returns masked name and phone only: never add the address, email, note or token to it.
   - Order, cart, checkout, admin and API responses are `no-store` and `noindex`, and are never put through `edgeCache` (only public catalog pages are).
   - IPs are stored only as the salted hash from `ipHash()`.
   - No personal data in JSON-LD, the Merchant feed, the sitemap or analytics.
9. **Admin is authenticated in one place.** The `adminAuth` middleware in `src/index.tsx` guards `/admin`, `/admin/*` and `/api/admin/*` with Basic auth (constant-time), and requires same-origin JSON for every mutation. `ADMIN_PASSWORD` is a required secret. Never add an admin route outside those prefixes.
10. **Public endpoints validate everything.** Parse input with zod and bounded lengths (`src/lib/validation.ts`). Errors don't reveal whether an order exists.
11. **Stored data outlives the code.** D1 schema changes only by appending a new entry to `migrations` in `src/lib/db.ts`; never edit or reorder a migration that has shipped. New fields in the JSON `data` blobs are optional or defaulted for older rows. Never rename or remove stored columns or fields without a migration plan the user approved.
12. **No invented facts.** Prices, stock, ratings, units sold and descriptions come from the TikTok import or the seller. `compareAtPrice` is only a real list price. TikTok ratings and sales are shown with "trên TikTok Shop" attribution and never become `aggregateRating` or reviews in structured data. Product descriptions are plain text and never rendered as HTML.
13. **No raw HTML from data.** `dangerouslySetInnerHTML` only for `THEME_BOOT` and JSON-LD in `src/views/layout.tsx`; `raw()` only for the generated VietQR SVG in `src/views/pages/order.tsx`. In `public/assets/*.js`, everything put into `innerHTML` goes through `esc()` (or `money()` for numbers). New inline scripts break the CSP: put code in `public/assets/`.
14. **Vietnamese UI.** Visible text is Vietnamese; amounts in VND; addresses use the 34 provinces in `provinces`.

## How to work here

1. **Understand first.** Read the module you are changing, its callers and its tests before editing. For external APIs (MoMo, ZaloPay, VNPay, SePay, TikTok, Cloudflare), follow the existing client code and the provider's docs; never guess field names or signing rules. For Cloudflare, prefer `cf cli search` / `cf docs search` over memory. If something is ambiguous, ask.
2. **Plan anything risky.** Before touching orders, payments, stock, `src/lib/db.ts`, limits, admin auth, API routes or `cloudflare.config.ts`, say which invariants above are involved and how the change keeps them.
3. **Keep changes small.** Do what was asked; no drive-by refactors, renames or reformatting. Ask before adding a dependency.
4. **Test business logic.** Add or update a vitest test next to the code for behaviour changes in `src/lib/`. Database behaviour is tested against `createTestD1()` (`src/lib/testing/d1-sqlite.mjs`, SQLite with D1 semantics), as in `orders.test.ts`. Never delete, skip (`.skip` / `.only`) or loosen a test to get green; if an expectation looks wrong, say so and ask. No `@ts-ignore` / `@ts-nocheck`.
5. **Verify.** `npm run check` must pass (the Stop hook runs it on changed code and sends failures back). For changes to orders, payments, stock, db, limits, auth, API routes or config, also run the `invariant-reviewer` agent on the diff and fix or report what it finds. For UI changes, look at the page in the browser in at least one theme.
6. **Report honestly.** Say what was verified and how, and what failed or was skipped. Never call something done if a check failed.

## Harness

`.claude/settings.json` wires these up. Change them only when the user asks; edits to them always ask for permission.

| Hook | What it does |
| --- | --- |
| `guard-bash.mjs` (PreToolUse: Bash, PowerShell) | Blocks reads of secret and customer-data files, printing secret env vars, Cloudflare deploys and remote D1/KV/R2 and account changes, Wrangler deploy/secret commands, `npm run deploy`, force pushes, `--no-verify`, `git add -f`, `git clean -x`, history rewrites and mass deletes. Asks before other Cloudflare API calls, `npm run import`, new dependencies, unknown `npx` packages, hard resets and PR merges. |
| `guard-files.mjs` (PreToolUse: file tools) | Blocks reading or searching secret and customer-data files; edits to lockfiles, build output and other sessions' worktrees; and edits that add hard-coded secrets, secret values in `cloudflare.config.ts` or `.dev.vars.example`, personal data in logs, `console.*` in `src/`, `@ts-ignore`, skipped tests, raw HTML outside the allowed places, or `edgeCache` on private routes. Asks before edits that change shipped migrations, remove rate limits or the expiry cron, or point gateways at production. |
| `review-edit.mjs` (PostToolUse: file tools) | After an edit to a sensitive module, reminds Claude of the invariants it touches (once per file per session). |
| `stop-check.mjs` (Stop) | When code changed, runs `npm run check` before Claude finishes and sends failures back. Skips a change set that already passed. |
| `session-start.mjs` (SessionStart) | States the branch and that deploys and account changes are the user's. |
| `agents/invariant-reviewer.md` | Read-only reviewer of the diff against the invariants above. |
