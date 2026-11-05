"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useAccount } from "wagmi";
import { useDismiss } from "@/hooks/useDismiss";
import { APP_GUTTER, CHIP_LABEL, LANDING_FRAME } from "@/lib/frame";
import { MORE_LINKS, NAV, NEWS_LINK, isCurrent, type NavLink } from "@/lib/nav";
import { X_URL } from "@/lib/social";
import { chip, cn, interactive, menuItem } from "@zeno/ui";
import { ArrowIcon } from "./ArrowIcon";
import { HeaderCa } from "./HeaderCa";
import { Logo } from "./Logo";
import { MenuIcon } from "./MenuIcon";
import { NavIcon } from "./NavIcon";
import { NetworkMenu } from "./NetworkMenu";
import { NotificationBell } from "./NotificationBell";
import { ThemeToggle } from "./ThemeToggle";
import { WalletButton } from "./WalletButton";
import { XIcon } from "./XIcon";

/// Primary nav is plain text on the header's own blur, not another row of boxes. The type is the landing
/// bar's (14 px, regular, muted, full brightness on hover) so the two bars read as one; an accent hairline
/// marks the current page. The hairline is the only thing that moves between states, so nothing shifts
/// size or position when a page changes.
const navLink = (current: boolean) =>
  cn(
    interactive,
    "flex h-full items-center border-b-2 px-1 font-mono text-[12px] uppercase tracking-[0.12em]",
    current ? "border-accent-fg text-accent-fg" : "border-transparent text-muted hover:text-text",
  );

const menuLink = (current: boolean) =>
  cn("flex h-11 items-center gap-2.5 px-3 text-sm font-medium", current ? "bg-accent text-accent-ink" : cn("text-text", menuItem));

/// On a phone the menu is a full-width sheet. From `md` it is a card under the menu button: two columns,
/// inset rows with the control radius, the same raised surface as the other menus.
const sheetLink = (current: boolean) =>
  cn(
    "flex h-12 items-center gap-3 px-4 text-base font-medium md:mx-2 md:h-10 md:rounded-control md:px-3 md:text-sm",
    current ? "bg-accent text-accent-ink" : cn("bg-raised text-muted", menuItem),
  );

const sheetHeading = "bg-ground px-4 pb-1 pt-4 text-[11px] font-medium uppercase tracking-[0.1em] text-muted md:bg-transparent md:px-5 md:pt-3";

/// A disclosure: a button that shows or hides a list of links. The links are plain links in the tab order,
/// so Tab, Enter, Space and touch all work without roving focus. Escape closes it and returns focus to the button.
function NavGroup({ label, items, pathname, open, onToggle, onClose }: { label: string; items: NavLink[]; pathname: string; open: boolean; onToggle: () => void; onClose: () => void }) {
  const id = useId();
  return (
    <div
      className="relative flex h-full items-center"
      // Focus leaving the group, to another group or off the bar, closes it.
      onBlur={(event) => {
        if (open && !event.currentTarget.contains(event.relatedTarget)) onClose();
      }}
    >
      <button type="button" aria-expanded={open} aria-controls={id} onClick={onToggle} className={cn(navLink(items.some((item) => isCurrent(pathname, item.href))), "gap-1.5")}>
        {label}
        <svg aria-hidden="true" viewBox="0 0 10 6" className={cn("h-1.5 w-2.5 fill-none stroke-current transition-transform duration-150", open && "rotate-180")} strokeWidth="1.5">
          <path d="M1 1l4 4 4-4" />
        </svg>
      </button>
      {open ? (
        <ul id={id} className="absolute left-0 top-full z-50 min-w-48 overflow-hidden rounded-panel border border-line bg-raised py-1">
          {items.map((item) => {
            const current = isCurrent(pathname, item.href);
            return (
              <li key={item.href}>
                <Link href={item.href} aria-current={current ? "page" : undefined} className={menuLink(current)}>
                  <NavIcon name={item.icon} />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

/// The header keeps one accent-filled action, not two: Connect wallet is it (the actual next step
/// for a new visitor), so Trade takes the same secondary chip look as the X icon next to it, rather
/// than competing for the same colour.
const tradeLink = cn(chip, CHIP_LABEL, "h-10 shrink-0 gap-2 rounded-full! px-4");

export function Header() {
  const pathname = usePathname();
  const { isConnected } = useAccount();
  const [open, setOpen] = useState(false);
  const [group, setGroup] = useState<string | null>(null);
  // On the landing page the header floats over the hero only, so the hero reads as the whole first
  // screen; on every other page — and once the landing page scrolls past its hero — it sits in the
  // normal flow above content. The nav text carries no fill of its own, so the bar needs one soft,
  // even scrim behind everything to stay readable over whatever sits under it.
  const landing = pathname === "/";
  // `/news` is a dedicated public page reached from the landing header, so it wears the landing header's
  // links and frame (in the normal flow, not floating) instead of the app navigation.
  const news = isCurrent(pathname, NEWS_LINK.href);
  const publicBar = landing || news;
  const ref = useRef<HTMLElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const closeGroup = useCallback(() => setGroup(null), []);
  useDismiss(ref, open, close);
  useDismiss(navRef, group !== null, closeGroup);
  // A tap on a link changes the page; the sheet and the menus have done their job.
  useEffect(() => {
    setOpen(false);
    setGroup(null);
  }, [pathname]);

  return (
    <header
      ref={ref}
      className={cn(
        "relative z-40 shrink-0 border-b border-line bg-ground/85 backdrop-blur-md",
      )}
    >
      <div className={cn("flex items-center justify-between gap-3", publicBar ? `h-[72px] ${LANDING_FRAME}` : `h-16 ${APP_GUTTER}`)}>
        <div className="flex h-full min-w-0 items-center gap-6 2xl:gap-8">
          <Link href="/" aria-label="ZENO home" className="flex h-full shrink-0 items-center">
            <Logo />
          </Link>
          <HeaderCa />
          <span aria-hidden className="hidden h-6 w-px bg-line xl:block" />
          {publicBar ? (
            <nav aria-label="Landing" className="hidden h-full items-center gap-6 font-mono text-[11px] uppercase tracking-[0.12em] xl:flex 2xl:gap-8">
              {[
                { href: "#markets", label: "Markets" },
                { href: "#products", label: "Products" },
                { href: "#contracts", label: "Contracts" },
                { href: "#roadmap", label: "Roadmap" },
              ].map((item) => (
                <Link key={item.href} href={landing ? item.href : `/${item.href}`} className="group/nav inline-flex items-center gap-1.5 py-1 text-text/80 transition-colors duration-150 hover:text-text">
                  <span aria-hidden className="size-2 rounded-[2px] border border-current transition-colors duration-200 group-hover/nav:border-accent-fg group-hover/nav:bg-accent" />
                  {item.label}
                </Link>
              ))}
              <Link href={NEWS_LINK.href} aria-current={news ? "page" : undefined} className={cn("group/nav inline-flex items-center gap-1.5 py-1 transition-colors duration-150 hover:text-text", news ? "text-text" : "text-text/80")}>
                <span aria-hidden className={cn("size-2 rounded-[2px] border border-current transition-colors duration-200 group-hover/nav:border-accent-fg group-hover/nav:bg-accent", news && "border-accent-fg bg-accent")} />
                {NEWS_LINK.label}
              </Link>
            </nav>
          ) : (
            <nav
              ref={navRef}
              aria-label="Primary"
              className="hidden h-full items-center gap-5 xl:flex 2xl:gap-8"
              onKeyDown={(event) => {
                if (event.key !== "Escape" || group === null) return;
                event.currentTarget.querySelector<HTMLButtonElement>('button[aria-expanded="true"]')?.focus();
                setGroup(null);
              }}
            >
              {NAV.map((entry) =>
                "items" in entry ? (
                  <NavGroup key={entry.label} label={entry.label} items={entry.items} pathname={pathname} open={group === entry.label} onToggle={() => setGroup((value) => (value === entry.label ? null : entry.label))} onClose={closeGroup} />
                ) : (
                  <Link key={entry.href} href={entry.href} aria-current={isCurrent(pathname, entry.href) ? "page" : undefined} className={navLink(isCurrent(pathname, entry.href))}>
                    {entry.label}
                  </Link>
                ),
              )}
            </nav>
          )}
        </div>
        <div className="flex items-center gap-3 sm:gap-4">
          <NetworkMenu />
          <NotificationBell />
          {/* Below xl the bar has no room beside the logo; the toggle moves into the menu sheet. */}
          <ThemeToggle className="max-xl:hidden" />
          <a
            href={X_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="ZENO on X"
            className={cn(chip, "size-10 shrink-0 justify-center rounded-full! max-sm:hidden")}
          >
            <XIcon />
          </a>
          {/* On a phone the wallet button lives at the bottom of the menu, which leaves the bar to the logo, X and the menu button — Trade goes with it, since "Markets"/"Perpetuals" in the sheet already cover that entry point on mobile. */}
          <div className="hidden items-center gap-3 xl:flex 2xl:gap-6">
            {publicBar ? (
              <Link href="/markets" className="group/app inline-flex h-10 items-center gap-2 rounded-full bg-ink px-5 text-sm font-medium text-paper transition-[background-color,color,transform] duration-200 hover:bg-accent hover:text-accent-ink active:scale-[0.98]">
                Launch app
                <ArrowIcon />
              </Link>
            ) : (
              <Link href="/perpetuals" className={cn(tradeLink, "max-2xl:hidden")}>
                Terminal
                <ArrowIcon />
              </Link>
            )}
            {publicBar ? null : <WalletButton variant="primary" />}
          </div>
          <button
            type="button"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="mobile-nav"
            onClick={() => setOpen((value) => !value)}
            className={cn(chip, "relative size-10 justify-center rounded-full! xl:hidden")}
          >
            <MenuIcon open={open} />
            {/* A connected wallet is out of sight in the menu, so the button says so. */}
            {isConnected && !open ? <span aria-hidden="true" className="absolute right-1.5 top-1.5 size-2 rounded-full bg-up" /> : null}
          </button>
        </div>
      </div>
      {open ? (
        <nav
          id="mobile-nav"
          aria-label="Primary mobile"
          className={cn(
            "absolute inset-x-0 top-full max-h-[calc(100dvh-7.125rem)] overflow-y-auto bg-ground xl:hidden",
            "md:inset-x-auto md:top-[calc(100%+0.5rem)] md:max-h-[calc(100dvh-8.5rem)] md:w-[26rem] md:rounded-panel md:border md:border-line md:bg-raised md:pb-2 md:shadow-lift",
            publicBar ? "md:right-[clamp(40px,4.2vw,112px)]" : "md:right-6 lg:right-10",
          )}
        >
          <div className="md:grid md:grid-cols-2 md:gap-x-1">
            <div className="md:pt-2">
              {NAV.map((entry) =>
                "items" in entry ? (
                  <div key={entry.label} role="group" aria-label={entry.label} className="pb-3 md:pb-1">
                    <p aria-hidden="true" className={sheetHeading}>{entry.label}</p>
                    {entry.items.map((item) => (
                      <Link key={item.href} href={item.href} aria-current={isCurrent(pathname, item.href) ? "page" : undefined} className={sheetLink(isCurrent(pathname, item.href))}>
                        <NavIcon name={item.icon} />
                        {item.label}
                      </Link>
                    ))}
                  </div>
                ) : (
                  <Link key={entry.href} href={entry.href} aria-current={isCurrent(pathname, entry.href) ? "page" : undefined} className={cn(sheetLink(isCurrent(pathname, entry.href)), "md:my-1")}>
                    <NavIcon name={entry.icon} />
                    {entry.label}
                  </Link>
                ),
              )}
            </div>
            <div className="md:border-l md:border-line md:pt-2">
              <div role="group" aria-label="More" className="pb-3 md:pb-1">
                <p aria-hidden="true" className={sheetHeading}>More</p>
                {MORE_LINKS.map((item) => (
                  <Link key={item.href} href={item.href} aria-current={isCurrent(pathname, item.href) ? "page" : undefined} className={sheetLink(isCurrent(pathname, item.href))}>
                    <NavIcon name={item.icon} />
                    {item.label}
                  </Link>
                ))}
              </div>
            </div>
          </div>
          <div className="flex gap-3 p-4 md:border-t md:border-line md:px-3 md:pb-1 md:pt-3">
            <div className="min-w-0 flex-1">
              <WalletButton className="h-12! rounded-full! text-[13px]! md:h-10!" block menuAbove />
            </div>
            <ThemeToggle className="size-12! md:size-10!" />
          </div>
        </nav>
      ) : null}
    </header>
  );
}
