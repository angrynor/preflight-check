import { NextRequest, NextResponse } from "next/server";
import { isSupportedCoin, type CoinSymbol } from "@/lib/coins";
import { getHistoricalKlinesOkx } from "@/lib/okx";
import {
  getStrategy,
  STRATEGY_LIST,
  type StrategyId,
  type StrategyParams
} from "@/lib/strategies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

interface SignalRequest {
  coin: string;
  strategyId: StrategyId;
  params?: StrategyParams;
  bar?: string;
}

const VALID_BARS = new Set(["1m", "5m", "15m", "30m", "1H", "2H", "4H", "1D", "1W"]);

export async function POST(req: NextRequest): Promise<Response> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const body = raw as SignalRequest;

  const coin = typeof body.coin === "string" ? body.coin.toUpperCase() : "";
  if (!isSupportedCoin(coin)) {
    return NextResponse.json({ error: "Unsupported coin." }, { status: 400 });
  }
  if (!body.strategyId || !STRATEGY_LIST.find((s) => s.id === body.strategyId)) {
    return NextResponse.json({ error: "Unknown strategyId." }, { status: 400 });
  }
  const bar = body.bar ?? "1D";
  if (!VALID_BARS.has(bar)) {
    return NextResponse.json({ error: `Unsupported bar: ${bar}` }, { status: 400 });
  }

  let candles;
  try {
    // Fetch enough history for the longest indicator (200-period EMA + buffer)
    candles = await getHistoricalKlinesOkx(coin as CoinSymbol, bar, 300);
  } catch (err) {
    console.error(`[strategy-signal] OKX fetch failed: ${err}`);
    return NextResponse.json(
      { error: "Historical data unavailable." },
      { status: 503 }
    );
  }

  if (candles.length < 30) {
    return NextResponse.json(
      { error: `Insufficient candles (${candles.length}).` },
      { status: 503 }
    );
  }

  const descriptor = getStrategy(body.strategyId);
  const params = { ...descriptor.defaults, ...(body.params ?? {}) };

  let signals;
  try {
    const fn = descriptor.build(params);
    signals = fn(candles);
  } catch (err) {
    return NextResponse.json(
      { error: `Strategy build failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 400 }
    );
  }

  const lastIndex = candles.length - 1;
  const lastCandle = candles[lastIndex];

  // Did a signal trigger on the most recent CLOSED candle?
  const recentSignal = signals.find((s) => s.index === lastIndex);
  const previousSignal = signals.length > 0 ? signals[signals.length - 1] : null;

  return NextResponse.json({
    coin,
    strategyId: body.strategyId,
    strategyName: descriptor.name,
    bar,
    asOf: lastCandle.openTime,
    currentPrice: lastCandle.close,
    triggeredOnLastCandle: recentSignal !== undefined,
    signal: recentSignal
      ? {
          side: recentSignal.side,
          entryPrice: lastCandle.close,
          stopPrice: recentSignal.stopPrice ?? null,
          takeProfitPrice: recentSignal.takeProfitPrice ?? null,
          label: recentSignal.label ?? null
        }
      : null,
    mostRecentSignalEver: previousSignal
      ? {
          atIndex: previousSignal.index,
          atTime: candles[previousSignal.index]?.openTime,
          side: previousSignal.side,
          label: previousSignal.label ?? null,
          barsAgo: lastIndex - previousSignal.index
        }
      : null,
    totalSignalsInWindow: signals.length
  });
}

export async function GET(): Promise<Response> {
  return NextResponse.json({
    name: "strategy-signal",
    method: "POST",
    description:
      "Returns whether the selected strategy fires on the most recent CLOSED candle. Body: { coin, strategyId, bar?, params? }"
  });
}
