import { createHash } from "node:crypto";
import { z } from "zod";

export const EVIDENCE_BUCKET = "reporting-evidence";
export const MAX_EVIDENCE_BYTES = 3 * 1024 * 1024;
export const evidenceRequest = z.strictObject({
  publication: z.uuid(), observed: z.iso.datetime({ offset: true }),
  reviewDays: z.union([z.literal(""), z.coerce.number().int().min(1).max(3650)]),
});
// Bounded structural checks, not a full image decoder/malware scan. Serve as an
// attachment only, never execute/render untrusted evidence in the dashboard.
export function inspectEvidence(data: Buffer, claimedMime: string) {
  if (!data.length || data.length > MAX_EVIDENCE_BYTES) throw new Error("Use an image no larger than 3 MiB.");
  let mime: string;
  if (data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    if (data.length < 45 || data.toString("ascii", 12, 16) !== "IHDR") throw new Error("Invalid PNG.");
    const width = data.readUInt32BE(16), height = data.readUInt32BE(20);
    if (!width || !height || width > 12000 || height > 12000 || width * height > 40_000_000) throw new Error("Image dimensions exceed limits.");
    let cursor = 8, ended = false;
    while (cursor + 12 <= data.length) {
      const length = data.readUInt32BE(cursor), kind = data.toString("ascii", cursor + 4, cursor + 8);
      cursor += length + 12;
      if (cursor > data.length || kind === "acTL") throw new Error("Malformed or animated PNG.");
      if (kind === "IEND") { ended = length === 0 && cursor === data.length; break; }
    }
    if (!ended) throw new Error("Invalid PNG termination.");
    mime = "image/png";
  } else if (data.subarray(0, 3).equals(Buffer.from([255, 216, 255])) && data.subarray(-2).equals(Buffer.from([255, 217]))) {
    let cursor = 2, dimensions = false;
    while (cursor + 4 <= data.length) {
      if (data[cursor++] !== 255) break;
      while (data[cursor] === 255) cursor++;
      const marker = data[cursor++];
      if (marker === 218 || marker === 217) break;
      const length = data.readUInt16BE(cursor);
      if (length < 2 || cursor + length > data.length) break;
      if ([192, 193, 194].includes(marker) && length >= 8) {
        const height = data.readUInt16BE(cursor + 3), width = data.readUInt16BE(cursor + 5);
        if (!width || !height || width > 12000 || height > 12000 || width * height > 40_000_000) throw new Error("Image dimensions exceed limits.");
        dimensions = true; break;
      }
      cursor += length;
    }
    if (!dimensions) throw new Error("JPEG dimensions could not be verified.");
    mime = "image/jpeg";
  } else throw new Error("Only PNG and JPEG evidence is supported.");
  if (mime !== claimedMime) throw new Error("Image bytes do not match the declared type.");
  return { mime, bytes: data.length, sha256: createHash("sha256").update(data).digest("hex") };
}
