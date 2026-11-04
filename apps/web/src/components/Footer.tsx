import Link from 'next/link';
import { APP_GUTTER } from '@/lib/frame';
import { MORE_LINKS } from '@/lib/nav';
import { X_URL } from '@/lib/social';
import { cn, interactive } from '@zeno/ui';
import { ArrowIcon } from './ArrowIcon';
import { FooterCa } from './FooterCa';
import { Logo } from './Logo';
import { ChainName } from './NetworkText';
import { StatusBadge } from './StatusBadge';
import { XIcon } from './XIcon';

/// One thin line, not a menu: the brand and the tagline on the left; the pages with no slot in the header
/// (Activity, Docs, Features), the network status and the X link on the right. Wraps and centres on a phone.
/// The type is the header nav's: 14 px, regular, muted, full brightness on hover.
const footLink = cn(interactive, 'inline-flex items-center gap-2 text-muted hover:text-text');

export function Footer() {
    return (
        <footer className="border-t border-line bg-surface text-sm">
            <div
                className={`w-full ${APP_GUTTER} flex flex-wrap items-center justify-center gap-x-6 gap-y-3 py-6 sm:justify-between`}
            >
                <div className="flex flex-wrap items-center gap-3">
                    <Logo size="sm" />
                    <p className="text-muted">
                        One view. A world of markets.
                    </p>
                </div>
                <FooterCa />
                <nav
                    aria-label="Footer"
                    className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2"
                >
                    {MORE_LINKS.map((link) => (
                        <Link key={link.href} href={link.href} className={footLink}>
                            {link.label}
                            <ArrowIcon />
                        </Link>
                    ))}
                    <StatusBadge label={<ChainName />} />
                    <a
                        href={X_URL}
                        target="_blank"
                        rel="noreferrer"
                        className={footLink}
                    >
                        <XIcon />
                    </a>
                </nav>
            </div>
        </footer>
    );
}
