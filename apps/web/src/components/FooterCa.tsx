'use client';

import { env } from '@/lib/env';
import { ContractAddressBadge } from './ContractAddressBadge';

/// The ZENO token's contract address in the footer of every page, once it exists. Nothing before then: the hero
/// already says "Coming Soon", and a footer on every page should not.
export function FooterCa() {
    return env.protocolToken ? <ContractAddressBadge /> : null;
}
