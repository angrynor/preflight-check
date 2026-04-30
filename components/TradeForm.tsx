"use client";

import { useEffect, useMemo, useState } from "react";
import { deriveStopFromRiskBudget, formatUsd } from "@/lib/calculations";
import { TOP_COINS } from "@/lib/coins";
import { ScreenshotUpload } from "./ScreenshotUpload";

export type SizingMode = "stop-defined" | "risk-budget";
export type ChartTimeframe = "1m" | "5m" | "15m" | "30m" | "1h" | "4h" | "1d" | "auto";

const TIMEFRAMES: ChartTimeframe[] = ["auto", "1m", "5m", "15m", "30m", "1h", "4h", "1d"];

export interface TradeFormValues {
  coin: string;
  direction: "long" | "short";
  leverage: number;
  entry: string;
  stop: string;
  accountSize: string;
  riskPct: number;
  mode: SizingMode;
  chartTimeframe: ChartTimeframe;
  screenshotBase64: string | null;
}

interface Props {
  onSubmit: (v: TradeFormValues) => void;
  busy?: boolean;
}

const DEFAULT: Omit<TradeFormValues, "screenshotBase64"> = {
  coin: "BTC",
  direction: "long",
  leverage: 10,
  entry: "",
  stop: "",
  accountSize: "10000",
  riskPct: 1,
  mode: "stop-defined",
  chartTimeframe: "auto"
};

export function TradeForm({ onSubmit, busy }: Props) {
  const [values, setValues] = useState<typeof DEFAULT>(DEFAULT);
  const [screenshot, setScreenshot] = useState<{ name: string; base64: string } | null>(null);
  const [autofilling, setAutofilling] = useState(false);
  const [autofillError, setAutofillError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setAutofilling(true);
      setAutofillError(null);
      try {
        const res = await fetch(`/api/mark-price?coin=${values.coin}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { markPrice: number };
        if (!cancelled) {
          setValues((v) => ({ ...v, entry: formatEntry(data.markPrice) }));
        }
      } catch (err) {
        if (!cancelled) {
          setAutofillError("Could not autofill mark price. Enter it manually.");
        }
        console.warn("[autofill] mark price failed:", err);
      } finally {
        if (!cancelled) setAutofilling(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [values.coin]);

  const accountNum = Number(values.accountSize);
  const entryNum = Number(values.entry);
  const riskUsd = Number.isFinite(accountNum) ? (accountNum * values.riskPct) / 100 : 0;

  const derivedStop = useMemo(() => {
    if (values.mode !== "risk-budget") return null;
    if (!Number.isFinite(entryNum) || entryNum <= 0) return null;
    if (values.leverage <= 0) return null;
    return deriveStopFromRiskBudget(entryNum, values.leverage, values.riskPct, values.direction);
  }, [values.mode, entryNum, values.leverage, values.riskPct, values.direction]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const entry = Number(values.entry);
    const accountSize = Number(values.accountSize);
    if (!Number.isFinite(entry) || entry <= 0) {
      setFormError("Entry price must be a positive number.");
      return;
    }
    if (!Number.isFinite(accountSize) || accountSize <= 0) {
      setFormError("Account size must be a positive number.");
      return;
    }
    if (values.mode === "stop-defined" && values.stop !== "") {
      const stop = Number(values.stop);
      if (!Number.isFinite(stop) || stop <= 0) {
        setFormError("Stop must be a positive number, or leave blank.");
        return;
      }
      if (values.direction === "long" && stop >= entry) {
        setFormError("For a long, stop must be below entry.");
        return;
      }
      if (values.direction === "short" && stop <= entry) {
        setFormError("For a short, stop must be above entry.");
        return;
      }
    }
    onSubmit({ ...values, screenshotBase64: screenshot?.base64 ?? null });
  };

  return (
    <form onSubmit={submit} className="panel space-y-5" noValidate>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="coin" className="field-label">Coin</label>
          <select
            id="coin"
            value={values.coin}
            onChange={(e) => setValues({ ...values, coin: e.target.value })}
            className="field-input"
            disabled={busy}
          >
            {TOP_COINS.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div>
          <span className="field-label">Direction</span>
          <div className="grid grid-cols-2 gap-2 rounded-md border border-white/10 bg-bg p-1">
            {(["long", "short"] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setValues({ ...values, direction: d })}
                disabled={busy}
                className={[
                  "rounded px-3 py-1.5 text-sm font-medium uppercase tracking-wider transition-colors",
                  values.direction === d
                    ? d === "long"
                      ? "bg-bull/20 text-bull"
                      : "bg-bear/20 text-bear"
                    : "text-muted hover:text-primary"
                ].join(" ")}
                aria-pressed={values.direction === d}
              >
                {d}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div>
        <label htmlFor="leverage" className="field-label flex justify-between">
          <span>Leverage</span>
          <span className="font-mono text-accent">{values.leverage}x</span>
        </label>
        <input
          id="leverage"
          type="range"
          min={1}
          max={100}
          step={1}
          value={values.leverage}
          onChange={(e) => setValues({ ...values, leverage: Number(e.target.value) })}
          className="w-full accent-accent"
          disabled={busy}
        />
        <div className="mt-1 flex justify-between text-[10px] uppercase tracking-wider text-muted/60 font-mono">
          <span>1x</span><span>25x</span><span>50x</span><span>75x</span><span>100x</span>
        </div>
      </div>

      <div>
        <span className="field-label">Sizing mode</span>
        <div className="grid grid-cols-2 gap-2 rounded-md border border-white/10 bg-bg p-1">
          {(
            [
              { id: "stop-defined", label: "I'll set my stop" },
              { id: "risk-budget", label: "Calculate stop from risk %" }
            ] as const
          ).map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setValues({ ...values, mode: m.id })}
              disabled={busy}
              data-testid={`mode-${m.id}`}
              className={[
                "rounded px-3 py-1.5 text-xs font-medium uppercase tracking-wider transition-colors",
                values.mode === m.id
                  ? "bg-accent/15 text-accent"
                  : "text-muted hover:text-primary"
              ].join(" ")}
              aria-pressed={values.mode === m.id}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="entry" className="field-label flex justify-between">
            <span>Entry price</span>
            {autofilling && <span className="text-[10px] text-accent normal-case">loading…</span>}
          </label>
          <input
            id="entry"
            type="number"
            inputMode="decimal"
            step="any"
            value={values.entry}
            onChange={(e) => setValues({ ...values, entry: e.target.value })}
            className="field-input"
            placeholder="autofills from live data"
            disabled={busy}
          />
          {autofillError && <p className="mt-1 text-xs text-warn">{autofillError}</p>}
        </div>
        <div>
          {values.mode === "stop-defined" ? (
            <>
              <label htmlFor="stop" className="field-label">Stop loss (optional)</label>
              <input
                id="stop"
                type="number"
                inputMode="decimal"
                step="any"
                value={values.stop}
                onChange={(e) => setValues({ ...values, stop: e.target.value })}
                className="field-input"
                placeholder="leave blank for none"
                disabled={busy}
              />
            </>
          ) : (
            <>
              <span className="field-label">Computed stop</span>
              <div
                data-testid="derived-stop"
                className="field-input flex items-center justify-between bg-surface text-accent font-mono cursor-not-allowed"
                aria-readonly
              >
                {derivedStop ? (
                  <>
                    <span>{formatUsd(derivedStop.stopPrice)}</span>
                    <span className="text-xs text-muted">
                      {derivedStop.stopDistancePct.toFixed(3)}% away
                    </span>
                  </>
                ) : (
                  <span className="text-muted">—</span>
                )}
              </div>
              {derivedStop && derivedStop.stopDistancePct < 0.5 && (
                <p className="mt-1 text-[11px] text-warn">
                  Stop is &lt;0.5% away — too tight, you&apos;ll get wicked. Lower leverage or accept more risk.
                </p>
              )}
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="accountSize" className="field-label">Account size (USD)</label>
          <input
            id="accountSize"
            type="number"
            inputMode="decimal"
            step="any"
            value={values.accountSize}
            onChange={(e) => setValues({ ...values, accountSize: e.target.value })}
            className="field-input"
            disabled={busy}
          />
        </div>
        <div>
          <label htmlFor="riskPct" className="field-label flex justify-between">
            <span>Max risk (% of account)</span>
            <span className="font-mono text-accent">
              {values.riskPct.toFixed(2)}% · {formatUsd(riskUsd)}
            </span>
          </label>
          <input
            id="riskPct"
            type="range"
            min={0.25}
            max={5}
            step={0.25}
            value={values.riskPct}
            onChange={(e) => setValues({ ...values, riskPct: Number(e.target.value) })}
            className="w-full accent-accent"
            disabled={busy}
          />
          <div className="mt-1 flex justify-between text-[10px] uppercase tracking-wider text-muted/60 font-mono">
            <span>0.25%</span><span>1%</span><span>2%</span><span>3%</span><span>5%</span>
          </div>
        </div>
      </div>

      <ScreenshotUpload value={screenshot} onChange={setScreenshot} disabled={busy} />

      {screenshot && (
        <div>
          <label htmlFor="chartTimeframe" className="field-label">
            Chart timeframe (helps the model interpret your chart)
          </label>
          <select
            id="chartTimeframe"
            value={values.chartTimeframe}
            onChange={(e) =>
              setValues({ ...values, chartTimeframe: e.target.value as ChartTimeframe })
            }
            className="field-input"
            disabled={busy}
          >
            {TIMEFRAMES.map((tf) => (
              <option key={tf} value={tf}>
                {tf === "auto" ? "Auto-detect" : tf}
              </option>
            ))}
          </select>
        </div>
      )}

      {formError && (
        <div role="alert" className="rounded-md border border-bear/30 bg-bear/10 px-3 py-2 text-sm text-bear">
          {formError}
        </div>
      )}

      <button
        type="submit"
        disabled={busy || autofilling || values.entry === ""}
        className="w-full rounded-md bg-accent px-4 py-3 text-bg font-semibold uppercase tracking-wider text-sm
          hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {busy ? "Running pre-flight…" : "Run my Pre-Flight Check"}
      </button>
    </form>
  );
}

function formatEntry(n: number): string {
  if (n >= 1000) return n.toFixed(2);
  if (n >= 1) return n.toFixed(4);
  return n.toFixed(6);
}
