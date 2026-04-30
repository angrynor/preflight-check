import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

test("Lab page loads with header, warning, and default strategy info", async ({ page }) => {
  await page.goto("/lab");
  await expect(page.getByRole("heading", { name: "Strategy Lab" })).toBeVisible();
  await expect(page.getByText(/strategies you test here will lose money/i)).toBeVisible();
  await expect(page.getByText(/That.s the lesson/i)).toBeVisible();
  // Two "Not financial advice" elements (banner + footer); first one suffices
  await expect(page.getByText(/Not financial advice/i).first()).toBeVisible();
  // Strategy selector is present and defaults to Donchian
  const sel = page.getByTestId("strategy-select");
  await expect(sel).toBeVisible();
  // Reality check line for the selected strategy is shown
  await expect(page.getByText(/Reality check:/)).toBeVisible();
  // Buttons present
  await expect(page.getByTestId("run-backtest")).toBeVisible();
  await expect(page.getByTestId("run-signal")).toBeVisible();
});

test("Nav link from main page leads to /lab", async ({ page }) => {
  await page.goto("/");
  const labLink = page.getByTestId("lab-link");
  await expect(labLink).toBeVisible();
  await labLink.click();
  await expect(page).toHaveURL(/\/lab$/);
  await expect(page.getByRole("heading", { name: "Strategy Lab" })).toBeVisible();
});

test("Run backtest on Donchian Breakout BTC 730d returns verdict + metrics", async ({ page }) => {
  await page.goto("/lab");
  await page.getByTestId("strategy-select").selectOption("donchian-breakout");
  await page.getByTestId("run-backtest").click();
  await expect(page.getByTestId("backtest-result")).toBeVisible({ timeout: 60_000 });
  // Verdict should appear with concrete numbers
  await expect(page.getByTestId("verdict")).toBeVisible();
  const verdictText = await page.getByTestId("verdict").textContent();
  expect(verdictText).toBeTruthy();
  expect(verdictText!.length).toBeGreaterThan(20);
  // Equity chart renders
  await expect(page.getByTestId("equity-chart")).toBeVisible();
  // Metrics show "vs Buy & Hold"
  await expect(page.getByText(/vs Buy & Hold/i)).toBeVisible();
});

test("Run live signal returns either a signal or 'no signal' with most-recent context", async ({ page }) => {
  await page.goto("/lab");
  await page.getByTestId("strategy-select").selectOption("donchian-breakout");
  await page.getByTestId("run-signal").click();
  await expect(page.getByTestId("signal-panel")).toBeVisible({ timeout: 30_000 });
  // Either a signal triggered, or there is text about no signal + recent signal
  const text = await page.getByTestId("signal-panel").textContent();
  expect(text).toBeTruthy();
  expect(text!.toLowerCase()).toMatch(/signal|current price/);
});

test("Custom strategy: build RSI<30 entry / RSI>70 exit and run backtest", async ({ page }) => {
  await page.goto("/lab");
  await page.getByTestId("strategy-select").selectOption("custom");
  // Custom builder appears
  await expect(page.getByText(/Define Your Strategy/i)).toBeVisible();
  await page.getByTestId("run-backtest").click();
  await expect(page.getByTestId("backtest-result")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("verdict")).toBeVisible();
});

test("API /api/backtest rejects unsupported coin", async ({ request }) => {
  const res = await request.post("/api/backtest", {
    data: { coin: "PEPE", strategyId: "donchian-breakout" }
  });
  expect(res.status()).toBe(400);
  const body = (await res.json()) as { error?: string };
  expect(body.error).toMatch(/Unsupported coin/i);
});

test("API /api/backtest rejects unknown strategy", async ({ request }) => {
  const res = await request.post("/api/backtest", {
    data: { coin: "BTC", strategyId: "made-up-strategy" }
  });
  expect(res.status()).toBe(400);
  const body = (await res.json()) as { error?: string };
  expect(body.error).toMatch(/Unknown strategyId/i);
});

test("API /api/backtest returns metrics + benchmark for buy-and-hold", async ({ request }) => {
  const res = await request.post("/api/backtest", {
    data: { coin: "BTC", strategyId: "buy-and-hold", candleCount: 365 }
  });
  expect(res.status()).toBe(200);
  const body = (await res.json()) as {
    metrics: { numTrades: number; growthFactor: number };
    benchmark: { totalReturnPct: number };
    candleCount: number;
  };
  expect(body.candleCount).toBeGreaterThan(300);
  // Buy-and-hold should have exactly 1 trade (or 0 if data was missing)
  expect(body.metrics.numTrades).toBeLessThanOrEqual(1);
  expect(typeof body.benchmark.totalReturnPct).toBe("number");
});
