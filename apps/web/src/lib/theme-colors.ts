/// The palette values that render outside Tailwind's reach — the browser-chrome `themeColor` in
/// `layout.tsx`, the edge-rendered `opengraph-image.tsx`, and the landing page's WebGL canvas,
/// which reads the CSS variables at runtime and needs a literal to fall back to before the
/// stylesheet resolves. They mirror the light (default) theme in `globals.css`
/// (docs/UI_CONTRACT.md Section 4). If the palette moves, this is the one other place to update, and
/// `scripts/check-hex.sh` allows hex literals only here.
export const THEME_GROUND = "#ffffff";
export const THEME_TEXT = "#12140c";
export const THEME_MUTED = "#53564a";

/// The PNL card, which is ivory in both themes, for the edge-rendered share image. The share image
/// draws the card itself, so it uses the fixed card values: charcoal on ivory, a deep green frame and
/// gain bar (5.76:1), a brick loss bar (8.54:1), and charcoal at 70% over ivory for muted ink (7.13:1).
export const THEME_IVORY = "#f3f1ea";
export const THEME_CHARCOAL = "#0b0b0b";
export const THEME_CARD_ACCENT = "#1d6b3f";
export const THEME_CARD_LOSS = "#7a2a1d";
export const THEME_CARD_MUTED = "#514f4e";
/// The PNL card's inner rule (charcoal at 15% over ivory) and the foot of its ivory-to-shade wash (charcoal at 5%
/// over ivory), flattened because the edge renderer has no `color-mix`. They match `border-charcoal/15` and the
/// `to-[color-mix(...95%...)]` stop in `packages/ui/src/PnlCard.tsx`.
export const THEME_CARD_RULE = "#d0cec9";
export const THEME_CARD_SHADE = "#e7e5df";

/// The landing page's 3D logo (components/zeno/LogoOrb.tsx) is lit in WebGL, outside Tailwind's reach, and looks the
/// same in both themes. Lime, ink and paper mirror `--color-lime`, `--color-ink` and `--color-paper` in globals.css;
/// olive is the brand lime darkened for the shaded voxels.
export const THEME_LIME = "#d2f53a";
export const THEME_OLIVE = "#6f8a0b";
export const THEME_INK = "#0a0c05";
export const THEME_PAPER = "#eef2e2";
