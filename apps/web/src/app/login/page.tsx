import { AuthScreen } from "@/components/auth-screen";

export default async function Login({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const { notice } = await searchParams;
  return <AuthScreen mode="login" title="Welcome back." description="Sign in to pick up where your workday left off." notice={notice === "invalid-link" ? "That email link is invalid or expired. Request a new one." : undefined} />;
}
