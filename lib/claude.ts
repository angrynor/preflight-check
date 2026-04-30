import Anthropic from "@anthropic-ai/sdk";
import { renderChartVisionPrompt } from "./prompts";

const VISION_MODEL = "claude-sonnet-4-6";
const REPORT_MODEL = "claude-sonnet-4-6";
const MAX_REPORT_TOKENS = 2000;
const MAX_VISION_TOKENS = 400;
const RUN_USER_MESSAGE = "Run the pre-flight check for the trade described in the system prompt.";

let cachedClient: Anthropic | null = null;

export function getClient(): Anthropic {
  if (cachedClient) return cachedClient;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }
  cachedClient = new Anthropic({ apiKey });
  return cachedClient;
}

export interface VisionInput {
  base64: string;
  mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  timeframe?: string;
}

function isRetryable(err: unknown): boolean {
  if (err instanceof Anthropic.APIError) {
    const s = err.status ?? 0;
    return s === 408 || s === 409 || s === 429 || s >= 500;
  }
  return false;
}

async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!isRetryable(err)) throw err;
    console.warn(`[claude] ${label} retryable error, backing off 750ms: ${err instanceof Error ? err.message : err}`);
    await new Promise((r) => setTimeout(r, 750));
    return fn();
  }
}

export async function describeChart(image: VisionInput): Promise<string> {
  const client = getClient();
  const visionPrompt = renderChartVisionPrompt(image.timeframe ?? "auto");
  const res = await withRetry("describeChart", () =>
    client.messages.create({
      model: VISION_MODEL,
      max_tokens: MAX_VISION_TOKENS,
      system: visionPrompt,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: image.mediaType, data: image.base64 }
            },
            { type: "text", text: "Describe this chart per the format above." }
          ]
        }
      ]
    })
  );
  return res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

export interface StreamReportArgs {
  prompt: string;
  signal?: AbortSignal;
}

export async function* streamReport({ prompt, signal }: StreamReportArgs): AsyncIterable<string> {
  const client = getClient();
  let stream: ReturnType<Anthropic["messages"]["stream"]>;
  try {
    stream = client.messages.stream(
      {
        model: REPORT_MODEL,
        max_tokens: MAX_REPORT_TOKENS,
        system: prompt,
        messages: [{ role: "user", content: RUN_USER_MESSAGE }]
      },
      { signal }
    );
    // probe: ensure the first event arrives without a retryable error
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        yield event.delta.text;
      }
    }
    return;
  } catch (err) {
    if (!isRetryable(err)) throw err;
    console.warn(`[claude] streamReport retryable error, backing off 750ms: ${err instanceof Error ? err.message : err}`);
    await new Promise((r) => setTimeout(r, 750));
  }

  // Single retry
  const retryStream = client.messages.stream(
    {
      model: REPORT_MODEL,
      max_tokens: MAX_REPORT_TOKENS,
      system: prompt,
      messages: [{ role: "user", content: RUN_USER_MESSAGE }]
    },
    { signal }
  );
  for await (const event of retryStream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      yield event.delta.text;
    }
  }
}

export function detectImageMediaType(base64Header: string): VisionInput["mediaType"] {
  const trimmed = base64Header.trim();
  // Base64 prefixes (case-sensitive — base64 is)
  if (trimmed.startsWith("iVBORw0KGgo")) return "image/png";
  if (trimmed.startsWith("/9j/")) return "image/jpeg";
  if (trimmed.startsWith("UklG") || trimmed.startsWith("RIFF")) return "image/webp";
  if (trimmed.startsWith("R0lGOD")) return "image/gif";
  return "image/png";
}
