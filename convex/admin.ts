/**
 * Admin functions (Spec Section 5).
 *
 * ARCHITECTURAL BOUNDARY (Sections 5, 8, 11): nothing in this file may read
 * from the `messages` table. Admins see users and report metadata only —
 * never message content. Do not add any messages import/query here.
 */
import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { requireAdmin } from "./lib/helpers";

/**
 * Bootstrap the first admin. NOT callable from clients — run it from the
 * server with the deployment admin key:
 *   npx convex run admin:promoteToAdminByUsername '{"username":"yourname"}'
 */
export const promoteToAdminByUsername = internalMutation({
  args: { username: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_usernameLower", (q) =>
        q.eq("usernameLower", args.username.toLowerCase()),
      )
      .first();
    if (user === null) throw new ConvexError("User not found");
    await ctx.db.patch(user._id, { role: "admin" });
    return { promoted: user.username };
  },
});

export const banUser = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    if (args.userId === admin._id) {
      throw new ConvexError("You cannot ban yourself");
    }
    const target = await ctx.db.get(args.userId);
    if (target === null) throw new ConvexError("User not found");
    if (target.role === "admin") {
      throw new ConvexError("Cannot ban another admin");
    }
    await ctx.db.patch(args.userId, { status: "banned" });
  },
});

export const suspendUser = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    if (args.userId === admin._id) {
      throw new ConvexError("You cannot suspend yourself");
    }
    const target = await ctx.db.get(args.userId);
    if (target === null) throw new ConvexError("User not found");
    if (target.role === "admin") {
      throw new ConvexError("Cannot suspend another admin");
    }
    await ctx.db.patch(args.userId, { status: "suspended" });
  },
});

/** Reactivate a banned/suspended user (counterpart to ban/suspend). */
export const reinstateUser = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const target = await ctx.db.get(args.userId);
    if (target === null) throw new ConvexError("User not found");
    await ctx.db.patch(args.userId, { status: "active" });
  },
});

/**
 * warnUser — FLAGGED GAP: the Section 4 schema has no field/table to persist
 * a warning, and the spec forbids inventing schema. This validates the action
 * and succeeds, but nothing is stored and the user is not notified. Ask the
 * project owner whether to add a warnings table (or a warnedAt field) before
 * shipping. See README "Spec deviations".
 */
export const warnUser = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    if (args.userId === admin._id) {
      throw new ConvexError("You cannot warn yourself");
    }
    const target = await ctx.db.get(args.userId);
    if (target === null) throw new ConvexError("User not found");
    // Intentionally no persistence — see docblock.
    return { warned: true, persisted: false };
  },
});

/**
 * listUsers(filter?) — admin-only user management table with basic username
 * search (prefix match via by_usernameLower). (Spec Sections 2, 5.)
 */
export const listUsers = query({
  args: { filter: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const filter = args.filter?.trim().toLowerCase();

    const users =
      filter !== undefined && filter !== ""
        ? await ctx.db
            .query("users")
            .withIndex("by_usernameLower", (q) =>
              q.gte("usernameLower", filter).lt("usernameLower", filter + "￿"),
            )
            .take(100)
        : await ctx.db
            .query("users")
            .withIndex("by_usernameLower")
            .take(100);

    return users.map((u) => ({
      _id: u._id,
      username: u.username,
      role: u.role,
      status: u.status,
      lastActiveAt: u.lastActiveAt ?? null,
      createdAt: u._creationTime,
    }));
  },
});
