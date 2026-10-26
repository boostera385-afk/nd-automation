import type { Customer, Publication } from "./types";
import { visibilitySchema, type Visibility } from "./validation";

export type SearchParams = Record<string, string | string[] | undefined>;
export type PublicationFilters = { q: string; visibility: Visibility | null; customer: string };

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

// URL input is untrusted: unknown visibility values and customer ids outside the loaded set are ignored.
export function parseFilters(params: SearchParams, customers: Customer[]): PublicationFilters {
  const visibility = visibilitySchema.safeParse(first(params.visibility));
  const customer = first(params.customer);
  return {
    q: first(params.q).trim().slice(0, 100),
    visibility: visibility.success ? visibility.data : null,
    customer: customers.some((item) => item.id === customer) ? customer : "",
  };
}

export function hasFilters(filters: PublicationFilters) {
  return Boolean(filters.q || filters.visibility || filters.customer);
}

export function filterPublications(publications: Publication[], customers: Customer[], filters: PublicationFilters): Publication[] {
  const names = new Map(customers.map((customer) => [customer.id, customer.name.toLowerCase()]));
  const needle = filters.q.toLowerCase();
  return publications.filter((post) => {
    if (filters.visibility && post.visibility !== filters.visibility) return false;
    if (filters.customer && post.customer_id !== filters.customer) return false;
    if (!needle) return true;
    return [post.title, post.account_label, post.url, names.get(post.customer_id) ?? ""].some((field) => field.toLowerCase().includes(needle));
  });
}
