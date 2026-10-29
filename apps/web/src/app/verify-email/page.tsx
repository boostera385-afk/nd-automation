import Link from "next/link";
import { redirect } from "next/navigation";
import { getIdentity } from "@/lib/data";
import { AuthScreen } from "@/components/auth-screen";
import { signOut } from "@/app/actions/auth";

export default async function VerifyEmail() {
  const { user } = await getIdentity();
  if (user.email_confirmed_at) redirect("/dashboard");
  return <AuthScreen title="Email confirmation required" description="Your session is signed in, but this account cannot access business data or automation until its email is confirmed.">
    <p className="notice">For this internal tool, contact your administrator to confirm your staff account and membership. Email delivery and self-service recovery are not configured. Do not send passwords or tokens through chat.</p>
    <Link className="button" href="/dashboard">Check confirmation again</Link>
    <form action={signOut}><button className="button secondary">Sign out</button></form>
  </AuthScreen>;
}
