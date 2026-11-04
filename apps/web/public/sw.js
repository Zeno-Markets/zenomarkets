// ZENO price alerts. Registered only after a person turns on browser notifications (see src/lib/push.ts).
// The indexer sends a Web Push when an alert fires, even with no ZENO tab open; this worker shows it.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      // A tab the person is looking at shows the alert itself (its bell polls every 30 seconds), so no second one.
      if (clients.some((client) => client.visibilityState === "visible")) return undefined;
      return self.registration.showNotification(data.title || "ZENO price alert", {
        body: data.body || "",
        tag: data.tag,
        icon: "/icon.png",
        data: { url: data.url || "/alerts" },
      });
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/alerts", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const open = clients[0];
      if (!open) return self.clients.openWindow(url);
      return open.focus().then((focused) => (focused && "navigate" in focused ? focused.navigate(url) : undefined));
    }),
  );
});
