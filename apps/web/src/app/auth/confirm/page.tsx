import type { Metadata } from "next";
import { z } from "zod";
import { AuthScreen } from "@/components/auth-screen";
import { AuthConfirm } from "@/components/auth-confirm";
import { CONFIRM_TYPES } from "@/lib/auth-results";

export const metadata: Metadata = { title: "Confirm", robots: { index: false, follow: false } };

export default async function Confirm({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  const input = z.object({ token_hash: z.string().min(8).max(512), type: z.enum(CONFIRM_TYPES) }).safeParse({ token_hash: first(params.token_hash), type: first(params.type) });
  if (!input.success) return <AuthScreen title="This link is not valid." description="It may be incomplete or expired. Go back to sign in and request a new one." notice="The link is missing information. Request a new email from the sign-in page." />;
  const recovery = input.data.type === "recovery";
  return <AuthScreen title={recovery ? "Reset your password." : "Confirm your email."} description={recovery ? "Continue to choose a new password for your workspace." : "Confirm this address to open your private workspace."}><AuthConfirm tokenHash={input.data.token_hash} type={input.data.type} /></AuthScreen>;
}
