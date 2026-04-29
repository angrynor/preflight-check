# Pre-Flight Check — Build Log

Append-only chronological log of the autonomous overnight build.
Format: `## YYYY-MM-DD HH:MM UTC — CATEGORY` then a brief description.
Categories: BUILD, TEST, REVIEW, FIX, BLOCKER, DEPLOY, DECISION.

---

## 2026-04-30 17:15 UTC — BUILD
Run started. Spec read end-to-end. Pre-flight checks complete:
- Working directory: `/Users/heygavinsim/CRP PreFlight/` (empty, building directly inside)
- Node 22.14.0, npm 10.9.2 (exceeds Node 20+ requirement)
- GitHub CLI: authenticated as `angrynor` (scopes: gist, read:org, repo, workflow)
- Vercel CLI: not installed locally; using `npx vercel@latest`. Logged in as `angrynor` via device auth.
- ANTHROPIC_API_KEY: provided by Gavin, saved to `.env.local` (gitignored before any git init).

## 2026-04-30 17:16 UTC — DECISION
Build location: directly in current dir (Gavin confirmed). No `preflight-check/` subdirectory.
Rationale: keeps relative paths simple, the working dir is purpose-built for this project.

## 2026-04-30 17:16 UTC — DECISION
Vercel CLI: using `npx vercel@latest` instead of global install (npm global hit EACCES on /usr/local/lib).
Rationale: avoids sudo, keeps system clean, equivalent functionality. Logged so future agents know not to retry the global install.

## 2026-04-30 17:23 UTC — TEST
Unit tests: 71/71 passing across 8 modules (calculations, validation, prompts, cache, coins, binance, coingecko, buildPrompt).
Initial run had 1 failure: renderRiskOfficerPrompt was substituting `String(undefined)` into placeholders silently. FIXED by tightening the renderer to throw on null/undefined/empty values — bad inputs now blow up loudly rather than producing garbage prompts. (DRY: both undefined check and post-render scan are kept; Engineering preferences §2: "explicit over clever".)

## 2026-04-30 17:25 UTC — BUILD
API route `/api/risk-check` complete with: input validation, parallel Binance + CoinGecko fetch via `Promise.allSettled`, derived value computation, optional vision describeChart step, Claude streaming response. Mark-price endpoint `/api/mark-price` for form autofill.

## 2026-04-30 17:25 UTC — BUILD
UI complete: TradeForm (coin select, direction toggle, leverage slider, entry/stop/account inputs, autofill from /api/mark-price on coin change), ScreenshotUpload (drag-drop with 5MB limit), RiskReport (parses 5 sections, color-coded variants, streaming cursor, missing-section warning), Footer (with the §5.4 OMA pitch line verbatim). Brand palette per §5.4 wired into Tailwind.

## 2026-04-30 17:30 UTC — FIX
Discovered: `.env.local` was being shadowed by an empty `ANTHROPIC_API_KEY=""` in the parent shell environment (Claude Code populates this with empty values to prevent leaks). Next.js's env loader respects existing process.env vars over .env.local — so the empty value won.
Verified via `@next/env`'s loadEnvConfig: combinedEnv contained ANTHROPIC_API_KEY with length 0.
Workaround: prefix every dev/test command with `unset ANTHROPIC_API_KEY ANTHROPIC_BASE_URL`. This issue ONLY affects local dev from this specific shell. Vercel sets the var explicitly so production is unaffected. Documented in README.

## 2026-04-30 17:32 UTC — FIX
Initial Claude API call returned 404 for `claude-3-5-sonnet-20241022` — that model is retired in 2026. Bumped both vision and report models to `claude-sonnet-4-6`, current generation. Output quality verified end-to-end: 5-section report with cited live data, correct 1% sizing math, and a sharp entry-vs-mark-price call-out.

## 2026-04-30 17:33 UTC — TEST
End-to-end smoke test against localhost:3100 — POST /api/risk-check with BTC long, 10x, $76k entry, $74,480 stop, $10k account. Real Binance data, real Claude streaming. Returned all 5 expected sections in order, with citations to mark price ($75,840), funding (+0.0048%), 7-day OI change (-7.47%). Math verified: $5,000 notional / $500 margin at 1% risk on $10k. Quality: senior-trader voice, no hedging, no fluff.

## 2026-04-30 17:43 UTC — TEST
Playwright e2e suite: 6/6 passing in 1.5 minutes against localhost:3100.
- Test 1: BTC long 10x, 2% stop, $10k → 5 sections, 1% rule cited, dollar values present.
- Test 2: ETH long 25x, NO stop, $5k → 5 sections, missing-stop flagged.
- Test 3: SOL short 5x, 3% stop, $20k + synthetic candlestick chart screenshot → 5 sections, chart-derived signals (trend/support/resistance/RSI/MACD) appear in report.
- Bonus: home page renders core elements; API rejects unsupported coin; API rejects long with stop above entry.
Chart fixture: generated inline via Playwright canvas — 30 candles, dark TradingView-style background, 50-MA overlay, support ($185) + resistance ($220) lines, volume row, RSI/MACD label. Vision API recognizes it as a chart and the model weaves chart context into the warning flags / bear case as required.
