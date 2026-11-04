import type { NavIconName } from "@/components/NavIcon";

export type NavLink = { label: string; href: string; icon: NavIconName };
export type NavEntry = NavLink | { label: string; items: NavLink[] };

/// The news page is a dedicated public page: it keeps the landing header's frame on `/news`, and is also a slot
/// in the app bar (NAV below) so it is reachable from every page.
export const NEWS_LINK: NavLink = { label: "News", href: "/news", icon: "news" };

/// The primary navigation. A group is a disclosure menu in the header and a titled section in the mobile
/// sheet. The route paths are unchanged: only the grouping is new. Copy trading joins Social when its
/// route exists.
const copyOn = process.env.NEXT_PUBLIC_FEATURE_COPY_TRADING === "true";

export const NAV: NavEntry[] = [
  { label: "Markets", href: "/markets", icon: "markets" },
  {
    label: "Trade",
    items: [
      { label: "Perpetuals", href: "/perpetuals", icon: "perpetuals" },
      { label: "Options", href: "/options", icon: "options" },
      { label: "Strategies", href: "/strategies", icon: "strategies" },
    ],
  },
  { label: "Capital", items: [{ label: "Lending", href: "/lending", icon: "lending" }] },
  { label: "Social", items: [{ label: "Leaderboard", href: "/leaderboard", icon: "leaderboard" }, ...(copyOn ? [{ label: "Copy trading", href: "/copy", icon: "copy" as const }] : [])] },
  { label: "Portfolio", href: "/portfolio", icon: "portfolio" },
  NEWS_LINK,
];

/// Pages with no slot in the bar. The footer lists them, and so does the mobile sheet, because the
/// terminals have no footer.
export const MORE_LINKS: NavLink[] = [
  { label: "How it works", href: "/how-it-works", icon: "how" },
  { label: "Activity", href: "/activity", icon: "activity" },
  { label: "Alerts", href: "/alerts", icon: "alerts" },
  { label: "Docs", href: "/docs", icon: "docs" },
];

export const isCurrent = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);
