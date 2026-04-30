"use client";

import { useMemo } from "react";

interface Props {
  equity: number[];
  benchmark?: number[];
  startingEquity: number;
  width?: number;
  height?: number;
}

/** Lightweight SVG line chart for equity curves. No external deps. */
export function EquityChart({
  equity,
  benchmark,
  startingEquity,
  width = 720,
  height = 240
}: Props) {
  const { strategyPath, benchPath, baselineY, minY, maxY, ticks, labels } = useMemo(() => {
    const padX = 48;
    const padY = 16;
    const innerW = width - padX * 2;
    const innerH = height - padY * 2;

    const allValues: number[] = [...equity];
    if (benchmark) allValues.push(...benchmark);
    allValues.push(startingEquity);
    let minVal = Math.min(...allValues);
    let maxVal = Math.max(...allValues);
    // Add 5% padding to vertical range
    const pad = (maxVal - minVal) * 0.05 || maxVal * 0.05;
    minVal -= pad;
    maxVal += pad;
    if (maxVal === minVal) maxVal = minVal + 1;

    const xFor = (i: number, len: number): number =>
      padX + (i / Math.max(1, len - 1)) * innerW;
    const yFor = (v: number): number =>
      padY + innerH - ((v - minVal) / (maxVal - minVal)) * innerH;

    const buildPath = (series: number[]): string => {
      if (series.length === 0) return "";
      let d = `M ${xFor(0, series.length).toFixed(2)} ${yFor(series[0]).toFixed(2)}`;
      for (let i = 1; i < series.length; i++) {
        d += ` L ${xFor(i, series.length).toFixed(2)} ${yFor(series[i]).toFixed(2)}`;
      }
      return d;
    };

    const labels: { x: number; y: number; text: string }[] = [];
    // Y-axis labels at min, mid, max
    [minVal, (minVal + maxVal) / 2, maxVal].forEach((v) => {
      labels.push({
        x: padX - 8,
        y: yFor(v) + 3,
        text: `$${Math.round(v).toLocaleString("en-US")}`
      });
    });

    return {
      strategyPath: buildPath(equity),
      benchPath: benchmark ? buildPath(benchmark) : null,
      baselineY: yFor(startingEquity),
      minY: yFor(minVal),
      maxY: yFor(maxVal),
      ticks: [
        { x1: padX, y: yFor(maxVal) },
        { x2: width - padX, y: yFor(maxVal) }
      ],
      labels
    };
  }, [equity, benchmark, startingEquity, width, height]);

  if (equity.length === 0) {
    return (
      <div className="text-muted text-sm py-8 text-center border border-white/5 rounded-md">
        No equity data yet. Run a backtest above.
      </div>
    );
  }

  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      className="bg-bg/50 rounded-md border border-white/5"
      data-testid="equity-chart"
    >
      {/* Baseline (starting equity) */}
      <line
        x1={48}
        y1={baselineY}
        x2={width - 48}
        y2={baselineY}
        stroke="rgba(255,255,255,0.08)"
        strokeDasharray="4 4"
      />
      {/* Top + bottom borders */}
      <line x1={48} y1={maxY} x2={width - 48} y2={maxY} stroke="rgba(255,255,255,0.04)" />
      <line x1={48} y1={minY} x2={width - 48} y2={minY} stroke="rgba(255,255,255,0.04)" />

      {/* Y labels */}
      {labels.map((l, i) => (
        <text
          key={i}
          x={l.x}
          y={l.y}
          textAnchor="end"
          fontSize="10"
          fontFamily="var(--font-mono), ui-monospace, monospace"
          fill="#9CA3AF"
        >
          {l.text}
        </text>
      ))}

      {/* Benchmark line (buy and hold) */}
      {benchPath && (
        <path
          d={benchPath}
          fill="none"
          stroke="#9CA3AF"
          strokeWidth={1.2}
          strokeDasharray="4 3"
        />
      )}
      {/* Strategy line */}
      <path d={strategyPath} fill="none" stroke="#00E0FF" strokeWidth={1.6} />

      {/* Legend */}
      <g transform={`translate(${width - 220}, 16)`}>
        <rect x={0} y={-10} width={210} height={36} fill="rgba(20,20,22,0.7)" rx={4} />
        <line x1={6} y1={-1} x2={22} y2={-1} stroke="#00E0FF" strokeWidth={2} />
        <text x={28} y={3} fontSize="10" fill="#F5F5F5" fontFamily="var(--font-mono), monospace">
          Strategy
        </text>
        {benchmark && (
          <>
            <line x1={6} y1={15} x2={22} y2={15} stroke="#9CA3AF" strokeWidth={1.4} strokeDasharray="3 2" />
            <text x={28} y={19} fontSize="10" fill="#9CA3AF" fontFamily="var(--font-mono), monospace">
              Buy and Hold
            </text>
          </>
        )}
      </g>
    </svg>
  );
}
