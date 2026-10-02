/** Browser push notifications: permission, the service worker and the PushManager subscription for this device. */
export const pushSupported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export const notificationPermission = () => (typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported');
/** iPhone/iPad only allow web push once the app is added to the Home Screen. */
export const needsHomeScreen = () => /iPhone|iPad|iPod/.test(navigator.userAgent) && !window.matchMedia?.('(display-mode: standalone)').matches && !('PushManager' in window);

function keyBytes(base64) {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}
const sameKey = (buf, key) => {
  if (!buf) return false;
  const a = new Uint8Array(buf);
  return a.length === key.length && a.every((v, i) => v === key[i]);
};

export async function swRegistration() {
  const existing = await navigator.serviceWorker.getRegistration('/');
  if (!existing) await navigator.serviceWorker.register('/sw.js');
  return navigator.serviceWorker.ready;
}

export async function currentSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration('/');
  return reg ? reg.pushManager.getSubscription() : null;
}

/** Ask for permission (if needed) and subscribe this browser. Resolves to the subscription JSON for the server. */
export async function subscribePush(publicKey) {
  if (!pushSupported()) throw new Error('This browser does not support notifications');
  const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (permission !== 'granted') throw new Error(permission === 'denied' ? 'Notifications are blocked for this site. Allow them from the lock icon in the address bar, then try again.' : 'Notification permission was not granted');
  const reg = await swRegistration();
  const key = keyBytes(publicKey);
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub.options?.applicationServerKey, key)) { await sub.unsubscribe(); sub = null; } // server keys changed
  sub = sub || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }));
  return sub.toJSON();
}

/** Unsubscribe this browser; resolves to the endpoint that was removed (or null). */
export async function unsubscribePush() {
  const sub = await currentSubscription();
  if (!sub) return null;
  const { endpoint } = sub;
  await sub.unsubscribe();
  return endpoint;
}

/** A local system notification while the tab is open but hidden (used when push is not set up on this device). */
export async function showLocalNotification(n) {
  if (notificationPermission() !== 'granted') return;
  try {
    const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration('/') : null;
    const opts = { body: n.body || '', icon: '/icon-192.png', badge: '/badge-72.png', tag: `peoplehub-${n.id}`, data: { link: n.link || '/', id: n.id } };
    if (reg) await reg.showNotification(n.title, opts);
    else new Notification(n.title, opts).onclick = () => { window.focus(); if (n.link) window.location.assign(n.link); };
  } catch { /* notifications unavailable */ }
}

export function setAppBadge(count) {
  try { if (count) navigator.setAppBadge?.(count); else navigator.clearAppBadge?.(); } catch { /* unsupported */ }
}
