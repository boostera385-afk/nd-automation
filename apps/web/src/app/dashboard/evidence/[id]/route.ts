import { requireWorkspace } from "@/lib/data";
import { EVIDENCE_BUCKET, MAX_EVIDENCE_BYTES, inspectEvidence } from "@/lib/evidence";
import { z } from "zod";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
  if (!z.uuid().safeParse(id).success) return new Response("Not found", { status: 404, headers });
  const { db, organization, isStaff } = await requireWorkspace();
  const record = await db.from("reporting_evidence").select("object_key,mime,bytes,sha256,state").eq("organization_id", organization.id).eq("id", id).single();
  if (record.error || !record.data || (!isStaff && record.data.state !== "ready") || record.data.state === "deleted" || record.data.object_key !== `${organization.id}/${id}`) return new Response("Not found", { status: 404, headers });
  const object = await db.storage.from(EVIDENCE_BUCKET).download(record.data.object_key);
  if (object.error || !object.data || object.data.size > MAX_EVIDENCE_BYTES) return new Response("Evidence unavailable", { status: 404, headers });
  const bytes = Buffer.from(await object.data.arrayBuffer());
  try {
    const actual = inspectEvidence(bytes, record.data.mime);
    if (actual.bytes !== record.data.bytes || actual.sha256 !== record.data.sha256) throw new Error("Mismatch");
  } catch { return new Response("Evidence integrity check failed", { status: 409, headers }); }
  return new Response(bytes, { headers: { ...headers, "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="evidence-${id}.${record.data.mime === "image/png" ? "png" : "jpg"}"` } });
}
