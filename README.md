# Pre-Flight Check

Pre-trade risk officer for crypto perp traders. Submit a trade, get a 5-section structured risk report with live market data and proper position sizing math. Streamed from Claude.

Built for the Crypto Rocket Profits community retreat (May 2-3, 2026).

## What it does

You enter a trade (coin, direction, leverage, entry, stop, account size, optional chart screenshot). The server:

1. Validates input
2. Pulls live data from Binance Futures (mark price, funding, open interest, klines) and CoinGecko (BTC dominance) in parallel
3. Computes liquidation price, distance to stop, notional position size, proper-size-at-1% rule
4. If a chart was uploaded, sends it to Claude vision and extracts timeframe/trend/levels
5. Streams a structured report back: bull case, bear case, three warning flags, proper position sizing, three exit triggers

Voice is firm and protective — no cheerleading, no hedging, citations only.

## Stack

- Next.js 14 (App Router)
- TypeScript strict mode
- Tailwind CSS
- @anthropic-ai/sdk (streaming)
- Vitest (unit) + Playwright (e2e)
- Vercel for hosting

## Setup

```bash
npm install
cp .env.local.example .env.local
# put your real key in .env.local
npm run dev
# open http://localhost:3000
```

You need an Anthropic API key from https://console.anthropic.com/.

## Scripts

```bash
npm run dev          # dev server
npm run build        # production build
npm run start        # serve production build
npm run typecheck    # tsc --noEmit
npm test             # unit tests (vitest)
npm run test:watch   # unit tests in watch mode
npm run test:e2e     # Playwright tests against running dev server
```

### Watching e2e tests in a real browser

By default Playwright runs Chrome Headless Shell — the test invisibly drives the page. To **see** the browser drive the form on your desktop:

```bash
npm run dev   # in one tab
npx playwright test --headed --project=chromium    # in another tab
```

Add `--debug` to step through one assertion at a time.

## Deploy

Set `ANTHROPIC_API_KEY` in Vercel project settings, push to the connected GitHub repo, done.

## Project structure

```
app/                       # Next.js App Router
  api/risk-check/route.ts  # main API endpoint (streams)
  api/mark-price/route.ts  # autofill helper
  page.tsx, layout.tsx, globals.css
components/                # TradeForm, ScreenshotUpload, RiskReport, Footer
lib/                       # binance, coingecko, claude, prompts, calculations,
                           # cache, http, validation, marketSnapshot, buildPrompt,
                           # coins, types, constants
tests/
  unit/                    # 71 vitest unit tests
  e2e/                     # 6 Playwright tests + chart fixture helper
```

## Notes

- Brand palette is locked. Black background, electric cyan accent, emerald bull, red bear, amber warn.
- The footer pitch line is intentional — it's the soft funnel into the OMA preview event.
- The system prompt is locked verbatim per spec §6.1; do not edit the wording.
- All external API calls have a 60s in-memory TTL cache and one-shot retry on 429/5xx.
- If Binance is down, mark price falls back to CoinGecko. If both are down, the request fails clearly.
- If chart vision fails, the report still streams — the chart was a bonus, not a blocker.

## Troubleshooting

**Local dev: `ANTHROPIC_API_KEY is not set` even though it's in `.env.local`.**
Some shells (Claude Code, certain CI runners) export `ANTHROPIC_API_KEY=""` (empty). Next.js's env loader respects existing env vars over `.env.local`, so the empty value wins. Fix: `unset ANTHROPIC_API_KEY` before `npm run dev`. On Vercel this never happens — Vercel sets the var explicitly.

**Tests pass locally but fail on the deployed URL.**
Confirm `ANTHROPIC_API_KEY` is set in Vercel project settings (Settings → Environment Variables). Then redeploy — Vercel does not retroactively apply env vars to existing builds.

## License

Private. Demo project.
