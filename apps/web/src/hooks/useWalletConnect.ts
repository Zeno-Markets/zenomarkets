"use client";

import { useConnect } from "wagmi";

/// Wallets the page can offer. Browsers that announce their wallets (EIP-6963) give one connector
/// per wallet, so the generic "Injected" connector is left out when any of those exist.
export function useWalletChoices() {
  const { connectors } = useConnect();
  const named = connectors.filter((connector) => connector.id !== "injected");
  return named.length > 0 ? named : connectors;
}

/// What to tell a person whose connect attempt failed. A missing wallet is the common case on a clean
/// browser, so it gets its own sentence and a way forward.
export function connectMessage(error: Error): string {
  if (error.name === "ProviderNotFoundError") {
    return "No browser wallet found. Install MetaMask or another EVM wallet, then reload this page.";
  }
  if (/reject|denied|declin|cancel/i.test(error.message)) return "You declined the request in your wallet. Nothing was connected.";
  return "Could not connect to your wallet. Try again.";
}

/// `useConnect`, with a `connectWith` that takes the success and failure callbacks.
export function useWalletConnect() {
  const connection = useConnect();
  const connectWith = (connector: Parameters<typeof connection.connect>[0]["connector"], onDone?: () => void, onFail?: () => void) =>
    connection.connect(
      { connector },
      {
        onSuccess: () => {
          onDone?.();
        },
        onError: onFail,
      },
    );
  return { ...connection, connectWith };
}
