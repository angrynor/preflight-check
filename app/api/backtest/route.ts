import { NextRequest, NextResponse } from "next/server";
import { runBacktest } from "@/lib/backtest";
import { isSupportedCoin, type CoinSymbol } from "@/lib/coins";
import { computeMetrics } from "@/lib/metrics";
import { getHistoricalKlinesOkx } from "@/lib/okx";
import {
  getStrategy,
  STRATEGY_LIST,
  type StrategyId,
  type StrategyParams
} from "@/lib/strategies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface BacktestRequest {
  coin: string;
  strategyId: StrategyId;
  params?: StrategyParams;
  bar?: string; // "1D" default
  candleCount?: number; // up to 1500
  startingEquity?: number;
  costPerSide?: number;
  slippagePerSide?: number;
  fundingCostPerBar?: number;
}

const VALID_BARS = new Set(["1m", "5m", "15m", "30m", "1H", "2H", "4H", "1D", "1W"]);

export async function POST(req: NextRequest): Promise<Response> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const body = raw as BacktestRequest;

  if (typeof body.coin !== "string") {
    return NextResponse.json({ error: "coin is required" }, { status: 400 });
  }
  const coin = body.coin.toUpperCase();
  if (!isSupportedCoin(coin)) {
    return NextResponse.json({ error: `Unsupported coin: ${coin}` }, { status: 400 });
  }

  const strategyId = body.strategyId;
  if (!strategyId || !STRATEGY_LIST.find((s) => s.id === strategyId)) {
    return NextResponse.json(
      { error: `Unknown strategyId. Pick one of: ${STRATEGY_LIST.map((s) => s.id).join(", ")}` },
      { status: 400 }
    );
  }

  const bar = body.bar ?? "1D";
  if (!VALID_BARS.has(bar)) {
    return NextResponse.json({ error: `Unsupported bar: ${bar}` }, { status: 400 });
  }

  const candleCount = Math.min(Math.max(body.candleCount ?? 730, 60), 1500);
  const startingEquity = clampPositive(body.startingEquity ?? 10000, 100, 10_000_000);
  const costPerSide = clampInRange(body.costPerSide ?? 0.0005, 0, 0.01);
  const slippagePerSide = clampInRange(body.slippagePerSide ?? 0.0005, 0, 0.01);
  const fundingCostPerBar = clampInRange(body.fundingCostPerBar ?? 0, 0, 0.01);

  let candles;
  try {
    candles = await getHistoricalKlinesOkx(coin as CoinSymbol, bar, candleCount);
  } catch (err) {
    console.error(`[backtest] OKX history fetch failed for ${coin}: ${err}`);
    return NextResponse.json(
      { error: "Historical data unavailable from OKX. Try again in a moment." },
      { status: 503 }
    );
  }

  if (candles.length < 30) {
    return NextResponse.json(
      { error: `Got only ${candles.length} candles — not enough to backtest. Try a different coin or longer window.` },
      { status: 503 }
    );
  }

  const descriptor = getStrategy(strategyId);
  let strategyFn;
  try {
    const params = { ...descriptor.defaults, ...(body.params ?? {}) };
    strategyFn = descriptor.build(params);
  } catch (err) {
    return NextResponse.json(
      { error: `Strategy build failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 400 }
    );
  }

  const result = runBacktest(candles, strategyFn, {
    costPerSide,
    slippagePerSide,
    startingEquity,
    fundingCostPerBar
  });
  const metrics = computeMetrics(result.trades, result.equityCurve, startingEquity);

  // Buy-and-hold benchmark using the same fee assumptions
  const bhFn = getStrategy("buy-and-hold").build({});
  const bhResult = runBacktest(candles, bhFn, {
    costPerSide,
    slippagePerSide,
    startingEquity,
    fundingCostPerBar
  });
  const bhReturnPct = bhResult.totalReturnPct;

  return NextResponse.json({
    coin,
    strategyId,
    strategyName: descriptor.name,
    strategyDescription: descriptor.description,
    strategyReality: descriptor.reality,
    bar,
    candleCount: candles.length,
    firstCandleTime: candles[0].openTime,
    lastCandleTime: candles[candles.length - 1].openTime,
    metrics,
    benchmark: {
      name: "Buy and Hold",
      totalReturnPct: bhReturnPct,
      finalEquity: bhResult.finalEquity
    },
    trades: result.trades,
    equityCurve: result.equityCurve,
    candles: candles.map((c) => ({ t: c.openTime, c: c.close })), // slim version for chart
    costPerSide,
    slippagePerSide,
    fundingCostPerBar
  });
}

function clampPositive(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function clampInRange(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}
