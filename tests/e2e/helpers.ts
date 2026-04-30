import { type Page, expect } from "@playwright/test";

const SECTION_HEADINGS = [
  "THE BULL CASE",
  "THE BEAR CASE",
  "THREE WARNING FLAGS",
  "PROPER POSITION SIZING",
  "TRADE PLAN",
  "THREE EXIT TRIGGERS"
] as const;

export async function generateCandlestickChart(page: Page): Promise<Buffer> {
  await page.goto("about:blank");
  const html = `<!doctype html>
<html><head><style>body{margin:0;background:#131722;}</style></head>
<body>
<canvas id="c" width="900" height="540"></canvas>
<script>
  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = '#131722';
  ctx.fillRect(0, 0, 900, 540);

  // Title and timeframe label
  ctx.fillStyle = '#d1d4dc';
  ctx.font = 'bold 16px monospace';
  ctx.fillText('SOL/USDT  •  4H  •  Binance', 16, 26);
  ctx.font = '12px monospace';
  ctx.fillStyle = '#787b86';
  ctx.fillText('Vol 24h: 1.42B', 16, 46);

  // Price grid
  ctx.strokeStyle = '#1e222d';
  ctx.lineWidth = 1;
  for (let i = 1; i < 6; i++) {
    const y = 60 + i * 80;
    ctx.beginPath(); ctx.moveTo(40, y); ctx.lineTo(880, y); ctx.stroke();
  }
  // Y-axis labels (price levels)
  ctx.fillStyle = '#787b86';
  ctx.font = '11px monospace';
  const prices = [220, 210, 200, 190, 180, 170];
  prices.forEach((p, i) => ctx.fillText('$' + p, 845, 64 + i * 80));

  // Candle data: 30 candles, mild downtrend with rejection wicks at top (perfect for short)
  const candles = [];
  let price = 215;
  for (let i = 0; i < 30; i++) {
    const drift = -0.4 + (i / 30) * -0.2;
    const noise = (Math.sin(i * 1.3) + Math.cos(i * 0.7)) * 1.6;
    const open = price;
    const close = price + drift + noise;
    const wickUp = Math.max(open, close) + Math.abs(noise) * 0.6 + 0.5;
    const wickDown = Math.min(open, close) - Math.abs(noise) * 0.4 - 0.3;
    candles.push({ open, close, high: wickUp, low: wickDown });
    price = close;
  }

  // Map prices to y. Range 165–225.
  const yFor = (p) => 60 + (225 - p) * (400 / 60);

  // Draw 50-period MA (rough)
  const closes = candles.map(c => c.close);
  ctx.strokeStyle = '#ff9800';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  closes.forEach((c, i) => {
    const x = 50 + i * 27;
    const y = yFor(c) + 8;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Draw candles
  candles.forEach((c, i) => {
    const x = 50 + i * 27;
    const w = 14;
    const up = c.close >= c.open;
    const color = up ? '#26a69a' : '#ef5350';
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    // Wick
    ctx.beginPath();
    ctx.moveTo(x + w / 2, yFor(c.high));
    ctx.lineTo(x + w / 2, yFor(c.low));
    ctx.stroke();
    // Body
    const bodyTop = yFor(Math.max(c.open, c.close));
    const bodyBot = yFor(Math.min(c.open, c.close));
    ctx.fillRect(x, bodyTop, w, Math.max(1, bodyBot - bodyTop));
  });

  // Resistance line at $220
  ctx.strokeStyle = '#ef5350';
  ctx.setLineDash([6, 4]);
  ctx.lineWidth = 1.2;
  const yRes = yFor(220);
  ctx.beginPath(); ctx.moveTo(40, yRes); ctx.lineTo(880, yRes); ctx.stroke();
  ctx.fillStyle = '#ef5350';
  ctx.font = '11px monospace';
  ctx.fillText('R: 220', 50, yRes - 4);

  // Support line at $185
  ctx.strokeStyle = '#26a69a';
  const ySup = yFor(185);
  ctx.beginPath(); ctx.moveTo(40, ySup); ctx.lineTo(880, ySup); ctx.stroke();
  ctx.fillStyle = '#26a69a';
  ctx.fillText('S: 185', 50, ySup - 4);

  ctx.setLineDash([]);

  // Volume row
  ctx.fillStyle = '#1e222d';
  ctx.fillRect(40, 480, 840, 50);
  candles.forEach((c, i) => {
    const x = 50 + i * 27;
    const up = c.close >= c.open;
    ctx.fillStyle = up ? 'rgba(38,166,154,0.5)' : 'rgba(239,83,80,0.5)';
    const h = 10 + Math.abs(c.close - c.open) * 18;
    ctx.fillRect(x, 530 - h, 14, h);
  });

  // RSI label bottom-right
  ctx.fillStyle = '#787b86';
  ctx.font = '11px monospace';
  ctx.fillText('RSI(14): 38  •  MACD: bearish cross', 600, 530);
</script>
</body></html>`;
  await page.setContent(html);
  await page.waitForTimeout(150);
  return page.locator("#c").screenshot();
}

export async function waitForAllSections(page: Page, timeoutMs: number = 90_000): Promise<string> {
  const report = page.getByTestId("risk-report");
  await expect(report).toBeVisible({ timeout: 15_000 });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const text = (await report.textContent()) ?? "";
    const upper = text.toUpperCase();
    const allPresent = SECTION_HEADINGS.every((s) => upper.includes(s));
    if (allPresent) {
      // Wait a moment for the stream to flush
      await page.waitForTimeout(800);
      const final = (await report.textContent()) ?? "";
      return final;
    }
    await page.waitForTimeout(500);
  }
  const last = (await report.textContent()) ?? "";
  throw new Error(
    `Timed out waiting for all 5 sections. Got:\n${last.slice(0, 500)}`
  );
}

export function expectAllSectionsInOrder(text: string): void {
  const upper = text.toUpperCase();
  let cursor = 0;
  for (const heading of SECTION_HEADINGS) {
    const idx = upper.indexOf(heading, cursor);
    expect(idx, `expected "${heading}" after position ${cursor}`).toBeGreaterThanOrEqual(0);
    cursor = idx + heading.length;
  }
}

export async function getEntryPrice(page: Page): Promise<number> {
  const value = await page.locator("#entry").inputValue();
  return Number(value);
}

export async function setStopRelative(page: Page, entry: number, pct: number, side: "above" | "below"): Promise<void> {
  const stop = side === "above" ? entry * (1 + pct / 100) : entry * (1 - pct / 100);
  const formatted = stop >= 1000 ? stop.toFixed(2) : stop >= 1 ? stop.toFixed(4) : stop.toFixed(6);
  await page.locator("#stop").fill(formatted);
}

export async function fillCommonFields(
  page: Page,
  args: {
    coin: string;
    direction: "long" | "short";
    leverage: number;
    accountSize: number;
  }
): Promise<void> {
  await page.locator("#coin").selectOption(args.coin);
  if (args.direction === "short") {
    await page.getByRole("button", { name: "short", exact: false }).click();
  }
  await page.locator("#leverage").fill(String(args.leverage));
  await page.locator("#accountSize").fill(String(args.accountSize));
  // Wait for autofill to populate entry
  await expect(page.locator("#entry")).not.toHaveValue("", { timeout: 15_000 });
}

export const ALL_FIVE_SECTIONS = SECTION_HEADINGS;
