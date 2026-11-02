import { expect, it } from "vitest";
import { approvedMediaSchema } from "@/lib/approved-media";
import { contentFromForm } from "@/lib/content";
const image = { id: "11111111-1111-4111-8111-111111111111", sha256: "b".repeat(64), bytes: 1024, mime: "image/png", name: "fixture.png", rightsConfirmed: true, privacyReviewed: true };
it("accepts approved bounded descriptors, never paths or media bytes", () => {
  expect(approvedMediaSchema.safeParse([image]).success).toBe(true);
});
it.each([{ ...image, path: "C:/private.png" }, { ...image, url: "https://private.invalid/image.png" }, { ...image, rightsConfirmed: false },
  { ...image, privacyReviewed: false }, { ...image, bytes: 8388609 }, { ...image, name: "../escape.png" }, { ...image, mime: "image/jpeg" },
  { ...image, mime: "image/svg+xml" }, { ...image, bytes: true }, { ...image, sha256: "not-a-hash" }])("rejects unsafe metadata %#", (value) => {
  expect(approvedMediaSchema.safeParse([value]).success).toBe(false);
});
it("bounds total bytes, image count and duplicate IDs", () => {
  expect(approvedMediaSchema.safeParse([image, image]).success).toBe(false);
  const rows = Array.from({ length: 11 }, (_, i) => ({ ...image, id: `${String(i + 1).padStart(8, "0")}-1111-4111-8111-111111111111`, bytes: 8388608 }));
  expect(approvedMediaSchema.safeParse(rows).success).toBe(false); expect(approvedMediaSchema.safeParse(rows.slice(0, 4)).success).toBe(false);
});
it("form parsing preserves exact fingerprints and refuses invalid input rather than dropping attachments", () => {
  const form = new FormData();
  for (const [key, value] of Object.entries({ kind: "post", title: "Fixture title", body: "Authorized content", audience: "neighborhood" })) form.set(key, value);
  form.set("media", JSON.stringify([image])); expect(contentFromForm(form).data?.media).toEqual([image]);
  form.set("media", "PRIVATE_INVALID_JSON"); expect(contentFromForm(form).success).toBe(false);
  form.set("media", "[]"); expect(contentFromForm(form).data).not.toHaveProperty("media");
  form.set("media", new File(["private-bytes"], "private.png")); expect(contentFromForm(form).success).toBe(false);
});
