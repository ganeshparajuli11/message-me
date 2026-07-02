import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireParticipant, requireUser } from "./lib/helpers";
import { TYPING_WINDOW_MS } from "./lib/validation";

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
 * Subscription query for the typing indicator: is the *other* participant's
 * typing row fresh (within 3s)? Spec-implied read side of Section 5.
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
    const cutoff = Date.now() - TYPING_WINDOW_MS;
    return rows.some((t) => t.userId !== me._id && t.updatedAt >= cutoff);
  },
});
