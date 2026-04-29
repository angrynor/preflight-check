"use client";

import { useEffect, useState } from "react";
import { TOP_COINS } from "@/lib/coins";
import { ScreenshotUpload } from "./ScreenshotUpload";

export interface TradeFormValues {
  coin: string;
  direction: "long" | "short";
  leverage: number;
  entry: string;
  stop: string;
  accountSize: string;
  screenshotBase64: string | null;
}

interface Props {
  onSubmit: (v: TradeFormValues) => void;
  busy?: boolean;
}

const DEFAULT: TradeFormValues = {
  coin: "BTC",
  direction: "long",
  leverage: 10,
  entry: "",
  stop: "",
  accountSize: "10000",
  screenshotBase64: null
};

export function TradeForm({ onSubmit, busy }: Props) {
  const [values, setValues] = useState<TradeFormValues>(DEFAULT);
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
    if (values.stop !== "") {
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
          <span>1x</span>
          <span>25x</span>
          <span>50x</span>
          <span>75x</span>
          <span>100x</span>
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
            placeholder="autofills from Binance"
            disabled={busy}
          />
          {autofillError && <p className="mt-1 text-xs text-warn">{autofillError}</p>}
        </div>
        <div>
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
        </div>
      </div>

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

      <ScreenshotUpload value={screenshot} onChange={setScreenshot} disabled={busy} />

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
