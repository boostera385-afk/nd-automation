import { z } from "zod";

// Exact v1 payload projection. Never upload the whole extension object or credentials.
const chars = (max: number) => z.string().refine((value) => !value.includes("\0") && Array.from(value).length <= max, `Maximum ${max} characters; no null bytes`);
const sourceUrl = chars(4096).regex(/^https:\/\/[A-Za-z0-9.-]+(:[0-9]{1,5})?([/?#][^\s]*)?$/);
export const fudgePayloadSchema = z.strictObject({
  text: chars(30000).refine((value) => value.length > 0 && value.trim().length > 0, "Original text required"),
  rating: z.number().int().min(1).max(5),
  author: chars(300),
  business_name: chars(500),
  place_id: chars(512),
  source_url: sourceUrl,
  photo_urls: z.array(sourceUrl).max(30),
  display_date: chars(200),
});

export const fudgeReviewSchema = z.strictObject({
  source: z.literal("google"),
  source_review_id: chars(512).refine((value) => value.length > 0 && !/[\s\u0000-\u001f\u007f]/.test(value), "Stable Google review ID required"),
  observed_at: z.iso.datetime({ offset: true }).regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$/),
  payload: fudgePayloadSchema,
});

export const fudgeBatchSchema = z.strictObject({
  version: z.literal(1),
  organization_id: z.uuid(),
  reviews: z.array(fudgeReviewSchema).min(1).max(100),
}).superRefine((value, context) => {
  const identities = new Set<string>();
  for (const [index, review] of value.reviews.entries()) {
    if (identities.has(review.source_review_id)) context.addIssue({ code: "custom", path: ["reviews", index, "source_review_id"], message: "Duplicate identity within batch" });
    identities.add(review.source_review_id);
    if (Date.parse(review.observed_at) > Date.now() + 300000) context.addIssue({ code: "custom", path: ["reviews", index, "observed_at"], message: "Observation timestamp is in the future" });
    // Conservative transport budget, smaller than the SQL JSONB-text ceiling.
    if (new TextEncoder().encode(JSON.stringify(review.payload)).length > 120000) context.addIssue({ code: "custom", path: ["reviews", index, "payload"], message: "Payload exceeds client byte budget" });
  }
  if (new TextEncoder().encode(JSON.stringify(value)).length > 262144) context.addIssue({ code: "custom", message: "Batch exceeds 256 KiB client transport budget" });
});

export const fudgeReceiptSchema = z.strictObject({
  source: z.literal("google"), source_review_id: z.string(), record_id: z.uuid(), revision_id: z.uuid(),
  revision: z.number().int().positive().max(2147483647), inserted_record: z.boolean(), inserted_revision: z.boolean(),
}).refine((value) => !value.inserted_record || (value.inserted_revision && value.revision === 1), "A new record requires its first revision");
export type FudgeReview = z.infer<typeof fudgeReviewSchema>;
export type FudgeReceipt = z.infer<typeof fudgeReceiptSchema>;

// Matches the current content.js collector. Extra local fields are deliberately
// stripped before projection; no rewrite, service inference, cookie or key is uploaded.
const collectorReviewSchema = z.object({
  googleReviewId: fudgeReviewSchema.shape.source_review_id,
  text: fudgePayloadSchema.shape.text,
  rating: fudgePayloadSchema.shape.rating,
  author: fudgePayloadSchema.shape.author.optional().default(""),
  placeName: fudgePayloadSchema.shape.business_name.optional().default(""),
  placeId: fudgePayloadSchema.shape.place_id.optional().default(""),
  sourceUrl: fudgePayloadSchema.shape.source_url,
  photos: fudgePayloadSchema.shape.photo_urls,
  date: fudgePayloadSchema.shape.display_date.optional().default(""),
  collectedAt: fudgeReviewSchema.shape.observed_at,
});

/** Candidate projection only. A null result stays local/blocked, never discarded. */
export function projectFudgeCollectorReview(value: unknown): FudgeReview | null {
  const parsed = collectorReviewSchema.safeParse(value);
  if (!parsed.success) return null;
  const record = parsed.data;
  return {
    source: "google", source_review_id: record.googleReviewId, observed_at: record.collectedAt,
    payload: { text: record.text, rating: record.rating, author: record.author, business_name: record.placeName,
      place_id: record.placeId, source_url: record.sourceUrl, photo_urls: [...record.photos], display_date: record.date },
  };
}

/** No acknowledgment unless the whole response exactly covers the submitted batch. */
export function validateFudgeReceipts(reviews: FudgeReview[], response: unknown): FudgeReceipt[] | null {
  const result = z.array(fudgeReceiptSchema).safeParse(response);
  if (!result.success || result.data.length !== reviews.length) return null;
  if (result.data.some((receipt, index) => receipt.source !== reviews[index].source || receipt.source_review_id !== reviews[index].source_review_id)) return null;
  if (new Set(result.data.map((receipt) => receipt.record_id)).size !== result.data.length) return null;
  if (new Set(result.data.map((receipt) => receipt.revision_id)).size !== result.data.length) return null;
  return result.data;
}
