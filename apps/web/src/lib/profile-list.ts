import type { ProfileRow } from "./profiles";

export function profileListPage<T extends ProfileRow>(profiles: T[], query: string, requestedPage: number) {
  const text = query.trim().toLowerCase();
  const matches = profiles.filter((profile) => `${profile.name} ${profile.group_name} ${profile.profile_id}`.toLowerCase().includes(text));
  const pages = Math.max(1, Math.ceil(matches.length / 50));
  const page = Math.min(Math.max(0, requestedPage), pages - 1);
  return { rows: matches.slice(page * 50, (page + 1) * 50), matches: matches.length, pages, page };
}
