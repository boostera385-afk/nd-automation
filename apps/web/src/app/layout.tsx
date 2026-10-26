import type { Metadata, Viewport } from "next";
import { themeInitScript } from "@/lib/theme-script";
import "./globals.css";

export const metadata: Metadata = { title: { default: "ND Automations", template: "%s · ND Automations" }, description: "A focused workspace for customer post records, conversations and daily reporting." };

export const viewport: Viewport = {
  colorScheme: "light dark",
  themeColor: [{ media: "(prefers-color-scheme: light)", color: "#f3f5f9" }, { media: "(prefers-color-scheme: dark)", color: "#0a1020" }],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: themeInitScript }} /></head><body>{children}</body></html>;
}
