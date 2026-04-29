import { OMA_PREVIEW_URL } from "@/lib/constants";

export function Footer() {
  return (
    <footer className="mt-12 border-t border-white/5 pt-6 pb-10 text-xs text-muted">
      <p className="leading-relaxed">
        Built by one person in 4 hours with Claude Code. This is the second engine.{" "}
        <a
          href={OMA_PREVIEW_URL}
          className="text-accent hover:underline underline-offset-4"
          target="_blank"
          rel="noopener noreferrer"
        >
          Learn how →
        </a>
      </p>
      <p className="mt-3 text-[10px] uppercase tracking-wider text-muted/60">
        Not financial advice. Live data via Binance + CoinGecko. Always size for survival.
      </p>
    </footer>
  );
}
