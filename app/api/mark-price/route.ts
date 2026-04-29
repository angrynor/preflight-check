import { NextRequest, NextResponse } from "next/server";
import { getPremiumIndex } from "@/lib/binance";
import { getFallbackPrice } from "@/lib/coingecko";
import { isSupportedCoin } from "@/lib/coins";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const { searchParams } = new URL(req.url);
  const coinRaw = searchParams.get("coin");
  if (!coinRaw) {
    return NextResponse.json({ error: "coin query param required" }, { status: 400 });
  }
  const coin = coinRaw.toUpperCase();
  if (!isSupportedCoin(coin)) {
    return NextResponse.json({ error: "Unsupported coin." }, { status: 400 });
  }
  try {
    const premium = await getPremiumIndex(coin);
    return NextResponse.json({ markPrice: premium.markPrice, source: "binance" });
  } catch (err) {
    console.warn(
      `[mark-price] binance failed for ${coin}, trying coingecko: ${err instanceof Error ? err.message : err}`
    );
    try {
      const price = await getFallbackPrice(coin);
      return NextResponse.json({ markPrice: price, source: "coingecko" });
    } catch (err2) {
      console.error(
        `[mark-price] both feeds failed for ${coin}: ${err2 instanceof Error ? err2.message : err2}`
      );
      return NextResponse.json(
        { error: "Live mark price unavailable." },
        { status: 503 }
      );
    }
  }
}
