import Image from "next/image";
import mark from "@/assets/zeno-mark.png";

/// The ZENOMARKETS mark (the glass lime tile from the brand file) beside the wordmark: "ZENO" in the display
/// face, "MARKETS" in the pixel face. The image is decorative beside the text; the link around it has its own
/// aria-label. `sm` is the footer and share-card size.
export function Logo({ size = "md" }: { size?: "md" | "sm" }) {
  const small = size === "sm";
  return (
    <span className="group/logo inline-flex items-center gap-2.5">
      <Image
        src={mark}
        alt=""
        priority
        className={`${small ? "h-8 w-8" : "h-9 w-9 sm:h-10 sm:w-10"} rounded-[22%] shadow-[0_6px_18px_-6px_rgb(10_12_5/0.6)] transition-transform duration-300 ease-out group-hover/logo:-rotate-6 group-hover/logo:scale-105`}
      />
      <span className={`flex items-baseline leading-none ${small ? "text-lg" : "text-[1.2rem] sm:text-[1.35rem]"}`}>
        <span className="font-display font-semibold tracking-[-0.04em]">ZENO</span>
        <span className="font-pixel font-medium tracking-[0.02em] text-muted transition-colors duration-300 group-hover/logo:text-accent-fg">MARKETS</span>
      </span>
    </span>
  );
}
