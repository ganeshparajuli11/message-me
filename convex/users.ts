import { ConvexError, v } from "convex/values";
import type { UserIdentity } from "convex/server";
import { mutation, query } from "./_generated/server";
import { publicUser, requireUser } from "./lib/helpers";

function normalizeUsernameCandidate(input: string): string {
  const cleaned = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (cleaned.length >= 3) return cleaned.slice(0, 20);
  return "user";
}

function baseUsernameFromIdentity(identity: UserIdentity): string {
  const direct =
    identity.preferredUsername ?? identity.nickname ?? identity["username"];
  if (typeof direct === "string" && direct.trim().length > 0) {
    return normalizeUsernameCandidate(direct);
  }

  if (typeof identity.email === "string" && identity.email.includes("@")) {
    return normalizeUsernameCandidate(identity.email.split("@")[0] ?? "user");
  }

  if (typeof identity.name === "string" && identity.name.trim().length > 0) {
    return normalizeUsernameCandidate(identity.name);
  }

  return normalizeUsernameCandidate(identity.subject);
}

/** Current signed-in user, or null when unauthenticated or not onboarded. */
export const currentUser = query({
  args: {},
  handler: async (ctx) => {
    try {
      const user = await requireUser(ctx);
      return { ...publicUser(user), role: user.role };
    } catch {
      return null;
    }
  },
});

/** Create the app profile row for a Clerk-authenticated user. */
export const createCurrentUser = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity === null) {
      throw new ConvexError("Not authenticated");
    }

    const existing = await ctx.db
      .query("users")
      .withIndex("by_tokenIdentifier", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();
    if (existing !== null) {
      return { ...publicUser(existing), role: existing.role };
    }

    const base = baseUsernameFromIdentity(identity);
    let username = base;
    let usernameLower = username.toLowerCase();
    let suffix = 1;
    while (true) {
      const clash = await ctx.db
        .query("users")
        .withIndex("by_usernameLower", (q) => q.eq("usernameLower", usernameLower))
        .first();
      if (clash === null) break;
      suffix += 1;
      const suffixStr = String(suffix);
      const maxBaseLen = Math.max(3, 20 - suffixStr.length);
      username = `${base.slice(0, maxBaseLen)}${suffixStr}`;
      usernameLower = username.toLowerCase();
      if (suffix > 9999) {
        throw new ConvexError("Could not allocate unique username");
      }
    }

    const profile: {
      tokenIdentifier: string;
      username: string;
      usernameLower: string;
      role: "user";
      status: "active";
      lastActiveAt: number;
      name?: string;
      image?: string;
      email?: string;
    } = {
      tokenIdentifier: identity.tokenIdentifier,
      username,
      usernameLower,
      role: "user",
      status: "active",
      lastActiveAt: Date.now(),
    };
    if (identity.name !== undefined) profile.name = identity.name;
    if (identity.pictureUrl !== undefined) profile.image = identity.pictureUrl;
    if (identity.email !== undefined) profile.email = identity.email;

    const userId = await ctx.db.insert("users", profile);
    const user = await ctx.db.get(userId);
    if (user === null) {
      throw new ConvexError("Could not create profile");
    }
    return { ...publicUser(user), role: user.role };
  },
});

/** Presence heartbeat while the app is open. */
export const heartbeat = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    await ctx.db.patch(user._id, { lastActiveAt: Date.now() });
  },
});

/** Exact-username lookup used to start a new conversation. */
export const getUserByUsername = query({
  args: { username: v.string() },
  handler: async (ctx, args) => {
    const me = await requireUser(ctx);
    const lower = args.username.trim().toLowerCase();
    const user = await ctx.db
      .query("users")
      .withIndex("by_usernameLower", (q) => q.eq("usernameLower", lower))
      .first();
    if (user === null || user._id === me._id || user.status !== "active") {
      return null;
    }
    return publicUser(user);
  },
});
