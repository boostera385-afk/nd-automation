"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

// Refreshes saved state / read-only previews, never invokes a mutation action.
export function LiveRefresh() {
  const router = useRouter();
  const [enabled, setEnabled] = useState(true);
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, 60_000);
    return () => clearInterval(timer);
  }, [enabled, router]);
  return <div className="refresh-tools"><button className="button secondary" type="button" onClick={() => router.refresh()}><RefreshCw size={15} aria-hidden />Refresh</button><label className="check"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />Refresh view every minute</label></div>;
}
