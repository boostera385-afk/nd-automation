// Keep the main navigation tiny: no sheet parsers or server modules in its bundle.
export const primaryNavigation = [
  { href: "/dashboard", label: "Home", staff: false },
  { href: "/dashboard/master-sheet", label: "Master Sheet", staff: true },
  { href: "/dashboard/run", label: "Run automation", staff: true },
  { href: "/dashboard/profiles", label: "Profiles", staff: true },
  { href: "/dashboard/results", label: "Results", staff: false },
] as const;

export function navigationSection(path: string): string {
  const section = path.split("/")[2];
  if (!section) return "/dashboard";
  if (["results", "responses", "posts", "today", "yesterday", "checks", "comments"].includes(section)) return "/dashboard/results";
  if (section === "master-sheet" || section === "run" || section === "profiles") return `/dashboard/${section}`;
  return "/dashboard/settings";
}
