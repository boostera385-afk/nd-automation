import { PublicationsView } from "@/components/publications-view";
import type { SearchParams } from "@/lib/filters";

export default async function Yesterday({ searchParams }: { searchParams: Promise<SearchParams> }) { return <PublicationsView period="yesterday" params={await searchParams} />; }
