import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { cardPartsFromApi, cardProps } from "@/lib/pnlCard";
import { loadPnlCard } from "@/lib/pnlCardApi";
import { THEME_CARD_ACCENT, THEME_CARD_LOSS, THEME_CARD_MUTED, THEME_CARD_RULE, THEME_CARD_SHADE, THEME_CHARCOAL, THEME_IVORY } from "@/lib/theme-colors";

export const alt = "A ZENO PNL card";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/// The shareable PNL card as an image. It is the in-app `PnlCard` laid out for 1200 x 630: ivory ground, a
/// double-rule frame, a serif figure that dominates (docs/UI_CONTRACT.md Sections 4 and 5). Same formatter as the
/// page (`cardProps`), so the image and the page can never disagree on a figure. The edge renderer takes inline
/// styles only, which is why the colours come from `theme-colors.ts`, and it needs the fonts handed to it: the
/// Playfair Display 600 and Inter 500 latin files in `src/assets/fonts`, the same two faces the page uses. The
/// Playfair file has its lining figures (`lnum`) mapped onto the plain digits, because the renderer ignores
/// `font-feature-settings` and Playfair's own default figures are old-style, which read badly for money.
const fontFile = (name: string) => readFile(join(process.cwd(), "src/assets/fonts", name));

export default async function PnlCardImage({ params }: { params: Promise<{ wallet: string; positionId: string }> }) {
  const { wallet, positionId } = await params;
  const [mark, playfair, inter] = await Promise.all([
    readFile(join(process.cwd(), "src/assets/zeno-mark.png")),
    fontFile("playfair-display-latin-600-lining.woff"),
    fontFile("inter-latin-500.woff"),
  ]);
  const markSrc = `data:image/png;base64,${mark.toString("base64")}`;
  const options = {
    ...size,
    fonts: [
      { name: "Playfair", data: playfair, weight: 600 as const, style: "normal" as const },
      { name: "Inter", data: inter, weight: 500 as const, style: "normal" as const },
    ],
  };
  const frame = (children: React.ReactNode, padding: string) => (
    <div style={{ width: "100%", height: "100%", display: "flex", padding: 14, background: THEME_IVORY, border: `2px solid ${THEME_CARD_ACCENT}`, fontFamily: "Inter" }}>
      <div style={{ flex: 1, display: "flex", padding, border: `2px solid ${THEME_CARD_RULE}`, background: `linear-gradient(180deg, ${THEME_IVORY}, ${THEME_CARD_SHADE})`, color: THEME_CHARCOAL }}>
        {children}
      </div>
    </div>
  );
  const result = await loadPnlCard(wallet, positionId);

  if (result.kind !== "ok") {
    return new ImageResponse(
      frame(
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", flex: 1 }}>
          <div style={{ fontSize: 56, letterSpacing: 18 }}>ZENO</div>
          <div style={{ fontSize: 34, color: THEME_CARD_MUTED, marginTop: 24 }}>This PNL card is not available.</div>
        </div>,
        "0 72px",
      ),
      options,
    );
  }

  const p = cardProps(cardPartsFromApi(result.card));
  const ruleColour = p.direction === "loss" ? THEME_CARD_LOSS : p.direction === "gain" ? THEME_CARD_ACCENT : THEME_CARD_MUTED;
  const caps = { fontSize: 20, letterSpacing: 4, color: THEME_CARD_MUTED, textTransform: "uppercase" as const };
  const stat = (text: string, value: string, first = false) => (
    <div style={{ display: "flex", flexDirection: "column", padding: first ? "0 48px 0 0" : "0 48px", borderLeft: first ? "none" : `2px solid ${THEME_CARD_RULE}` }}>
      <div style={caps}>{text}</div>
      <div style={{ fontSize: 34, marginTop: 8 }}>{value}</div>
    </div>
  );
  const host = (() => {
    try {
      return new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "").host;
    } catch {
      return "";
    }
  })();

  return new ImageResponse(
    frame(
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingBottom: 22, borderBottom: `2px solid ${THEME_CARD_RULE}` }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            {/* The ring is pale, so on the ivory card it sits on a charcoal tile. */}
            <div style={{ display: "flex", background: THEME_CHARCOAL, padding: "8px 12px", marginRight: 20 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={markSrc} width={72} height={38} alt="" />
            </div>
            <div style={{ fontSize: 30, letterSpacing: 10 }}>ZENO</div>
          </div>
          {p.sample ? <div style={{ display: "flex", fontSize: 20, letterSpacing: 4, background: THEME_CHARCOAL, color: THEME_IVORY, padding: "6px 14px" }}>SAMPLE DATA</div> : null}
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "baseline" }}>
            <div style={{ fontFamily: "Playfair", fontSize: 46 }}>{`${p.symbol}-PERP`}</div>
            <div style={{ ...caps, fontSize: 24, color: THEME_CHARCOAL, marginLeft: 28 }}>{`${p.side} ${p.leverage}x`}</div>
            <div style={{ ...caps, fontSize: 24, marginLeft: 28 }}>{p.status}</div>
          </div>
          <div style={{ display: "flex", width: 48, height: 5, background: ruleColour, marginTop: 26 }} />
          <div style={{ ...caps, marginTop: 14 }}>Total PNL</div>
          <div style={{ fontFamily: "Playfair", fontSize: 128, letterSpacing: -3, lineHeight: 1.05 }}>{p.pnl}</div>
          <div style={{ display: "flex", alignItems: "center", fontSize: 40, marginTop: 4 }}>
            {p.direction === "flat" ? null : (
              <svg width={22} height={18} viewBox="0 0 22 18" style={{ marginRight: 16 }}>
                <polygon points={p.direction === "gain" ? "11,0 22,18 0,18" : "0,0 22,0 11,18"} fill={ruleColour} />
              </svg>
            )}
            {p.roi}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", paddingTop: 24, borderTop: `2px solid ${THEME_CARD_RULE}` }}>
          <div style={{ display: "flex" }}>
            {stat("Entry", p.entry, true)}
            {stat(p.status === "open" ? "Mark" : "Exit", p.exit ?? "–")}
            {stat("Size", p.size)}
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", fontSize: 22, color: THEME_CARD_MUTED }}>
            <div>{p.period ?? ""}</div>
            {host ? <div style={{ marginTop: 6, letterSpacing: 2 }}>{host}</div> : null}
          </div>
        </div>
      </div>,
      "36px 60px",
    ),
    options,
  );
}
