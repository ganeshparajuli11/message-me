import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireUser } from "./lib/helpers";

/**
 * Block/unblock (Spec Section 5). The block check itself runs server-side
 * inside sendMessage and createConversation — never rely on the client.
 */

export const blockUser = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const me = await requireUser(ctx);
    if (args.userId === me._id) {
      throw new ConvexError("You cannot block yourself");
    }
    const target = await ctx.db.get(args.userId);
    if (target === null) throw new ConvexError("User not found");
    const existing = await ctx.db
      .query("blocks")
      .withIndex("by_blocker", (q) => q.eq("blockerId", me._id))
      .collect();
    if (existing.some((b) => b.blockedId === args.userId)) return;
    await ctx.db.insert("blocks", {
      blockerId: me._id,
      blockedId: args.userId,
    });
  },
});

export const unblockUser = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const me = await requireUser(ctx);
    const existing = await ctx.db
      .query("blocks")
      .withIndex("by_blocker", (q) => q.eq("blockerId", me._id))
      .collect();
    const row = existing.find((b) => b.blockedId === args.userId);
    if (row !== undefined) {
      await ctx.db.delete(row._id);
    }
  },
});

/** Users I have blocked — for the UI's block-state display. */
export const listMyBlocks = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireUser(ctx);
    const rows = await ctx.db
      .query("blocks")
      .withIndex("by_blocker", (q) => q.eq("blockerId", me._id))
      .collect();
    return rows.map((b) => b.blockedId);
  },
});
