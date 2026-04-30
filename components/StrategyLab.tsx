"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { TOP_COINS } from "@/lib/coins";
import { STRATEGY_LIST, type StrategyId, type CustomCondition } from "@/lib/strategies";
import { EquityChart } from "./EquityChart";

const BARS = ["1D", "4H", "1H", "30m", "15m", "5m"] as const;
const WINDOWS = [
  { label: "2 years (730d)", days: 730 },
  { label: "1 year (365d)", days: 365 },
  { label: "6 months (180d)", days: 180 },
  { label: "3 months (90d)", days: 90 }
];

const CONDITION_OPTIONS: { id: CustomCondition["kind"]; label: string }[] = [
  { id: "rsiBelow", label: "RSI is BELOW threshold" },
  { id: "rsiAbove", label: "RSI is ABOVE threshold" },
  { id: "priceCrossesAboveSma", label: "Price CROSSES ABOVE EMA" },
  { id: "priceCrossesBelowSma", label: "Price CROSSES BELOW EMA" },
  { id: "macdCrossAbove", label: "MACD CROSSES ABOVE signal line" },
  { id: "macdCrossBelow", label: "MACD CROSSES BELOW signal line" },
  { id: "bbTouchLower", label: "Price touches LOWER Bollinger Band" },
  { id: "bbTouchUpper", label: "Price touches UPPER Bollinger Band" }
];

interface Trade {
  side: "long" | "short";
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  pnlPct: number;
  exitReason: string;
  label?: string;
  barsHeld: number;
}

interface Metrics {
  numTrades: number;
  numWins: number;
  numLosses: number;
  winRatePct: number;
  avgWinUsd: number;
  avgLossUsd: number;
  profitFactor: number;
  expectancyUsd: number;
  perTradeSharpe: number;
  annualizedSharpe: number;
  maxDrawdownPct: number;
  growthFactor: number;
  cagr: number;
  avgBarsHeld: number;
  verdict: string;
  verdictSeverity: "good" | "neutral" | "bad";
}

interface BacktestResponse {
  coin: string;
  strategyId: StrategyId;
  strategyName: string;
  strategyDescription: string;
  strategyReality: string;
  bar: string;
  candleCount: number;
  firstCandleTime: number;
  lastCandleTime: number;
  metrics: Metrics;
  benchmark: { name: string; totalReturnPct: number; finalEquity: number };
  trades: Trade[];
  equityCurve: number[];
  candles: { t: number; c: number }[];
}

interface SignalResponse {
  coin: string;
  strategyId: StrategyId;
  strategyName: string;
  bar: string;
  asOf: number;
  currentPrice: number;
  triggeredOnLastCandle: boolean;
  signal: {
    side: "long" | "short";
    entryPrice: number;
    stopPrice: number | null;
    takeProfitPrice: number | null;
    label: string | null;
  } | null;
  mostRecentSignalEver: {
    atIndex: number;
    atTime: number;
    side: "long" | "short";
    label: string | null;
    barsAgo: number;
  } | null;
  totalSignalsInWindow: number;
}

export function StrategyLab() {
  const [coin, setCoin] = useState("BTC");
  const [strategyId, setStrategyId] = useState<StrategyId>("donchian-breakout");
  const [bar, setBar] = useState<(typeof BARS)[number]>("1D");
  const [windowDays, setWindowDays] = useState(730);
  const [stopPct, setStopPct] = useState<string>("");
  const [takeProfitPct, setTakeProfitPct] = useState<string>("");
  const [allowShorts, setAllowShorts] = useState(false);

  // Custom strategy state
  const [customEntryKind, setCustomEntryKind] = useState<CustomCondition["kind"]>("rsiBelow");
  const [customEntryThreshold, setCustomEntryThreshold] = useState("30");
  const [customEntryPeriod, setCustomEntryPeriod] = useState("14");
  const [customExitKind, setCustomExitKind] = useState<CustomCondition["kind"]>("rsiAbove");
  const [customExitThreshold, setCustomExitThreshold] = useState("70");
  const [customExitPeriod, setCustomExitPeriod] = useState("14");
  const [customSide, setCustomSide] = useState<"long" | "short">("long");

  const [result, setResult] = useState<BacktestResponse | null>(null);
  const [signal, setSignal] = useState<SignalResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [signalBusy, setSignalBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = STRATEGY_LIST.find((s) => s.id === strategyId)!;
  const isCustom = strategyId === "custom";

  const buildCustomCondition = (
    kind: CustomCondition["kind"],
    threshold: string,
    period: string
  ): CustomCondition => {
    const p = Number(period);
    const t = Number(threshold);
    switch (kind) {
      case "rsiBelow":
      case "rsiAbove":
        return { kind, period: p, threshold: t };
      case "priceAboveSma":
      case "priceBelowSma":
      case "priceCrossesAboveSma":
      case "priceCrossesBelowSma":
        return { kind, period: p };
      case "macdCrossAbove":
      case "macdCrossBelow":
        return { kind };
      case "bbTouchLower":
      case "bbTouchUpper":
        return { kind, period: p, stdMultiplier: t };
      default: {
        const _never: never = kind;
        throw new Error(`Unhandled condition kind: ${_never as string}`);
      }
    }
  };

  const buildParams = (): Record<string, unknown> => {
    const params: Record<string, unknown> = {};
    if (stopPct !== "" && Number(stopPct) > 0) params.stopPct = Number(stopPct);
    if (takeProfitPct !== "" && Number(takeProfitPct) > 0) params.takeProfitPct = Number(takeProfitPct);
    params.allowShorts = allowShorts;
    if (isCustom) {
      params.customRules = {
        entryWhen: buildCustomCondition(customEntryKind, customEntryThreshold, customEntryPeriod),
        exitWhen: buildCustomCondition(customExitKind, customExitThreshold, customExitPeriod),
        side: customSide
      };
    }
    return params;
  };

  const runBacktest = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/backtest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          coin,
          strategyId,
          bar,
          candleCount: windowDays,
          params: buildParams()
        })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      const data = (await res.json()) as BacktestResponse;
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const runSignal = async () => {
    setSignalBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/strategy-signal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coin, strategyId, bar, params: buildParams() })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      const data = (await res.json()) as SignalResponse;
      setSignal(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSignalBusy(false);
    }
  };

  const benchmarkCurve = useMemo(() => {
    if (!result || !result.candles.length) return undefined;
    // Buy-and-hold equity curve: starts at startingEquity, scales linearly with price.
    const startEq = 10_000;
    const startPrice = result.candles[0].c;
    return result.candles.map((c) => startEq * (c.c / startPrice));
  }, [result]);

  return (
    <main className="mx-auto max-w-[920px] px-4 sm:px-6 pt-10 sm:pt-14 pb-6">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Strategy Lab</h1>
          <p className="mt-2 text-sm text-muted">
            Backtest popular trading strategies on real OKX data with realistic costs. Most strategies you test
            here will lose money. <span className="text-warn">That&apos;s the lesson.</span>
          </p>
        </div>
        <Link
          href="/"
          className="text-xs uppercase tracking-wider text-accent hover:underline whitespace-nowrap"
        >
          ← Back to Pre-Flight Check
        </Link>
      </header>

      <div className="rounded-md border border-warn/30 bg-warn/5 p-3 text-xs text-warn mb-6">
        Backtests assume perfect execution and use historical data. Live trading is harder. Past performance
        is not destiny. <strong>Not financial advice.</strong>
      </div>

      {/* Configuration */}
      <section className="panel space-y-5">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <label htmlFor="lab-coin" className="field-label">Coin</label>
            <select
              id="lab-coin"
              value={coin}
              onChange={(e) => setCoin(e.target.value)}
              className="field-input"
              disabled={busy || signalBusy}
            >
              {TOP_COINS.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="lab-strategy" className="field-label">Strategy</label>
            <select
              id="lab-strategy"
              value={strategyId}
              onChange={(e) => setStrategyId(e.target.value as StrategyId)}
              className="field-input"
              disabled={busy || signalBusy}
              data-testid="strategy-select"
            >
              {STRATEGY_LIST.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="lab-window" className="field-label">Window</label>
            <select
              id="lab-window"
              value={windowDays}
              onChange={(e) => setWindowDays(Number(e.target.value))}
              className="field-input"
              disabled={busy || signalBusy}
            >
              {WINDOWS.map((w) => (
                <option key={w.days} value={w.days}>{w.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="lab-bar" className="field-label">Bar</label>
            <select
              id="lab-bar"
              value={bar}
              onChange={(e) => setBar(e.target.value as (typeof BARS)[number])}
              className="field-input"
              disabled={busy || signalBusy}
            >
              {BARS.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="rounded-md border border-white/5 bg-bg/40 p-3">
          <p className="text-xs text-muted leading-relaxed">
            <strong className="text-primary">{selected.name}.</strong> {selected.description}
          </p>
          <p className="text-xs text-warn mt-2 leading-relaxed">
            <strong>Reality check:</strong> {selected.reality}
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <div>
            <label htmlFor="lab-stop" className="field-label">Stop loss % (optional)</label>
            <input
              id="lab-stop"
              type="number"
              step="any"
              value={stopPct}
              onChange={(e) => setStopPct(e.target.value)}
              className="field-input"
              placeholder="e.g. 5"
              disabled={busy || signalBusy}
            />
          </div>
          <div>
            <label htmlFor="lab-tp" className="field-label">Take profit % (optional)</label>
            <input
              id="lab-tp"
              type="number"
              step="any"
              value={takeProfitPct}
              onChange={(e) => setTakeProfitPct(e.target.value)}
              className="field-input"
              placeholder="e.g. 10"
              disabled={busy || signalBusy}
            />
          </div>
          <div className="flex items-end">
            <label className="inline-flex items-center gap-2 text-sm text-primary">
              <input
                type="checkbox"
                checked={allowShorts}
                onChange={(e) => setAllowShorts(e.target.checked)}
                className="accent-accent"
                disabled={busy || signalBusy}
              />
              Allow short signals
            </label>
          </div>
        </div>

        {isCustom && (
          <div className="rounded-md border border-accent/30 bg-accent/5 p-4 space-y-3">
            <h3 className="text-sm font-semibold text-accent uppercase tracking-wider">
              Define Your Strategy
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="field-label">Side</label>
                <select
                  value={customSide}
                  onChange={(e) => setCustomSide(e.target.value as "long" | "short")}
                  className="field-input"
                >
                  <option value="long">Long only</option>
                  <option value="short">Short only</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="field-label">Enter when</label>
                <select
                  value={customEntryKind}
                  onChange={(e) => setCustomEntryKind(e.target.value as CustomCondition["kind"])}
                  className="field-input"
                >
                  {CONDITION_OPTIONS.map((c) => (
                    <option key={c.id} value={c.id}>{c.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="field-label">Period</label>
                <input
                  type="number"
                  value={customEntryPeriod}
                  onChange={(e) => setCustomEntryPeriod(e.target.value)}
                  className="field-input"
                />
              </div>
              <div>
                <label className="field-label">Threshold / σ</label>
                <input
                  type="number"
                  step="any"
                  value={customEntryThreshold}
                  onChange={(e) => setCustomEntryThreshold(e.target.value)}
                  className="field-input"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="field-label">Exit when</label>
                <select
                  value={customExitKind}
                  onChange={(e) => setCustomExitKind(e.target.value as CustomCondition["kind"])}
                  className="field-input"
                >
                  {CONDITION_OPTIONS.map((c) => (
                    <option key={c.id} value={c.id}>{c.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="field-label">Period</label>
                <input
                  type="number"
                  value={customExitPeriod}
                  onChange={(e) => setCustomExitPeriod(e.target.value)}
                  className="field-input"
                />
              </div>
              <div>
                <label className="field-label">Threshold / σ</label>
                <input
                  type="number"
                  step="any"
                  value={customExitThreshold}
                  onChange={(e) => setCustomExitThreshold(e.target.value)}
                  className="field-input"
                />
              </div>
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={runBacktest}
            disabled={busy || signalBusy}
            data-testid="run-backtest"
            className="rounded-md bg-accent px-4 py-2.5 text-bg font-semibold uppercase tracking-wider text-sm
              hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {busy ? "Running backtest…" : "Run backtest"}
          </button>
          <button
            type="button"
            onClick={runSignal}
            disabled={busy || signalBusy}
            data-testid="run-signal"
            className="rounded-md border border-accent/40 px-4 py-2.5 text-accent font-semibold uppercase tracking-wider text-sm
              hover:bg-accent/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {signalBusy ? "Checking…" : "Live signal now"}
          </button>
        </div>

        {error && (
          <div role="alert" className="rounded-md border border-bear/30 bg-bear/10 px-3 py-2 text-sm text-bear">
            {error}
          </div>
        )}
      </section>

      {/* Live signal panel */}
      {signal && (
        <section className="panel mt-6" data-testid="signal-panel">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-accent mb-3">
            Live Signal — {signal.strategyName} on {signal.coin} ({signal.bar})
          </h2>
          {signal.triggeredOnLastCandle && signal.signal ? (
            <div className="space-y-2">
              <p className="text-lg">
                <span className={signal.signal.side === "long" ? "text-bull" : "text-bear"}>
                  {signal.signal.side.toUpperCase()} signal
                </span>{" "}
                triggered on the most recent closed candle.
              </p>
              <p className="text-sm text-muted">{signal.signal.label}</p>
              <ul className="text-sm font-mono space-y-1 mt-2">
                <li>Entry: ${signal.signal.entryPrice.toFixed(2)}</li>
                {signal.signal.stopPrice !== null && (
                  <li>Suggested stop: ${signal.signal.stopPrice.toFixed(2)}</li>
                )}
                {signal.signal.takeProfitPrice !== null && (
                  <li>Suggested TP: ${signal.signal.takeProfitPrice.toFixed(2)}</li>
                )}
              </ul>
            </div>
          ) : (
            <div className="text-sm text-muted">
              <p>
                <strong className="text-primary">No signal</strong> on the last closed candle.
                Current price: ${signal.currentPrice.toFixed(2)}.
              </p>
              {signal.mostRecentSignalEver && (
                <p className="mt-1">
                  Most recent signal: {signal.mostRecentSignalEver.barsAgo} bars ago (
                  <span className={signal.mostRecentSignalEver.side === "long" ? "text-bull" : "text-bear"}>
                    {signal.mostRecentSignalEver.side}
                  </span>{" "}
                  — {signal.mostRecentSignalEver.label}).
                </p>
              )}
              <p className="mt-1">Total signals in window: {signal.totalSignalsInWindow}</p>
            </div>
          )}
        </section>
      )}

      {/* Backtest result */}
      {result && (
        <section className="space-y-6 mt-6" data-testid="backtest-result">
          <div
            className={[
              "panel border-l-4",
              result.metrics.verdictSeverity === "good"
                ? "border-l-bull"
                : result.metrics.verdictSeverity === "bad"
                ? "border-l-bear"
                : "border-l-warn"
            ].join(" ")}
          >
            <p className="text-xs uppercase tracking-wider text-muted mb-1">Verdict</p>
            <p
              className={[
                "text-base font-medium leading-relaxed",
                result.metrics.verdictSeverity === "good"
                  ? "text-bull"
                  : result.metrics.verdictSeverity === "bad"
                  ? "text-bear"
                  : "text-warn"
              ].join(" ")}
              data-testid="verdict"
            >
              {result.metrics.verdict}
            </p>
          </div>

          <div className="panel">
            <p className="text-xs uppercase tracking-wider text-muted mb-3">Metrics</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3 font-mono text-sm">
              <Metric label="Total return" value={`${fmtPct((safeNum(result.metrics.growthFactor) - 1) * 100, 1)}`} />
              <Metric
                label="vs Buy & Hold"
                value={fmtPct(safeNum(result.benchmark.totalReturnPct), 1)}
                tone={safeNum(result.benchmark.totalReturnPct) > (safeNum(result.metrics.growthFactor) - 1) * 100 ? "warn" : "neutral"}
              />
              <Metric label="Trades" value={String(result.metrics.numTrades)} />
              <Metric label="Win rate" value={fmtPct(safeNum(result.metrics.winRatePct), 1)} />
              <Metric label="Profit factor" value={result.metrics.profitFactor === null || result.metrics.profitFactor === undefined ? "∞" : (result.metrics.profitFactor === Infinity ? "∞" : safeNum(result.metrics.profitFactor).toFixed(2))} />
              <Metric label="Max drawdown" value={fmtPct(safeNum(result.metrics.maxDrawdownPct), 1)} />
              <Metric label="CAGR" value={fmtPct(safeNum(result.metrics.cagr) * 100, 1)} />
              <Metric label="Sharpe (ann.)" value={safeNum(result.metrics.annualizedSharpe).toFixed(2)} />
              <Metric label="Avg win" value={`$${safeNum(result.metrics.avgWinUsd).toFixed(0)}`} />
              <Metric label="Avg loss" value={`$${safeNum(result.metrics.avgLossUsd).toFixed(0)}`} />
              <Metric label="Avg bars held" value={safeNum(result.metrics.avgBarsHeld).toFixed(1)} />
              <Metric label="Candles" value={String(result.candleCount)} />
            </div>
            <p className="text-[10px] text-muted/70 mt-4">
              Costs assumed: 0.05% per side (0.1% round-trip) + 0.05% slippage per side. Funding cost not modeled
              — add ~0.01% per 8hr (~36% annualized) for sustained directional perp positions.
            </p>
          </div>

          <div className="panel">
            <p className="text-xs uppercase tracking-wider text-muted mb-3">Equity curve</p>
            <EquityChart
              equity={result.equityCurve}
              benchmark={benchmarkCurve}
              startingEquity={10000}
            />
          </div>

          {result.trades.length > 0 && (
            <div className="panel">
              <p className="text-xs uppercase tracking-wider text-muted mb-3">
                Last {Math.min(20, result.trades.length)} trades
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs font-mono">
                  <thead>
                    <tr className="text-muted text-left">
                      <th className="py-1.5 pr-3">Side</th>
                      <th className="py-1.5 pr-3">Entry</th>
                      <th className="py-1.5 pr-3">Exit</th>
                      <th className="py-1.5 pr-3">Bars</th>
                      <th className="py-1.5 pr-3">P&amp;L</th>
                      <th className="py-1.5 pr-3">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.trades.slice(-20).reverse().map((t, i) => (
                      <tr key={i} className="border-t border-white/5">
                        <td className={`py-1.5 pr-3 ${t.side === "long" ? "text-bull" : "text-bear"}`}>
                          {t.side}
                        </td>
                        <td className="py-1.5 pr-3">${t.entryPrice.toFixed(2)}</td>
                        <td className="py-1.5 pr-3">${t.exitPrice.toFixed(2)}</td>
                        <td className="py-1.5 pr-3">{t.barsHeld}</td>
                        <td className={`py-1.5 pr-3 ${t.pnl >= 0 ? "text-bull" : "text-bear"}`}>
                          {t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(0)} ({t.pnlPct.toFixed(2)}%)
                        </td>
                        <td className="py-1.5 pr-3 text-muted">{t.exitReason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      )}
    </main>
  );
}

function Metric({
  label,
  value,
  tone
}: {
  label: string;
  value: string;
  tone?: "warn" | "neutral";
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted">{label}</p>
      <p className={`text-base ${tone === "warn" ? "text-warn" : "text-primary"}`}>{value}</p>
    </div>
  );
}

function safeNum(n: number | null | undefined): number {
  if (n === null || n === undefined || !Number.isFinite(n)) return 0;
  return n;
}

function fmtPct(n: number, digits: number = 1): string {
  return `${safeNum(n).toFixed(digits)}%`;
}
