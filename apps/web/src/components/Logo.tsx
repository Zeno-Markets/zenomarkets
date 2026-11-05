import Image from "next/image";
import mark from "@/assets/zeno-mark.png";

/// The ZENOMARKETS mark (the glass lime tile from the brand file) and the wordmark, set apart by a hairline. The
/// wordmark is one face in two weights, widely tracked capitals: ZENO in semibold, MARKETS light and quieter. The
/// image is decorative beside the text; the link around it has its own aria-label. `sm` is the footer and share-card
/// size.
export function Logo({ size = "md" }: { size?: "md" | "sm" }) {
  const small = size === "sm";
  return (
    <span className="group/logo inline-flex items-center gap-3">
      <Image
        src={mark}
        alt=""
        priority
        className={`${small ? "h-8 w-8" : "h-9 w-9 sm:h-10 sm:w-10"} rounded-[22%] shadow-[0_6px_18px_-6px_rgb(10_12_5/0.6)] transition-transform duration-300 ease-out group-hover/logo:-rotate-6 group-hover/logo:scale-105`}
      />
      <span aria-hidden className={`w-px bg-current opacity-15 ${small ? "h-5" : "h-6"}`} />
      {/* The negative right margin takes back the tracking after the last letter, so the word ends on its glyph. */}
      <span className={`flex items-baseline gap-[0.4em] leading-none tracking-[0.24em] -mr-[0.24em] ${small ? "text-[13px]" : "text-[14px] sm:text-[15px]"}`}>
        <span className="font-semibold">ZENO</span>
        <span className="font-light text-muted transition-colors duration-300 group-hover/logo:text-accent-fg">MARKETS</span>
      </span>
    </span>
  );
}
