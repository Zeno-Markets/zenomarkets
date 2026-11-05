import { ROBINHOOD_TESTNET_CHAIN_ID, type ChainId } from "./chains.js";

/// The mainnet releases on the landing roadmap. V1.0 opens mainnet (with the ZENO token) and every feature not
/// listed here; each listed feature opens with the release named beside it. Testnet runs every release.
/// docs/RELEASES.md walks through what each release changes on chain, on the server and on the site.
export const LATEST_RELEASE = 3;

export const FEATURE_RELEASE = {
  lending: 2,
  strategies: 2,
  rfq: 2,
  copyTrading: 3,
} as const;

export type ReleasedFeature = keyof typeof FEATURE_RELEASE;

/// The release `chainId` runs. Testnet runs all of them. Mainnet runs `value` (`RELEASE` on the services,
/// `NEXT_PUBLIC_RELEASE` on the site), and 1 when it is unset or not a release number, so a missing or mistyped
/// setting can never open a feature early.
export function releaseFor(chainId: ChainId, value: string | undefined): number {
  if (chainId === ROBINHOOD_TESTNET_CHAIN_ID) return LATEST_RELEASE;
  const release = Number(value?.trim());
  return value?.trim() && Number.isInteger(release) && release >= 1 && release <= LATEST_RELEASE ? release : 1;
}

export const isReleased = (feature: ReleasedFeature, release: number): boolean => release >= FEATURE_RELEASE[feature];
