import type { ReactNode } from "react";

export type NavIconName =
  | "markets"
  | "news"
  | "perpetuals"
  | "options"
  | "strategies"
  | "lending"
  | "leaderboard"
  | "copy"
  | "portfolio"
  | "activity"
  | "alerts"
  | "docs"
  | "features"
  | "how";

/// The one solid square on each icon: the point that matters (the strike, the crown, the latest tick). It
/// echoes the square marker on the landing rail, and it is what makes the set read as Zeno's own.
const node = (cx: number, cy: number) => <rect x={cx - 1.25} y={cy - 1.25} width="2.5" height="2.5" fill="currentColor" stroke="none" />;

/// Hairline wireframe on a 16 grid, drawn from the hero's geometry (sphere, ring, isometric solids) with
/// square caps and mitred joins, like ArrowIcon. Everything is currentColor, so it follows the link's
/// muted, hover and current colours with no colour of its own.
const ICONS: Record<NavIconName, ReactNode> = {
  markets: (
    <>
      <circle cx="8" cy="8" r="6.25" />
      <ellipse cx="8" cy="8" rx="2.75" ry="6.25" />
      <path d="M1.75 8h12.5" />
      {node(12.4, 3.6)}
    </>
  ),
  news: (
    <>
      <path d="M2 2.5h9.5v11H4a2 2 0 0 1-2-2zM11.5 5.5H14v6a2 2 0 0 1-2 2" />
      <path d="M4.5 5.5h4M4.5 8h4" />
      {node(7.5, 10.9)}
    </>
  ),
  perpetuals: (
    <>
      <path d="M8 8C6 5 2 5 2 8s4 3 6 0 6-3 6 0-4 3-6 0Z" />
      {node(8, 8)}
    </>
  ),
  options: (
    <>
      <path d="M2 2v12h12" />
      <path d="M4.5 11h3L12.5 5" />
      {node(7.5, 11)}
    </>
  ),
  strategies: (
    <>
      <path d="M8 1.5l5.5 3L8 7.5l-5.5-3z" />
      <path d="M2.5 8l5.5 3 5.5-3M2.5 11.5l5.5 3 5.5-3" />
      {node(8, 4.5)}
    </>
  ),
  lending: (
    <>
      <ellipse cx="8" cy="8" rx="6.5" ry="3.4" transform="rotate(-25 8 8)" />
      <ellipse cx="8" cy="8" rx="3" ry="1.2" transform="rotate(-25 8 8)" />
      {node(12.2, 4.4)}
    </>
  ),
  leaderboard: (
    <>
      <path d="M1.5 14.5h13M2.5 14.5V10h3.5v4.5M6 14.5V6.5h4v8M10 14.5V9.5h3.5v5" />
      {node(8, 3.5)}
    </>
  ),
  copy: (
    <>
      <path d="M2.5 9.5v-7h7" />
      <path d="M5.5 5.5h8v8h-8z" />
      {node(9.5, 9.5)}
    </>
  ),
  portfolio: (
    <>
      <path d="M2 2h5v5H2zM2 9h5v5H2zM9 9h5v5H9z" />
      <rect x="9.25" y="1.75" width="4.5" height="4.5" fill="currentColor" stroke="none" />
    </>
  ),
  activity: (
    <>
      <path d="M1.5 8h3l2-4.5 3 9L11 8h1" />
      {node(13.6, 8)}
    </>
  ),
  alerts: (
    <>
      <path d="M3.5 11V7a4.5 4.5 0 0 1 9 0v4L14 12.5H2zM6.5 14.5h3" />
      {node(8, 8.5)}
    </>
  ),
  docs: (
    <>
      <path d="M3 1.5h6.5L13 5v9.5H3zM9.5 1.5V5H13M5.5 8.5h5M5.5 11.5h2" />
      {node(10.5, 11.5)}
    </>
  ),
  how: (
    <>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M6.5 5.25v5.5L11 8z" />
      {node(12.4, 3.6)}
    </>
  ),
  features: (
    <>
      <path d="M8 1.5l5.5 3.25v6.5L8 14.5l-5.5-3.25v-6.5zM2.5 4.75L8 8l5.5-3.25M8 8v6.5" />
      {node(8, 8)}
    </>
  ),
};

/// Decorative: the link's text carries the name.
export function NavIcon({ name, className }: { name: NavIconName; className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="square" strokeLinejoin="miter" className={className ?? "size-4 shrink-0"}>
      {ICONS[name]}
    </svg>
  );
}
