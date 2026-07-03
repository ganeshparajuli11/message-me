import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireParticipant, requireUser } from "./lib/helpers";

/**
 * setTyping — upserts the caller's typingStatus row; the client throttles
 * calls to ~1/sec. No "clear typing" call: subscribers treat a row as typing
 * only while updatedAt is within the last 3 seconds. (Spec Section 5.)
 */
export const setTyping = mutation({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    const me = await requireUser(ctx);
    await requireParticipant(ctx, args.conversationId, me._id);
    const existing = await ctx.db
      .query("typingStatus")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", args.conversationId),
      )
      .collect();
    const mine = existing.find((t) => t.userId === me._id);
    const now = Date.now();
    if (mine !== undefined) {
      await ctx.db.patch(mine._id, { updatedAt: now });
    } else {
      await ctx.db.insert("typingStatus", {
        conversationId: args.conversationId,
        userId: me._id,
        updatedAt: now,
      });
    }
  },
});

/**
 * Subscription query for the typing indicator. Returns the other
 * participant's latest typing timestamp (or null). Freshness is computed
 * CLIENT-SIDE against a ticking clock (revamp Section 4): Convex queries only
 * re-run when data changes, so a server-side boolean would stay stale-true
 * after the last keystroke.
 */
export const getTyping = query({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    const me = await requireUser(ctx);
    await requireParticipant(ctx, args.conversationId, me._id);
    const rows = await ctx.db
      .query("typingStatus")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", args.conversationId),
      )
      .collect();
    const others = rows.filter((t) => t.userId !== me._id);
    if (others.length === 0) return null;
    return Math.max(...others.map((t) => t.updatedAt));
  },
});
