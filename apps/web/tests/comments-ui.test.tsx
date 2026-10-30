import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireWorkspace: vi.fn(), getDashboardData: vi.fn(), getPublication: vi.fn(), getRecentChecks: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("notFound"); },
  redirect: (path: string) => { throw new Error(`redirect:${path}`); },
  usePathname: () => "/dashboard",
  useRouter: () => ({ refresh: () => undefined }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) =>
    <a href={href} className={className}>{children}</a>,
}));
vi.mock("@/lib/data", () => ({
  requireWorkspace: mocks.requireWorkspace,
  getDashboardData: mocks.getDashboardData,
  getPublication: mocks.getPublication,
}));
vi.mock("@/lib/checks-data", () => ({ getRecentChecks: mocks.getRecentChecks, getChecksForPost: vi.fn(async () => []) }));
vi.mock("@/components/live-refresh", () => ({ LiveRefresh: () => null }));
vi.mock("@/components/reporting-forms", () => ({
  ObservationForm: () => null,
  CommentForm: () => null,
  SingleCheckForm: () => null,
}));

import Comments from "@/app/dashboard/comments/page";
import Results from "@/app/dashboard/results/page";
import PostDetail from "@/app/dashboard/posts/[id]/page";

const organization = { id: "11111111-1111-4111-8111-111111111111", name: "Fixture workspace", time_zone: "America/Los_Angeles" };
const post = {
  id: "33333333-3333-4333-8333-333333333333",
  customer_id: "44444444-4444-4444-8444-444444444444",
  title: "A stored pilot post title",
  url: "https://nextdoor.com/p/fixture",
  account_label: "Fixture account",
  published_at: null,
  source: "manual_entry",
  visibility: "live",
  last_observed_at: "2026-10-30T20:10:36Z",
  last_check_outcome: "alive",
  comments_total: 2,
};
const comments = [
  { id: "55555555-5555-4555-8555-555555555555", publication_id: post.id, author_label: "Jennifer Tessieri",
    body: "First stored neighbour comment.", first_observed_at: "2026-10-30T20:10:36Z",
    platform_created_at: null, source: "auto_check" },
  { id: "66666666-6666-4666-8666-666666666666", publication_id: post.id, author_label: "Wendy Calvin",
    body: "Second stored neighbour comment.", first_observed_at: "2026-10-30T20:10:36Z",
    platform_created_at: null, source: "auto_check" },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireWorkspace.mockResolvedValue({ organization, isStaff: true });
  mocks.getDashboardData.mockResolvedValue({ publications: [post], customers: [], comments, session: null, truncated: false });
  mocks.getRecentChecks.mockResolvedValue([]);
  mocks.getPublication.mockResolvedValue({ publication: post, observations: [], comments });
});

describe("stored comment detail reaches the dashboard (fixture rows, not live auth)", () => {
  it("renders every stored comment on the detailed comments page, grouped by post", async () => {
    const html = renderToStaticMarkup(await Comments());
    expect(html).toContain("Comments by exact post");
    expect(html).toContain("A stored pilot post title");
    expect(html).toContain("2 stored comments");
    for (const comment of comments) {
      expect(html).toContain(comment.author_label);
      expect(html).toContain(comment.body);
    }
    expect(html).toContain("Creation time unknown");
    expect(html).toContain(`href="/dashboard/posts/${post.id}"`);
  });

  it("renders the same detail in the Results comments tab", async () => {
    const html = renderToStaticMarkup(await Results({ searchParams: Promise.resolve({ view: "comments" }) }));
    for (const comment of comments) {
      expect(html).toContain(comment.author_label);
      expect(html).toContain(comment.body);
    }
    expect(html).toContain("Automatic sample");
  });

  it("renders the same detail on the post ledger page", async () => {
    const html = renderToStaticMarkup(await PostDetail({ params: Promise.resolve({ id: post.id }) }));
    for (const comment of comments) {
      expect(html).toContain(comment.author_label);
      expect(html).toContain(comment.body);
    }
    expect(html).toContain("Automatically collected");
    expect(html).toContain("Platform creation time unknown");
  });

  it("never invents a platform creation time or an author", async () => {
    mocks.getDashboardData.mockResolvedValue({ publications: [post], customers: [], truncated: false,
      comments: [{ ...comments[0], author_label: "Author not collected", platform_created_at: null }], session: null });
    const html = renderToStaticMarkup(await Comments());
    expect(html).toContain("Author not collected");
    expect(html).toContain("Creation time unknown");
  });
});
