export default function Loading() {
  return (
    <div aria-busy="true">
      <p className="sr-only" role="status">Loading your workspace…</p>
      <div className="skeleton skeleton-line short" />
      <div className="skeleton skeleton-title" />
      <div className="stats-grid">{[0, 1, 2, 3].map((item) => <div key={item} className="skeleton skeleton-card" />)}</div>
      <div className="skeleton skeleton-panel" />
    </div>
  );
}
