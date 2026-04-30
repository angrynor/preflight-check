import { Footer } from "@/components/Footer";
import { StrategyLab } from "@/components/StrategyLab";

export const metadata = {
  title: "Strategy Lab — Pre-Flight Check",
  description: "Backtest popular crypto trading strategies on real OKX data with realistic costs."
};

export default function LabPage() {
  return (
    <>
      <StrategyLab />
      <div className="mx-auto max-w-[920px] px-4 sm:px-6 pb-6">
        <Footer />
      </div>
    </>
  );
}
