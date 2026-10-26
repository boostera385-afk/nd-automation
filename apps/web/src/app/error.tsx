"use client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="setup-shell"><section className="panel"><h1>We couldn’t open your workspace.</h1><p>Please try again. If this continues, contact your workspace administrator.</p><button className="button" onClick={reset}>Try again</button></section></main>;
}
