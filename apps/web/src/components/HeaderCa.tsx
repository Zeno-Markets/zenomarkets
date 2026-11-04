'use client';

import { cn } from '@zeno/ui';
import { useState } from 'react';
import { env } from '@/lib/env';
import { MONO } from '@/lib/frame';

/// The ZENO token's contract address beside the logo, once it exists: shortened (the full address is in the hero
/// and the footer), and one tap copies the whole of it. Under 768 px there is no room beside the logo, and the
/// hero and the footer carry the full address there. Nothing renders before the token launches.
export function HeaderCa() {
    const [copied, setCopied] = useState(false);
    const address = env.protocolToken?.address;
    if (!address) return null;
    const short = `${address.slice(0, 6)}…${address.slice(-4)}`;
    return (
        <button
            type="button"
            aria-label={copied ? 'Address copied' : `Copy the ZENO contract address ${address}`}
            title={address}
            onClick={() => {
                void navigator.clipboard?.writeText(address).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                });
            }}
            className={cn(
                MONO,
                'inline-flex h-8 shrink-0 max-md:hidden items-center gap-2 rounded-control border border-line bg-surface px-2.5 text-xs text-text transition-colors duration-150 hover:border-accent-line hover:bg-accent-soft max-md:min-h-0',
                copied && 'text-up',
            )}
        >
            <span className="text-muted">CA</span>
            <span>{copied ? 'Copied' : short}</span>
        </button>
    );
}
