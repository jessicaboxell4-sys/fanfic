/**
 * Web Push helpers — opt-in cross-device handoff notifications.
 *
 * - `getPushStatus()` returns the current state for the UI toggle.
 * - `enablePush()` walks the full opt-in flow:
 *     1. Register the service worker.
 *     2. Ask the browser for notification permission.
 *     3. Subscribe via PushManager with our VAPID public key
 *        (fetched live from the backend so a key rotation doesn't
 *        require a frontend rebuild).
 *     4. POST the subscription to `/api/push/subscribe`.
 * - `disablePush()` unsubscribes and informs the backend.
 *
 * All functions are best-effort and swallow errors — Safari + some
 * Firefox builds don't fully support the API, and we don't want to
 * crash the page from a settings toggle.
 */
import { api } from "./api";

const SW_PATH = "/sw.js";

function urlBase64ToUint8Array(b64) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

function deviceMeta() {
  let id = localStorage.getItem("shelfsort-device-id");
  if (!id) {
    id = "dev_" + Math.random().toString(36).slice(2, 14);
    localStorage.setItem("shelfsort-device-id", id);
  }
  const ua = (navigator.userAgent || "").toLowerCase();
  const label = ua.includes("iphone") ? "iPhone"
    : ua.includes("ipad") ? "iPad"
    : ua.includes("android") ? "Android"
    : ua.includes("mac") ? "Mac"
    : ua.includes("win") ? "Windows"
    : "this device";
  return { device_id: id, device_label: label };
}

export async function getPushStatus() {
  if (typeof window === "undefined") return { supported: false };
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    return { supported: false };
  }
  const reg = await navigator.serviceWorker.getRegistration(SW_PATH);
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  return {
    supported: true,
    permission: Notification.permission,
    subscribed: !!sub,
  };
}

export async function enablePush() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    throw new Error("Your browser doesn't support Web Push");
  }
  const reg = await navigator.serviceWorker.register(SW_PATH);
  await navigator.serviceWorker.ready;

  if (Notification.permission !== "granted") {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") throw new Error("Notification permission denied");
  }

  const { data } = await api.get("/push/vapid-public-key");
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(data.public_key),
  });
  const json = sub.toJSON();
  await api.post("/push/subscribe", {
    endpoint: json.endpoint,
    keys: json.keys,
    ...deviceMeta(),
  });
  return { ok: true };
}

export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration(SW_PATH);
  if (!reg) return { ok: true };
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    try { await api.post("/push/unsubscribe", { endpoint: sub.endpoint }); } catch { /* ignore */ }
    await sub.unsubscribe();
  }
  return { ok: true };
}

/**
 * Reader-side: fire a single handoff push when the user closes /
 * backgrounds the tab after having made real progress.  Idempotent
 * per (book_id, session) — only fires once per tab close.
 */
let _handoffSent = false;
export function armReadingHandoff(bookId, getPercent) {
  if (!bookId) return () => {};
  const fire = () => {
    if (_handoffSent) return;
    if (document.visibilityState !== "hidden") return;
    const pct = (typeof getPercent === "function") ? (getPercent() || 0) : 0;
    if (pct < 0.05) return;   // don't notify if you barely opened it
    _handoffSent = true;
    const { device_id, device_label } = deviceMeta();
    try {
      const blob = new Blob([JSON.stringify({
        book_id: bookId, closing_device_id: device_id,
        closing_device_label: device_label, percent: pct,
      })], { type: "application/json" });
      // sendBeacon survives tab close better than fetch().
      navigator.sendBeacon?.(
        `${process.env.REACT_APP_BACKEND_URL}/api/push/handoff`,
        blob,
      );
    } catch { /* tab is dying — best effort */ }
  };
  document.addEventListener("visibilitychange", fire);
  window.addEventListener("pagehide", fire);
  return () => {
    document.removeEventListener("visibilitychange", fire);
    window.removeEventListener("pagehide", fire);
    _handoffSent = false;
  };
}
