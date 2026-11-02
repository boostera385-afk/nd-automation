import { z } from "zod";

export const approvedImageSchema = z.strictObject({
  id: z.uuid().refine((id) => id === id.toLowerCase()), sha256: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.number().int().min(1).max(8 * 1024 * 1024),
  mime: z.enum(["image/jpeg", "image/png", "image/webp"]), name: z.string().regex(/^[A-Za-z0-9_-]{1,80}\.(jpg|png|webp)$/),
  rightsConfirmed: z.literal(true), privacyReviewed: z.literal(true),
}).refine((item) => item.name.endsWith({ "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" }[item.mime]), "Image extension must match its approved MIME type.");
export const approvedMediaSchema = z.array(approvedImageSchema).max(10).superRefine((items, context) => {
  if (new Set(items.map((item) => item.id)).size !== items.length || items.reduce((sum, item) => sum + item.bytes, 0) > 30 * 1024 * 1024) {
    context.addIssue({ code: "custom", message: "Use distinct approved images totaling at most 30 MiB." });
  }
});
