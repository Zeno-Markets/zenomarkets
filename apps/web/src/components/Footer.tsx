import Link from 'next/link';
import { LANDING_FRAME } from '@/lib/frame';
import { MORE_LINKS, NAV, type NavLink } from '@/lib/nav';
import { X_URL } from '@/lib/social';
import { cn, interactive } from '@zeno/ui';
import { ArrowIcon } from './ArrowIcon';
import { FooterCa } from './FooterCa';
import { Logo } from './Logo';
import { ChainName } from './NetworkText';
import { StatusBadge } from './StatusBadge';
import { XIcon } from './XIcon';

/// The site map on an ink panel: the brand and the live network on the left, one column per navigation group on
/// the right, and the wordmark set huge and cropped along the bottom edge. It wears the dark tokens in both themes.
const footLink = cn(interactive, 'font-mono text-[11px] uppercase tracking-[0.12em] text-text/85 hover:text-accent-fg');
const heading = 'font-mono text-[11px] uppercase tracking-[0.12em] text-faint';

const columns: { label: string; items: NavLink[] }[] = [
    { label: 'Explore', items: NAV.filter((entry): entry is NavLink => !('items' in entry)) },
    ...NAV.filter((entry): entry is { label: string; items: NavLink[] } => 'items' in entry),
    { label: 'Resources', items: MORE_LINKS },
];

export function Footer() {
    return (
        <footer className="theme-dark relative overflow-hidden bg-ink text-sm text-text">
            <div aria-hidden className="pointer-events-none absolute -left-40 -top-40 size-[520px] rounded-full bg-accent/10 blur-[120px]" />
            <div className={`${LANDING_FRAME} relative grid gap-12 pb-10 pt-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]`}>
                <div className="flex flex-col items-start gap-5">
                    <Logo size="sm" />
                    <p className="max-w-xs text-muted">One view. A world of markets. Stocks, ETFs, crypto and commodities on Robinhood Chain.</p>
                    <div className="flex flex-wrap items-center gap-3">
                        <StatusBadge label={<ChainName />} />
                        <FooterCa />
                    </div>
                    <Link
                        href="/markets"
                        className="mt-1 inline-flex h-10 items-center gap-2 rounded-full bg-paper px-5 text-sm font-medium text-ink transition-colors duration-200 hover:bg-accent hover:text-accent-ink"
                    >
                        Launch app
                        <ArrowIcon />
                    </Link>
                </div>
                <nav aria-label="Footer" className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3 xl:grid-cols-6">
                    {columns.map((column) => (
                        <div key={column.label}>
                            <p className={heading}>{column.label}</p>
                            <ul className="mt-4 space-y-3">
                                {column.items.map((link) => (
                                    <li key={link.href}>
                                        <Link href={link.href} className={footLink}>
                                            {link.label}
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                    <div>
                        <p className={heading}>Stay in touch</p>
                        <a href={X_URL} target="_blank" rel="noreferrer" aria-label="ZENO on X" className={cn(footLink, 'mt-4 inline-flex size-9 items-center justify-center rounded-full border border-line')}>
                            <XIcon />
                        </a>
                    </div>
                </nav>
            </div>
            <p
                aria-hidden
                className="relative -mb-[3.2vw] select-none whitespace-nowrap text-center font-condensed text-[18.4vw] font-extrabold italic uppercase leading-[0.82] tracking-[-0.01em] text-paper"
            >
                Zenomarkets
            </p>
        </footer>
    );
}
