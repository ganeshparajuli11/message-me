import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAdmin, requireUser } from "./lib/helpers";
import {
  REPORT_RATE_LIMIT_PER_TARGET_MS,
  REPORT_REASON_MAX_LENGTH,
} from "./lib/validation";

/**
 * reportUser — messageSnapshot is only ever attached voluntarily by the
 * reporter (one specific message's text). This is the reporter choosing to
 * share, not admin browsing. (Spec Section 5.)
 *
 * Rate limit (Section 8): max one report per reporter against the same user
 * per 24h, checked via the by_reportedUser index. (A global per-reporter cap
 * would need a by_reporter index the spec schema doesn't define — flagged in
 * README "Spec deviations".)
 */
export const reportUser = mutation({
  args: {
    reportedUserId: v.id("users"),
    reason: v.string(),
    messageSnapshot: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const me = await requireUser(ctx);
    if (args.reportedUserId === me._id) {
      throw new ConvexError("You cannot report yourself");
    }
    const target = await ctx.db.get(args.reportedUserId);
    if (target === null) throw new ConvexError("User not found");

    const reason = args.reason.trim();
    if (!reason) throw new ConvexError("A reason is required");
    if (reason.length > REPORT_REASON_MAX_LENGTH) {
      throw new ConvexError("Reason is too long");
    }

    const now = Date.now();
    const againstTarget = await ctx.db
      .query("reports")
      .withIndex("by_reportedUser", (q) =>
        q.eq("reportedUserId", args.reportedUserId),
      )
      .collect();
    const mineRecent = againstTarget.some(
      (r) =>
        r.reporterId === me._id &&
        r.createdAt > now - REPORT_RATE_LIMIT_PER_TARGET_MS,
    );
    if (mineRecent) {
      throw new ConvexError(
        "You already reported this user recently — the report is with our admins",
      );
    }

    await ctx.db.insert("reports", {
      reporterId: me._id,
      reportedUserId: args.reportedUserId,
      reason,
      messageSnapshot: args.messageSnapshot,
      status: "open",
      createdAt: now,
    });
  },
});

/** listReports — admin-only. Metadata + reporter-shared snapshot only. */
export const listReports = query({
  args: {
    status: v.optional(v.union(v.literal("open"), v.literal("resolved"))),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    // Reports are moderate in volume; iterate newest-first via the table's
    // creation order. Filter by status in JS to avoid an extra index.
    const all = await ctx.db.query("reports").order("desc").take(500);
    const filtered =
      args.status === undefined
        ? all
        : all.filter((r) => r.status === args.status);
    return await Promise.all(
      filtered.map(async (r) => {
        const [reporter, reported] = await Promise.all([
          ctx.db.get(r.reporterId),
          ctx.db.get(r.reportedUserId),
        ]);
        return {
          _id: r._id,
          reporter: reporter?.username ?? "(deleted)",
          reportedUserId: r.reportedUserId,
          reported: reported?.username ?? "(deleted)",
          reportedStatus: reported?.status ?? null,
          reason: r.reason,
          messageSnapshot: r.messageSnapshot ?? null,
          status: r.status,
          createdAt: r.createdAt,
        };
      }),
    );
  },
});

/** resolveReport — admin-only. */
export const resolveReport = mutation({
  args: { reportId: v.id("reports") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const report = await ctx.db.get(args.reportId);
    if (report === null) throw new ConvexError("Report not found");
    await ctx.db.patch(args.reportId, { status: "resolved" });
  },
});
