"use client";

import { useState } from "react";
import { Footer } from "@/components/Footer";
import { RiskReport } from "@/components/RiskReport";
import { TradeForm, type TradeFormValues } from "@/components/TradeForm";

export default function Home() {
  const [report, setReport] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(values: TradeFormValues) {
    setReport("");
    setStreaming(true);
    setError(null);

    try {
      const res = await fetch("/api/risk-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          coin: values.coin,
          direction: values.direction,
          leverage: values.leverage,
          entry: Number(values.entry),
          stop: values.stop === "" ? null : Number(values.stop),
          accountSize: Number(values.accountSize),
          screenshotBase64: values.screenshotBase64 ?? undefined
        })
      });

      if (!res.ok) {
        let message = `Request failed (${res.status}).`;
        try {
          const data = (await res.json()) as { error?: string };
          if (data.error) message = data.error;
        } catch {
          // body wasn't json
        }
        setError(message);
        setStreaming(false);
        return;
      }

      if (!res.body) {
        setError("Empty response from server.");
        setStreaming(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setReport(acc);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error.");
    } finally {
      setStreaming(false);
    }
  }

  return (
    <main className="mx-auto max-w-[720px] px-4 sm:px-6 pt-10 sm:pt-14 pb-6">
      <header className="mb-8">
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
          Pre-Flight Check
        </h1>
        <p className="mt-2 text-sm text-muted">
          Pre-trade risk check for crypto perp traders.
        </p>
      </header>

      <TradeForm onSubmit={handleSubmit} busy={streaming} />

      <RiskReport text={report} streaming={streaming} error={error} />

      <Footer />
    </main>
  );
}
