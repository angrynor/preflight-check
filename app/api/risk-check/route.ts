import { NextRequest, NextResponse } from "next/server";
import { buildRiskOfficerPrompt } from "@/lib/buildPrompt";
import { deriveValues } from "@/lib/calculations";
import { describeChart, detectImageMediaType, streamReport } from "@/lib/claude";
import { buildMarketSnapshot } from "@/lib/marketSnapshot";
import { validateRiskCheckRequest } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BODY_BYTES = 7 * 1024 * 1024; // 7MB — comfortably above 5MB image budget after base64 inflation

export async function POST(req: NextRequest): Promise<Response> {
  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: `Request body too large (${(contentLength / 1_048_576).toFixed(1)}MB). Max 7MB.` },
      { status: 413 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const validated = validateRiskCheckRequest(body);
  if (!validated.ok || !validated.data) {
    return NextResponse.json(
      { error: validated.error ?? "Invalid request." },
      { status: 400 }
    );
  }
  const request = validated.data;

  let snapshot;
  try {
    snapshot = await buildMarketSnapshot(request.coin);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Live market data unavailable.";
    console.error(`[risk-check] market snapshot failed for ${request.coin}: ${message}`);
    return NextResponse.json(
      { error: "Live market data unavailable, please try again in a moment." },
      { status: 503 }
    );
  }

  for (const w of snapshot.warnings) {
    console.warn(`[risk-check] ${request.coin} snapshot warning: ${w}`);
  }

  const derived = deriveValues({
    entry: request.entry,
    leverage: request.leverage,
    direction: request.direction,
    stop: request.stop,
    accountSize: request.accountSize,
    riskPct: request.riskPct,
    mode: request.mode
  });

  let chartContext: string | null = null;
  if (request.screenshotBase64) {
    try {
      const mediaType = detectImageMediaType(request.screenshotBase64.slice(0, 30));
      chartContext = await describeChart({
        base64: request.screenshotBase64,
        mediaType,
        timeframe: request.chartTimeframe ?? "auto"
      });
    } catch (err) {
      console.warn(
        `[risk-check] vision parse failed: ${err instanceof Error ? err.message : err}`
      );
      chartContext = null;
    }
  }

  let prompt: string;
  try {
    prompt = buildRiskOfficerPrompt({ request, derived, snapshot, chartContext });
  } catch (err) {
    console.error(`[risk-check] prompt assembly failed: ${err}`);
    return NextResponse.json(
      { error: "Failed to assemble risk officer prompt." },
      { status: 500 }
    );
  }

  const encoder = new TextEncoder();
  const claudeIter = streamReport({ prompt, signal: req.signal });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of claudeIter) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[risk-check] claude stream failed: ${message}`);
        try {
          controller.enqueue(
            encoder.encode(
              `\n\n[error] ${message}. Please try again in a moment.`
            )
          );
        } catch {
          // controller may already be closed
        }
        controller.close();
      }
    }
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "X-Snapshot-Source": snapshot.source,
      "X-Snapshot-Warnings": String(snapshot.warnings.length)
    }
  });
}

export async function GET(): Promise<Response> {
  return NextResponse.json({
    name: "risk-check",
    method: "POST",
    description:
      "Submit a JSON body with coin, direction, leverage, entry, stop, accountSize, and optional screenshotBase64."
  });
}
