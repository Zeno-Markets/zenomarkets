import { ROBINHOOD_MAINNET_CHAIN_ID, ROBINHOOD_TESTNET_CHAIN_ID, chains, hasDeployment, type ChainId } from "@zeno/config";

/// The two environments a person can use, testnet first. The choice is kept in this browser; the server
/// always renders the build's default network, and the page reloads when the choice changes.
export const NETWORK_CHOICES: readonly ChainId[] = [ROBINHOOD_TESTNET_CHAIN_ID, ROBINHOOD_MAINNET_CHAIN_ID].filter(hasDeployment);

const KEY = "zeno-network";

export function networkName(id: ChainId): string {
  return chains[id].name;
}

/// The stored network, or `undefined` on the server, with storage blocked, or before a choice was made.
export function storedChainId(): ChainId | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const value = Number(window.localStorage.getItem(KEY));
    return NETWORK_CHOICES.find((id) => id === value);
  } catch {
    return undefined;
  }
}

export function switchNetwork(id: ChainId): void {
  try {
    window.localStorage.setItem(KEY, String(id));
  } catch {
    // Storage blocked: the switch cannot persist, so there is nothing to reload into.
    return;
  }
  window.location.reload();
}
