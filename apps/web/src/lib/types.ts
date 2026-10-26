import type { Visibility } from "./validation";

export type Membership = { organization_id: string; role: "owner" | "admin" | "operator" | "customer" };
export type Organization = { id: string; name: string; time_zone: string };
export type Customer = { id: string; organization_id: string; name: string; time_zone: string; service: string | null; created_at: string };
export type Publication = {
  id: string; organization_id: string; customer_id: string; title: string; url: string; account_label: string;
  published_at: string | null; source: "manual_entry" | "sheet_import"; created_at: string;
  visibility: Visibility; last_observed_at: string | null; comments_total: number | null;
  recorded_session_id: string | null;
  // Present once the post-checks migration has been applied.
  last_check_outcome?: string | null; last_checked_at?: string | null;
};
export type PostCheck = { id: string; publication_id: string; outcome: string; tone: "positive" | "negative" | "attention"; message: string; notes: string; checked_at: string; source: string };
export type NotificationItem = { id: string; publication_id: string | null; kind: "check_result" | "check_batch"; tone: "positive" | "negative" | "attention"; title: string; message: string; check_count: number; created_at: string };
export type Observation = { id: string; publication_id: string; visibility: Visibility; observed_at: string; comments_total: number | null; comments_complete: boolean; notes: string; source: string };
export type Comment = { id: string; publication_id: string; body: string; author_label: string; platform_created_at: string | null; first_observed_at: string; source_comment_id: string | null };
export type WorkSession = { id: string; organization_id: string; user_id: string; status: "active" | "paused" | "closed"; started_at: string; ended_at: string | null; paused_at: string | null; paused_seconds: number; business_time_zone: string; device_time_zone: string };
