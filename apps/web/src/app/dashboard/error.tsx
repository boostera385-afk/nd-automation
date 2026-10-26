"use client";

export default function DashboardError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <section className="panel"><p className="eyebrow">LOAD INTERRUPTED</p><h1>Your workspace is temporarily unavailable.</h1><p className="muted">Please try again in a moment. If the problem continues, contact your workspace administrator. No records were changed.</p><button className="button secondary" onClick={reset}>Try again</button></section>;
}
