/* Shelfsort push notification service worker.
 *
 * Receives encrypted push messages from the backend's `webpush()`
 * helper (VAPID-signed), unpacks the JSON `{title, body, url}`
 * payload, and shows a notification.  Tapping the notification
 * focuses an existing tab at the given URL or opens a new one.
 */
self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "Shelfsort", body: event.data?.text?.() || "" };
  }
  const title = payload.title || "Shelfsort";
  const body = payload.body || "";
  const url = payload.url || "/library";
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      data: { url },
      badge: "/og-image.png",
      icon: "/og-image.png",
      tag: "shelfsort-handoff",
      renotify: true,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification?.data?.url || "/library";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        // Reuse an open Shelfsort tab if there is one.
        if ("focus" in w) {
          w.focus();
          if ("navigate" in w) w.navigate(target);
          return undefined;
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
