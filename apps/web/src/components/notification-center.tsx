"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Bell, CircleCheck, CircleX, TriangleAlert, Volume2, VolumeX, X } from "lucide-react";
import { markNotificationsSeen } from "@/app/actions/notifications";
import { playChime, readSoundEnabled, subscribeSound, unlockAudio, writeSoundEnabled } from "@/lib/chime";
import { formatAgo, newlyArrived, notificationHref, strongestTone, unreadCount } from "@/lib/notifications";
import type { NotificationItem } from "@/lib/types";

const POLL_MS = 20_000;
const HANDLED_KEY = "nd-notif-handled";
const icons = { positive: CircleCheck, negative: CircleX, attention: TriangleAlert } as const;

type Feed = { available: boolean; items: NotificationItem[]; lastSeenAt: string | null };

function loadHandled(): Set<string> | null {
  try {
    const raw = localStorage.getItem(HANDLED_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : null;
  } catch { return null; }
}
function saveHandled(ids: string[], previous: Set<string> | null) {
  try { localStorage.setItem(HANDLED_KEY, JSON.stringify([...ids, ...(previous ?? [])].slice(0, 80))); } catch { /* Announcements may repeat after a reload. */ }
}

function Toast({ item, onClose }: { item: NotificationItem; onClose: (id: string) => void }) {
  const Icon = icons[item.tone];
  useEffect(() => { const timer = setTimeout(() => onClose(item.id), 7000); return () => clearTimeout(timer); }, [item.id, onClose]);
  return <div className={`toast tone-${item.tone}`} role="status">
    <Icon size={20} aria-hidden />
    <div><strong>{item.title}</strong><p>{item.message}</p><Link href={notificationHref(item)} onClick={() => onClose(item.id)}>{item.publication_id ? "View post" : item.kind === "publish_result" ? "View publishing" : "View checks"}</Link></div>
    <button type="button" className="toast-close" aria-label="Dismiss notification" onClick={() => onClose(item.id)}><X size={16} aria-hidden /></button>
  </div>;
}

export function NotificationCenter() {
  const [available, setAvailable] = useState(true);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [lastSeen, setLastSeen] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [toasts, setToasts] = useState<NotificationItem[]>([]);
  const [rung, setRung] = useState(0);
  const panel = useRef<HTMLDivElement>(null);
  const soundOn = useSyncExternalStore(subscribeSound, readSoundEnabled, () => true);

  const dismiss = useCallback((id: string) => setToasts((current) => current.filter((toast) => toast.id !== id)), []);

  const poll = useCallback(async () => {
    try {
      const response = await fetch("/dashboard/notifications/feed", { cache: "no-store", headers: { Accept: "application/json" } });
      if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) return;
      const feed = (await response.json()) as Feed;
      if (!feed.available) { setAvailable(false); return; }
      setItems(feed.items);
      const seen = feed.lastSeenAt ? Date.parse(feed.lastSeenAt) : null;
      setLastSeen(seen);
      if (seen === null) void markNotificationsSeen().then(() => setLastSeen(Date.now())).catch(() => undefined);

      const handled = loadHandled();
      const { fresh, announce } = newlyArrived(feed.items, handled);
      if (fresh.length) saveHandled(fresh, handled);
      if (announce) {
        const arrivals = feed.items.filter((item) => fresh.includes(item.id));
        setToasts((current) => [...arrivals.slice(0, 3), ...current].slice(0, 3));
        setRung((count) => count + 1);
        if (readSoundEnabled()) playChime(strongestTone(arrivals));
      }
    } catch { /* Offline or signed out: try again next time. */ }
  }, []);

  useEffect(() => {
    const first = setTimeout(() => void poll(), 0);
    const timer = setInterval(() => { if (!document.hidden) void poll(); }, POLL_MS);
    const onVisible = () => { if (!document.hidden) void poll(); };
    const unlock = () => unlockAudio();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      clearTimeout(first); clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [poll]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => { if (!panel.current?.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onPointer); document.removeEventListener("keydown", onKey); };
  }, [open]);

  if (!available) return null;
  const unread = unreadCount(items, lastSeen);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) { setLastSeen(Date.now()); void markNotificationsSeen().catch(() => undefined); }
  }

  return <div className="notify" ref={panel}>
    <button type="button" className={`bell ${unread ? "has-unread" : ""}`} aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"} aria-expanded={open} aria-haspopup="true" onClick={toggle}>
      <span key={rung} className="bell-icon"><Bell size={19} aria-hidden /></span>
      {unread > 0 && <span className="bell-badge" aria-hidden>{unread > 9 ? "9+" : unread}</span>}
    </button>
    {open && <div className="notify-panel" role="region" aria-label="Notifications">
      <div className="notify-head"><strong>Notifications</strong><button type="button" className="notify-sound" aria-pressed={soundOn} onClick={() => { unlockAudio(); writeSoundEnabled(!soundOn); }}>{soundOn ? <Volume2 size={15} aria-hidden /> : <VolumeX size={15} aria-hidden />}{soundOn ? "Sound on" : "Sound off"}</button></div>
      {items.length === 0 ? <p className="notify-empty">Nothing yet. Results appear here as soon as a post check is recorded.</p> : <ul className="notify-list">{items.map((item) => { const Icon = icons[item.tone]; return <li key={item.id}><Link href={notificationHref(item)} onClick={() => setOpen(false)} className={`tone-${item.tone}`}><Icon size={18} aria-hidden /><span><strong>{item.title}</strong><small>{item.message}</small></span><time dateTime={item.created_at}>{formatAgo(item.created_at)}</time></Link></li>; })}</ul>}
      <Link className="notify-foot" href="/dashboard/checks" onClick={() => setOpen(false)}>Open post checks</Link>
    </div>}
    {!open && <div className="toast-stack" aria-live="polite">{toasts.map((toast) => <Toast key={toast.id} item={toast} onClose={dismiss} />)}</div>}
  </div>;
}
