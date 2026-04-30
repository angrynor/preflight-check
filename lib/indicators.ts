/**
 * Pure functions for technical indicators. No state, no side effects.
 * Each function returns an array of the same length as the input, with
 * `null` for the warmup period when there isn't enough data yet.
 */

export type Series = ReadonlyArray<number>;

export function sma(values: Series, period: number): (number | null)[] {
  if (period <= 0) throw new Error("sma: period must be positive");
  const out: (number | null)[] = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function ema(values: Series, period: number): (number | null)[] {
  if (period <= 0) throw new Error("ema: period must be positive");
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  // Seed with SMA of first `period` values
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  out[period - 1] = sum / period;
  for (let i = period; i < values.length; i++) {
    const prev = out[i - 1] as number;
    out[i] = values[i] * k + prev * (1 - k);
  }
  return out;
}

/** Wilder's RSI with the standard 14-period default. */
export function rsi(values: Series, period: number = 14): (number | null)[] {
  if (period <= 0) throw new Error("rsi: period must be positive");
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length <= period) return out;
  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const change = values[i] - values[i - 1];
    if (change >= 0) gainSum += change;
    else lossSum += -change;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  out[period] = computeRsi(avgGain, avgLoss);
  for (let i = period + 1; i < values.length; i++) {
    const change = values[i] - values[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = computeRsi(avgGain, avgLoss);
  }
  return out;
}

function computeRsi(avgGain: number, avgLoss: number): number {
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export interface BollingerOutput {
  middle: (number | null)[];
  upper: (number | null)[];
  lower: (number | null)[];
}

export function bollingerBands(
  values: Series,
  period: number = 20,
  stdMultiplier: number = 2
): BollingerOutput {
  const middle = sma(values, period);
  const upper: (number | null)[] = new Array(values.length).fill(null);
  const lower: (number | null)[] = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    const mean = middle[i];
    if (mean === null) continue;
    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const diff = values[j] - mean;
      variance += diff * diff;
    }
    const std = Math.sqrt(variance / period);
    upper[i] = mean + stdMultiplier * std;
    lower[i] = mean - stdMultiplier * std;
  }
  return { middle, upper, lower };
}

export interface MacdOutput {
  macd: (number | null)[];
  signal: (number | null)[];
  histogram: (number | null)[];
}

export function macd(
  values: Series,
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9
): MacdOutput {
  const fastEma = ema(values, fastPeriod);
  const slowEma = ema(values, slowPeriod);
  const macdLine: (number | null)[] = values.map((_, i) => {
    const f = fastEma[i];
    const s = slowEma[i];
    return f === null || s === null ? null : f - s;
  });
  // Build a signal-line input that drops nulls for EMA seeding to be correct.
  const macdValues: number[] = [];
  const macdValueIndexes: number[] = [];
  for (let i = 0; i < macdLine.length; i++) {
    if (macdLine[i] !== null) {
      macdValues.push(macdLine[i] as number);
      macdValueIndexes.push(i);
    }
  }
  const signalCompact = ema(macdValues, signalPeriod);
  const signal: (number | null)[] = new Array(values.length).fill(null);
  for (let j = 0; j < signalCompact.length; j++) {
    const idx = macdValueIndexes[j];
    signal[idx] = signalCompact[j];
  }
  const histogram: (number | null)[] = values.map((_, i) => {
    const m = macdLine[i];
    const s = signal[i];
    return m === null || s === null ? null : m - s;
  });
  return { macd: macdLine, signal, histogram };
}

/** Average True Range. Returns ATR series of same length as input candles. */
export function atr(
  highs: Series,
  lows: Series,
  closes: Series,
  period: number = 14
): (number | null)[] {
  if (highs.length !== lows.length || lows.length !== closes.length) {
    throw new Error("atr: high/low/close arrays must be same length");
  }
  const tr: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i === 0) {
      tr.push(highs[i] - lows[i]);
    } else {
      const range = Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1])
      );
      tr.push(range);
    }
  }
  return ema(tr, period);
}

export interface DonchianOutput {
  upper: (number | null)[];
  lower: (number | null)[];
  middle: (number | null)[];
}

/** Donchian channel — highest high / lowest low over `period` lookback. */
export function donchian(
  highs: Series,
  lows: Series,
  period: number
): DonchianOutput {
  const upper: (number | null)[] = new Array(highs.length).fill(null);
  const lower: (number | null)[] = new Array(highs.length).fill(null);
  const middle: (number | null)[] = new Array(highs.length).fill(null);
  for (let i = period - 1; i < highs.length; i++) {
    let hi = -Infinity;
    let lo = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (highs[j] > hi) hi = highs[j];
      if (lows[j] < lo) lo = lows[j];
    }
    upper[i] = hi;
    lower[i] = lo;
    middle[i] = (hi + lo) / 2;
  }
  return { upper, lower, middle };
}

/** Detect a crossover at index i — true when a[i-1] <= b[i-1] AND a[i] > b[i]. */
export function crossedAbove(
  a: ReadonlyArray<number | null>,
  b: ReadonlyArray<number | null>,
  i: number
): boolean {
  if (i < 1) return false;
  const a0 = a[i - 1];
  const a1 = a[i];
  const b0 = b[i - 1];
  const b1 = b[i];
  if (a0 === null || a1 === null || b0 === null || b1 === null) return false;
  return a0 <= b0 && a1 > b1;
}

export function crossedBelow(
  a: ReadonlyArray<number | null>,
  b: ReadonlyArray<number | null>,
  i: number
): boolean {
  if (i < 1) return false;
  const a0 = a[i - 1];
  const a1 = a[i];
  const b0 = b[i - 1];
  const b1 = b[i];
  if (a0 === null || a1 === null || b0 === null || b1 === null) return false;
  return a0 >= b0 && a1 < b1;
}
