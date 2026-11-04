import { alertMessage } from "@zeno/sdk";
import { env } from "./env";

/// Web Push for price alerts. Nothing here runs on page load: the service worker is registered, and permission is
/// asked, only when a person presses "Enable browser notifications".

export type PushSupport = "ok" | "denied" | "unsupported" | "ios-install" | "no-key";

const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isInstalled = () => window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

/// What this browser can do. iOS runs Web Push only for a web app added to the Home Screen.
export function pushSupport(): PushSupport {
  if (!env.vapidPublicKey) return "no-key";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return isIos() && !isInstalled() ? "ios-install" : "unsupported";
  if (Notification.permission === "denied") return "denied";
  return "ok";
}

/// True when this browser already holds a push subscription from our worker. Reading does not register anything.
export async function hasPushSubscription(): Promise<boolean> {
  try {
    const registration = await navigator.serviceWorker.getRegistration("/sw.js");
    return Boolean(await registration?.pushManager.getSubscription());
  } catch {
    return false;
  }
}

const toBytes = (key: string) => Uint8Array.from(atob(key.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(key.length / 4) * 4, "=")), (c) => c.charCodeAt(0));

export interface BrowserSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/// Registers the worker, asks for permission and subscribes. Throws a plain-words Error when the person says no.
export async function subscribeThisBrowser(): Promise<BrowserSubscription> {
  if (!env.vapidPublicKey) throw new Error("Browser notifications are not set up on this site yet.");
  const registration = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  if ((await Notification.requestPermission()) !== "granted") throw new Error("Notifications are blocked for this site. Allow them in your browser's site settings, then try again.");
  const existing = await registration.pushManager.getSubscription();
  let subscription = existing;
  try {
    subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toBytes(env.vapidPublicKey) });
  } catch {
    // The browser's own wording is a code ("Registration failed - push service error"), so say what it means.
    throw new Error("This browser could not reach its push service. Private windows, Brave's default settings and some network filters block it. Alerts still appear in the bell.");
  }
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) throw new Error("This browser did not give a usable push address.");
  return { endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth };
}

export const subscribeMessage = (wallet: string, subscription: BrowserSubscription, issuedAt: number) => alertMessage(wallet, { action: "subscribe", ...subscription }, issuedAt);
