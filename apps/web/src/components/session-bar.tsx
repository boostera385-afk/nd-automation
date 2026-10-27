"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Clock3 } from "lucide-react";
import { sessionAction } from "@/app/actions/reporting";
import { sessionSeconds } from "@/lib/time";
import type { WorkSession } from "@/lib/types";
import { ActionForm } from "./action-form";

const subscribe = () => () => {};
const deviceZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const serverZone = () => "UTC";

export function SessionBar({ session, zone, initialTime, canEdit }: { session: WorkSession | null; zone: string; initialTime: string; canEdit: boolean }) {
  const [now, setNow] = useState(new Date(initialTime));
  const local = useSyncExternalStore(subscribe, deviceZone, serverZone);
  useEffect(() => { const timer = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(timer); }, []);
  const clock = (timeZone: string) => new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(now);
  const seconds = session ? sessionSeconds(session, now) : 0;
  const duration = `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m`;
  const controls = !session ? [["start", "Start work"]] : session.status === "paused" ? [["resume", "Resume"], ["end", "End work"]] : [["pause", "Pause"], ["end", "End work"]];
  return <section className="session-bar" aria-label="Business clocks and work session"><div className="session-clock"><Clock3 size={19} /><div><strong>{clock(zone)}</strong><small>Business time · {zone}</small></div></div>{local !== zone && <div className="local-clock"><strong>{clock(local)}</strong><small>Your device · {local}</small></div>}<div className="session-status"><span className={`status-dot ${session?.status === "active" ? "on" : ""}`} /><span>{session ? `${session.status === "paused" ? "Paused" : "Working"} · ${duration}` : "Session closed"}<small>Work session · selected checks only</small></span></div>{canEdit && <div className="session-controls">{controls.map(([action, label]) => <ActionForm key={action} action={sessionAction} label={label} secondary={action !== "start"} className="inline-action"><input type="hidden" name="action" value={action} /><input type="hidden" name="device_zone" value={local} /></ActionForm>)}</div>}</section>;
}
