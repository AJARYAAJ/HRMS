import { useCallback, useEffect, useRef, useState } from 'react';
import { useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { BellRing, BellOff, Send, Smartphone, Monitor, Trash2 } from 'lucide-react';
import { useGet, useAction, useToast } from '../lib/hooks';
import { pushToast } from '../store/uiSlice';
import { timeAgo } from '../lib/format';
import {
  pushSupported, notificationPermission, needsHomeScreen, currentSubscription, subscribePush, unsubscribePush, showLocalNotification, setAppBadge,
} from '../lib/push';

/** Push state for this browser: is it subscribed, and actions to enable, disable and test. */
export function usePush() {
  const { data, refetch } = useGet('notifications/push');
  const [act] = useAction();
  const toast = useToast();
  const [endpoint, setEndpoint] = useState(null);
  const [busy, setBusy] = useState(false);
  const [permission, setPermission] = useState(notificationPermission());
  const supported = pushSupported();
  useEffect(() => {
    let live = true;
    currentSubscription().then((s) => live && setEndpoint(s?.endpoint || null)).catch(() => {});
    return () => { live = false; };
  }, [data]);
  const devices = data?.devices || [];
  const enabled = !!endpoint && devices.some((d) => d.endpoint === endpoint);

  const enable = useCallback(async () => {
    if (!data?.public_key) return false;
    setBusy(true);
    try {
      const subscription = await subscribePush(data.public_key);
      setPermission(notificationPermission());
      const ok = await act('notifications/push/subscribe', { body: { subscription }, success: 'Notifications on for this device' });
      if (ok) { setEndpoint(subscription.endpoint); refetch(); }
      return !!ok;
    } catch (err) {
      setPermission(notificationPermission());
      toast(err.message, 'error');
      return false;
    } finally {
      setBusy(false);
    }
  }, [data, act, refetch, toast]);

  const disable = useCallback(async () => {
    setBusy(true);
    try {
      const ep = await unsubscribePush();
      if (ep) await act('notifications/push/unsubscribe', { body: { endpoint: ep }, success: 'Notifications off for this device' });
      setEndpoint(null);
      refetch();
    } finally {
      setBusy(false);
    }
  }, [act, refetch]);

  const removeDevice = useCallback(async (d) => {
    if (d.endpoint === endpoint) return disable();
    await act('notifications/push/unsubscribe', { body: { id: d.id }, success: 'Device removed' });
    refetch();
  }, [act, refetch, endpoint, disable]);

  const test = useCallback(() => act('notifications/push/test', { body: {}, success: 'Test notification sent' }), [act]);

  return { supported, permission, enabled, devices, busy, enable, disable, removeDevice, test, ready: !!data, homeScreen: needsHomeScreen() };
}

const BASE_TITLE = typeof document !== 'undefined' ? document.title.replace(/^\(\d+\+?\)\s*/, '') : 'PeopleHub';

/**
 * Keeps the user informed about new bell notifications: an in-app toast while they are on the site, the unread count in
 * the tab title and app icon badge, and a system notification when the tab is in the background and push is not set up
 * on this device (with push on, the service worker already shows it). Also handles clicks routed back by the worker.
 */
export function useNotificationAlerts(data, refetch) {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const lastSeen = useRef(null);
  const pushOn = useRef(false);

  useEffect(() => {
    currentSubscription().then((s) => { pushOn.current = !!s; }).catch(() => {});
  }, [data]);

  useEffect(() => {
    if (!data) return;
    const unread = data.unread || 0;
    document.title = unread ? `(${unread > 99 ? '99+' : unread}) ${BASE_TITLE}` : BASE_TITLE;
    setAppBadge(unread);
    const newest = data.items?.[0]?.id || 0;
    if (lastSeen.current === null) { lastSeen.current = newest; return; } // first load: nothing is "new"
    const fresh = (data.items || []).filter((n) => n.id > lastSeen.current && !n.read).slice(0, 3);
    lastSeen.current = Math.max(lastSeen.current, newest);
    for (const n of fresh.reverse()) {
      dispatch(pushToast({ message: n.title, detail: n.body, link: n.link, type: 'info' }));
      if (document.hidden && !pushOn.current) showLocalNotification(n);
    }
  }, [data, dispatch]);

  useEffect(() => () => { document.title = BASE_TITLE; }, []);

  // Refresh at once when the user comes back to the tab, and when the service worker receives a push.
  useEffect(() => {
    const onVisible = () => { if (!document.hidden) refetch(); };
    document.addEventListener('visibilitychange', onVisible);
    const sw = 'serviceWorker' in navigator ? navigator.serviceWorker : null;
    const onMessage = (e) => {
      if (e.data?.type === 'notification') refetch();
      if (e.data?.type === 'open' && e.data.link) navigate(e.data.link);
    };
    sw?.addEventListener('message', onMessage);
    return () => { document.removeEventListener('visibilitychange', onVisible); sw?.removeEventListener('message', onMessage); };
  }, [refetch, navigate]);

  // Opened from a system notification (?notification=<id>): mark it read.
  const [act] = useAction();
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('notification');
    if (!id || !/^\d+$/.test(id)) return;
    act(`notifications/${id}/read`);
    params.delete('notification');
    const qs = params.toString();
    window.history.replaceState(window.history.state, '', window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash);
  });
}

/** The "turn on desktop notifications" prompt shown inside the bell menu. */
export function PushPrompt() {
  const push = usePush();
  const [dismissed, setDismissed] = useState(() => { try { return localStorage.getItem('push-prompt-dismissed') === '1'; } catch { return false; } });
  if (push.homeScreen) {
    return <div className="border-b border-slate-100 bg-brand-50/50 px-4 py-2.5 text-xs dark:border-slate-800 dark:bg-brand-500/5">To get notifications on this iPhone or iPad, tap Share → <b>Add to Home Screen</b>, open PeopleHub from there and turn them on.</div>;
  }
  if (!push.supported || !push.ready || push.enabled || dismissed) return null;
  const dismiss = () => { setDismissed(true); try { localStorage.setItem('push-prompt-dismissed', '1'); } catch { /* ignore */ } };
  return (
    <div className="flex items-start gap-3 border-b border-slate-100 bg-brand-50/50 px-4 py-3 dark:border-slate-800 dark:bg-brand-500/5" data-testid="push-prompt">
      <BellRing size={18} className="mt-0.5 shrink-0 text-brand-600 dark:text-brand-400" />
      <div className="min-w-0 flex-1 text-xs">
        <div className="font-semibold text-slate-800 dark:text-slate-100">Get notified outside PeopleHub</div>
        <div className="muted">{push.permission === 'denied' ? 'Notifications are blocked for this site. Allow them from the lock icon in the address bar.' : 'Approvals, payslips and reminders pop up on your computer or phone, even when this tab is closed.'}</div>
        <div className="mt-2 flex gap-2">
          {push.permission !== 'denied' && <button className="btn-primary btn-sm" disabled={push.busy} onClick={push.enable} data-testid="push-enable">Turn on</button>}
          <button className="btn-ghost btn-sm" onClick={dismiss}>Not now</button>
        </div>
      </div>
    </div>
  );
}

/** Profile card: notifications on this device, a test button, and every browser or phone receiving them. */
export function PushSettings() {
  const push = usePush();
  return (
    <div className="card card-pad space-y-4" data-testid="push-settings">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="font-semibold">Browser & phone notifications</h3>
          <p className="text-sm muted">Show PeopleHub notifications on this device's notification centre, even when the site is closed.</p>
        </div>
        {push.supported && (push.enabled
          ? <button className="btn-secondary" disabled={push.busy} onClick={push.disable} data-testid="push-disable"><BellOff size={16} /> Turn off here</button>
          : <button className="btn-primary" disabled={push.busy || !push.ready || push.permission === 'denied'} onClick={push.enable} data-testid="push-enable-profile"><BellRing size={16} /> Turn on here</button>)}
      </div>
      {!push.supported && <p className="text-sm muted">{push.homeScreen ? 'On iPhone and iPad, add PeopleHub to your Home Screen (Share → Add to Home Screen), open it from there and turn notifications on.' : 'This browser does not support notifications. Use a recent Chrome, Edge, Firefox or Safari.'}</p>}
      {push.supported && push.permission === 'denied' && <p className="text-sm text-amber-600 dark:text-amber-400">Notifications are blocked for this site. Allow them from the lock icon in the address bar, then turn them on here.</p>}
      {push.devices.length > 0 && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Receiving notifications</span>
            <button className="btn-ghost btn-sm" onClick={push.test} data-testid="push-test"><Send size={14} /> Send a test</button>
          </div>
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-100 dark:divide-slate-800 dark:border-slate-800" data-testid="push-devices">
            {push.devices.map((d) => {
              const Icon = /Android|iOS/.test(d.device || '') ? Smartphone : Monitor;
              return (
                <li key={d.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <Icon size={16} className="text-slate-400" />
                  <span className="min-w-0 flex-1"><span className="font-medium">{d.device || 'Browser'}</span><span className="block text-xs muted">Added {timeAgo(d.created_at)}{d.last_used_at ? ` · last notified ${timeAgo(d.last_used_at)}` : ''}</span></span>
                  <button className="btn-ghost btn-sm text-rose-600" aria-label={`Remove ${d.device || 'device'}`} onClick={() => push.removeDevice(d)}><Trash2 size={14} /></button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
