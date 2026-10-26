import Link from "next/link";
export default function NotFound() { return <main className="setup-shell"><h1>Record not found</h1><p>This record does not exist or is not available to your account.</p><Link className="button" href="/dashboard">Return to workspace</Link></main>; }
