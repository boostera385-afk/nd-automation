import { PublicationsView } from "@/components/publications-view";
import type { SearchParams } from "@/lib/filters";

export default async function Today({ searchParams }: { searchParams: Promise<SearchParams> }) { return <PublicationsView period="today" params={await searchParams} />; }
