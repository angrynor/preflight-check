import { expect, test } from "@playwright/test";
import {
  expectAllSectionsInOrder,
  fillCommonFields,
  generateCandlestickChart,
  getEntryPrice,
  setStopRelative,
  waitForAllSections
} from "./helpers";

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (err) => {
    console.error("[browser] pageerror:", err);
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") console.error("[browser console] error:", msg.text());
  });
});

test("Test 1: BTC long 10x with 2% stop, $10k account", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Pre-Flight Check" })).toBeVisible();

  await fillCommonFields(page, {
    coin: "BTC",
    direction: "long",
    leverage: 10,
    accountSize: 10_000
  });

  const entry = await getEntryPrice(page);
  expect(entry).toBeGreaterThan(0);
  await setStopRelative(page, entry, 2, "below");

  await page.getByRole("button", { name: /Run my Pre-Flight Check/i }).click();

  const text = await waitForAllSections(page);
  expectAllSectionsInOrder(text);

  // The 1% rule on a $10k account at a 2% stop yields $5,000 notional / $500 margin at 10x.
  // Match common formatting variants: $5,000, $5000, 5,000 USD.
  const has5000 =
    /\$\s*5[,\s]?000(?!\d)/.test(text) || /\b5,?000\s*(usd|dollars?)/i.test(text);
  expect(has5000, `expected $5,000 notional in sizing section. Got:\n${text.slice(0, 1500)}`).toBe(true);
  const has500 =
    /\$\s*500(?!\d)/.test(text) || /\b500\s*(usd|dollars?)/i.test(text);
  expect(has500, `expected $500 margin in sizing section. Got:\n${text.slice(0, 1500)}`).toBe(true);
  // The 1% rule should be cited explicitly.
  expect(text).toMatch(/1\s?%/);
});

test("Test 2: ETH long 25x no stop, $5k account", async ({ page }) => {
  await page.goto("/");

  await fillCommonFields(page, {
    coin: "ETH",
    direction: "long",
    leverage: 25,
    accountSize: 5_000
  });
  // Leave stop blank intentionally
  await page.locator("#stop").fill("");

  await page.getByRole("button", { name: /Run my Pre-Flight Check/i }).click();

  const text = await waitForAllSections(page);
  expectAllSectionsInOrder(text);

  // The system prompt forces the model to call out a missing stop as a failure mode and
  // calculate sizing with an assumed 2% stop. Look for specific "no stop" / "without a stop"
  // / "missing stop" / "no stop loss" phrasings — not the generic "stop loss" string which
  // appears in every report.
  const noStopFlag =
    /\bno[\s-]+stop\b/i.test(text) ||
    /\bwithout\s+a?\s*stop\b/i.test(text) ||
    /\bmissing\s+stop\b/i.test(text) ||
    /\bno\s+stop\s+loss\b/i.test(text) ||
    /\bstop\s*[:=]?\s*none\b/i.test(text);
  expect(
    noStopFlag,
    `expected report to flag the missing stop with specific language ("no stop"/"without a stop"/"missing stop"). Got first 1200 chars:\n${text.slice(0, 1200)}`
  ).toBe(true);

  // 25x leverage on $5k = $125k notional → 1% rule with assumed 2% stop = $2,500 notional / $100 margin.
  // Verify proper sizing math is present (max-loss = 1% of $5k = $50, or assumed-stop sizing).
  const hasOneRiskMath =
    /\$\s*50(?!\d)/.test(text) || /\b50\s*(usd|dollars?)/i.test(text) || /1\s?%\s+of\s+\$?5[,\s]?000/i.test(text);
  expect(hasOneRiskMath, `expected 1% sizing math (~$50 max loss) in report.\n${text.slice(0, 1200)}`).toBe(true);
});

test("Test 3: SOL short 5x with 3% stop and TradingView screenshot, $20k account", async ({ page, context }) => {
  // Generate chart on a separate page in the same context
  const chartPage = await context.newPage();
  const chartBuffer = await generateCandlestickChart(chartPage);
  await chartPage.close();
  expect(chartBuffer.length).toBeGreaterThan(2000);

  await page.goto("/");

  await fillCommonFields(page, {
    coin: "SOL",
    direction: "short",
    leverage: 5,
    accountSize: 20_000
  });
  const entry = await getEntryPrice(page);
  await setStopRelative(page, entry, 3, "above");

  await page.locator('[data-testid="screenshot-input"]').setInputFiles({
    name: "sol-4h.png",
    mimeType: "image/png",
    buffer: chartBuffer
  });

  await page.getByRole("button", { name: /Run my Pre-Flight Check/i }).click();

  const text = await waitForAllSections(page, 90_000);
  expectAllSectionsInOrder(text);

  // Chart context should manifest in the text — vision model should describe a chart
  // We test for at least one chart-derived term, with a wide allowlist to avoid flakiness
  const lower = text.toLowerCase();
  const chartSignal =
    lower.includes("chart") ||
    lower.includes("trend") ||
    lower.includes("support") ||
    lower.includes("resistance") ||
    lower.includes("rsi") ||
    lower.includes("macd") ||
    lower.includes("level") ||
    lower.includes("4h") ||
    lower.includes("timeframe") ||
    lower.includes("breakdown") ||
    lower.includes("breakout") ||
    lower.includes("range") ||
    lower.includes("ma ") ||
    lower.includes("moving average");
  expect(chartSignal, `expected chart-derived signal in report. Got first 800 chars:\n${text.slice(0, 800)}`).toBe(true);
});

test("home page renders core elements", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Pre-Flight Check" })).toBeVisible();
  await expect(page.locator("#coin")).toBeVisible();
  await expect(page.locator("#leverage")).toBeVisible();
  await expect(page.locator("#accountSize")).toBeVisible();
  await expect(page.getByRole("button", { name: /Run my Pre-Flight Check/i })).toBeVisible();
  // Footer pitch line
  await expect(page.getByText(/Built by one person in 4 hours with Claude Code/i)).toBeVisible();
  await expect(page.getByRole("link", { name: /Learn how/i })).toBeVisible();
});

test("API: invalid input returns 400 with specific error message", async ({ request }) => {
  const res = await request.post("/api/risk-check", {
    data: { coin: "PEPE", direction: "long", leverage: 10, entry: 1, accountSize: 100 }
  });
  expect(res.status()).toBe(400);
  const body = (await res.json()) as { error?: string };
  expect(body.error).toMatch(/Unsupported coin/i);
});

test("API: rejects long with stop above entry", async ({ request }) => {
  const res = await request.post("/api/risk-check", {
    data: {
      coin: "BTC",
      direction: "long",
      leverage: 10,
      entry: 70_000,
      stop: 71_000,
      accountSize: 10_000
    }
  });
  expect(res.status()).toBe(400);
});

test("API: risk-budget mode without riskPct returns 400", async ({ request }) => {
  const res = await request.post("/api/risk-check", {
    data: {
      coin: "BTC",
      direction: "long",
      leverage: 10,
      entry: 70_000,
      accountSize: 10_000,
      mode: "risk-budget"
    }
  });
  expect(res.status()).toBe(400);
  const body = (await res.json()) as { error?: string };
  expect(body.error).toMatch(/riskPct is required/i);
});

test("Test 4: risk-budget mode derives a stop and sizes from it", async ({ page }) => {
  await page.goto("/");

  await fillCommonFields(page, {
    coin: "BTC",
    direction: "long",
    leverage: 5, // low enough to keep derived stop sane
    accountSize: 10_000
  });

  // Switch to risk-budget mode
  await page.getByTestId("mode-risk-budget").click();
  await expect(page.getByTestId("derived-stop")).toBeVisible();

  // Default risk is 1%. 1% / 5x = 0.2% — derived stop should be visible
  const derivedText = await page.getByTestId("derived-stop").textContent();
  expect(derivedText, "derived stop should display a price").toMatch(/\$/);
  expect(derivedText, "derived stop should display the distance %").toMatch(/0\.2/);

  await page.getByRole("button", { name: /Run my Pre-Flight Check/i }).click();

  const text = await waitForAllSections(page);
  expectAllSectionsInOrder(text);

  const lower = text.toLowerCase();
  // Report should explicitly call out that the trade is in derived/risk-budget mode
  // OR call out the tightness of the derived stop.
  const acknowledged =
    lower.includes("derived") ||
    lower.includes("risk-budget") ||
    lower.includes("risk budget") ||
    lower.includes("0.2%") ||
    lower.includes("microstructure") ||
    lower.includes("too tight") ||
    lower.includes("tight") ||
    lower.includes("wicked");
  expect(
    acknowledged,
    `expected report to acknowledge the derived stop or its tightness.\n${text.slice(0, 1500)}`
  ).toBe(true);

  // TRADE PLAN section is required and must include TP1/2/3
  expect(text).toMatch(/TRADE PLAN/i);
  expect(text).toMatch(/TP1/i);
  expect(text).toMatch(/TP2/i);
  expect(text).toMatch(/TP3/i);
});
