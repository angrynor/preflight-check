"use client";

import ReactMarkdown from "react-markdown";
import { REQUIRED_REPORT_SECTIONS } from "@/lib/prompts";

interface Props {
  text: string;
  streaming: boolean;
  error: string | null;
}

interface Section {
  heading: string;
  body: string;
  variant: "bull" | "bear" | "warn" | "size" | "exit" | "neutral";
}

export function RiskReport({ text, streaming, error }: Props) {
  if (!text && !streaming && !error) return null;

  const sections = parseSections(text);
  const missing = checkMissingSections(text);

  return (
    <section
      className="mt-8 panel report-prose"
      aria-live="polite"
      data-testid="risk-report"
    >
      {error && (
        <div className="rounded-md border border-bear/30 bg-bear/10 px-3 py-2 text-sm text-bear mb-4">
          {error}
        </div>
      )}

      {sections.length === 0 && streaming && (
        <p className="text-muted text-sm">
          Pulling live market data and waking the risk officer<span className="cursor-blink" />
        </p>
      )}

      {sections.length === 0 && !streaming && text && (
        <ReactMarkdown>{text}</ReactMarkdown>
      )}

      {sections.map((s, i) => (
        <div key={`${s.heading}-${i}`} className={`section-${s.variant}`} data-testid={`section-${s.variant}`}>
          <ReactMarkdown>{`## ${s.heading}\n\n${s.body}`}</ReactMarkdown>
          {streaming && i === sections.length - 1 && (
            <span className="cursor-blink" aria-hidden />
          )}
        </div>
      ))}

      {!streaming && missing.length > 0 && (
        <div className="mt-4 rounded-md border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn">
          Note: the report is missing expected section(s): {missing.join(", ")}.
        </div>
      )}
    </section>
  );
}

function parseSections(text: string): Section[] {
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  const out: Section[] = [];
  let current: Section | null = null;

  for (const line of lines) {
    const headingMatch = line.match(/^#{1,3}\s+(.+?)\s*$/);
    if (headingMatch) {
      if (current) out.push(current);
      const headingText = headingMatch[1].replace(/^\d+\.\s*/, "").trim();
      current = {
        heading: headingText,
        body: "",
        variant: variantFromHeading(headingText)
      };
    } else if (current) {
      current.body += (current.body ? "\n" : "") + line;
    }
  }
  if (current) out.push(current);
  return out;
}

function variantFromHeading(h: string): Section["variant"] {
  const upper = h.toUpperCase();
  if (upper.includes("BULL")) return "bull";
  if (upper.includes("BEAR")) return "bear";
  if (upper.includes("WARNING") || upper.includes("FLAG")) return "warn";
  if (upper.includes("EXIT") || upper.includes("TRIGGER")) return "exit";
  if (upper.includes("SIZ")) return "size";
  return "neutral";
}

function checkMissingSections(text: string): string[] {
  if (!text) return [];
  const upper = text.toUpperCase();
  return REQUIRED_REPORT_SECTIONS.filter((s) => !upper.includes(s));
}
