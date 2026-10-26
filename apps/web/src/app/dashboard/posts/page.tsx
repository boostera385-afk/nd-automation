import { PublicationsView } from "@/components/publications-view";
import type { SearchParams } from "@/lib/filters";

export default async function Posts({ searchParams }: { searchParams: Promise<SearchParams> }) { return <PublicationsView period="all" params={await searchParams} />; }
