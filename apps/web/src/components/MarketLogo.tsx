"use client";

import { logoForSymbol } from "@zeno/config";
import { cn } from "@zeno/ui";
import { useState } from "react";
import { SYMBOL_LOGO } from "./BrandLogos";
import { MONO } from "@/lib/frame";

/// A market's logo: the image recorded for the symbol in `@zeno/config`, else the hand-drawn brand mark if there is
/// one, else the ticker's first letters. It never leaves a hole: an image that fails to load drops to the next.
export function MarketLogo({ symbol, className }: { symbol: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  const src = logoForSymbol(symbol);
  const brand = SYMBOL_LOGO[symbol];
  const box = cn("grid size-7 shrink-0 place-items-center overflow-hidden rounded-full", className);
  if (src?.startsWith("https://") && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt="" width={28} height={28} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} className={cn(box, "bg-white object-contain")} />
    );
  }
  if (brand) {
    return (
      <span aria-hidden="true" className={box} style={{ background: brand.background, color: brand.ink }}>
        <brand.Logo className="size-4" />
      </span>
    );
  }
  return (
    <span aria-hidden="true" className={cn(box, MONO, "border border-line text-[10px] uppercase text-muted")}>
      {symbol.slice(0, 2)}
    </span>
  );
}
