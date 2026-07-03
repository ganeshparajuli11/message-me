import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import {
  areFriends,
  isBlockedEitherDirection,
  publicUser,
  requireUser,
  sortedPair,
} from "./lib/helpers";
import {
  FRIEND_REQUEST_LIMIT_COUNT,
  FRIEND_REQUEST_LIMIT_WINDOW_MS,
} from "./lib/validation";

/**
 * Friend request system (revamp Section 2).
 *
 * Documented decisions (flagged per Section 10):
 * - Friendships are one normalized row per pair (userAId < userBId).
 * - Sending a request to someone whose request is already pending for you
 *   auto-accepts it (standard chat-app behavior).
 * - unfriend() KEEPS conversation history but blocks new messages until
 *   re-friended (sendMessage + createConversation both check friendship).
 *   It also clears the pair's friendRequests rows so a fresh request works.
 * - Rate limit: max 15 friend requests per sender per 10 minutes.
 */

async function pendingRequestBetween(
  ctx: QueryCtx | MutationCtx,
  senderId: Id<"users">,
  receiverId: Id<"users">,
): Promise<Doc<"friendRequests"> | null> {
  const row = await ctx.db
    .query("friendRequests")
    .withIndex("by_pair", (q) =>
      q.eq("senderId", senderId).eq("receiverId", receiverId),
    )
    .first();
  return row !== null && row.status === "pending" ? row : null;
}

async function createFriendship(
  ctx: MutationCtx,
  a: Id<"users">,
  b: Id<"users">,
) {
  const [userAId, userBId] = sortedPair(a, b);
  const existing = await ctx.db
    .query("friendships")
    .withIndex("by_pair", (q) => q.eq("userAId", userAId).eq("userBId", userBId))
    .first();
  if (existing === null) {
    await ctx.db.insert("friendships", {
      userAId,
      userBId,
      createdAt: Date.now(),
    });
  }
}

/**
 * Username prefix search for "Find Friends". Excludes self and anyone with a
 * block in either direction; annotates relationship state so the UI can show
 * "Add friend" / "Requested" / "Accept" / "Friends".
 */
export const searchUsers = query({
  args: { query: v.string() },
  handler: async (ctx, args) => {
    const me = await requireUser(ctx);
    const q = args.query.trim().toLowerCase();
    if (q.length < 2) return [];

    const matches = await ctx.db
      .query("users")
      .withIndex("by_usernameLower", (idx) =>
        idx.gte("usernameLower", q).lt("usernameLower", q + "￿"),
      )
      .take(15);

    const results = [];
    for (const user of matches) {
      if (user._id === me._id || user.status !== "active") continue;
      if (await isBlockedEitherDirection(ctx, me._id, user._id)) continue;

      let state: "none" | "friends" | "outgoing" | "incoming" = "none";
      if (await areFriends(ctx, me._id, user._id)) {
        state = "friends";
      } else if (await pendingRequestBetween(ctx, me._id, user._id)) {
        state = "outgoing";
      } else if (await pendingRequestBetween(ctx, user._id, me._id)) {
        state = "incoming";
      }
      results.push({ ...publicUser(user), state });
      if (results.length >= 10) break;
    }
    return results;
  },
});

export const sendFriendRequest = mutation({
  args: { receiverId: v.id("users") },
  handler: async (ctx, args) => {
    const me = await requireUser(ctx);
    if (args.receiverId === me._id) {
      throw new ConvexError("You cannot friend yourself");
    }
    const receiver = await ctx.db.get(args.receiverId);
    if (receiver === null || receiver.status !== "active") {
      throw new ConvexError("User not found");
    }
    if (await isBlockedEitherDirection(ctx, me._id, args.receiverId)) {
      throw new ConvexError("You cannot send a request to this user");
    }
    if (await areFriends(ctx, me._id, args.receiverId)) {
      throw new ConvexError("You are already friends");
    }

    // Rate limit: max 15 requests per 10 minutes per sender (Section 10).
    const now = Date.now();
    const recent = await ctx.db
      .query("friendRequests")
      .withIndex("by_sender", (q) => q.eq("senderId", me._id))
      .order("desc")
      .take(FRIEND_REQUEST_LIMIT_COUNT);
    if (
      recent.length >= FRIEND_REQUEST_LIMIT_COUNT &&
      recent[FRIEND_REQUEST_LIMIT_COUNT - 1].createdAt >
        now - FRIEND_REQUEST_LIMIT_WINDOW_MS
    ) {
      throw new ConvexError("Too many friend requests — try again later");
    }

    // If they already sent me a pending request, accept it instead.
    const theirPending = await pendingRequestBetween(ctx, args.receiverId, me._id);
    if (theirPending !== null) {
      await ctx.db.patch(theirPending._id, {
        status: "accepted",
        respondedAt: now,
      });
      await createFriendship(ctx, me._id, args.receiverId);
      return { autoAccepted: true };
    }

    if (await pendingRequestBetween(ctx, me._id, args.receiverId)) {
      throw new ConvexError("Request already sent");
    }

    // Reuse a previously declined/accepted row for this pair if one exists.
    const previous = await ctx.db
      .query("friendRequests")
      .withIndex("by_pair", (q) =>
        q.eq("senderId", me._id).eq("receiverId", args.receiverId),
      )
      .first();
    if (previous !== null) {
      await ctx.db.patch(previous._id, {
        status: "pending",
        createdAt: now,
        respondedAt: undefined,
      });
    } else {
      await ctx.db.insert("friendRequests", {
        senderId: me._id,
        receiverId: args.receiverId,
        status: "pending",
        createdAt: now,
      });
    }
    return { autoAccepted: false };
  },
});

export const respondToFriendRequest = mutation({
  args: { requestId: v.id("friendRequests"), accept: v.boolean() },
  handler: async (ctx, args) => {
    const me = await requireUser(ctx);
    const request = await ctx.db.get(args.requestId);
    if (request === null || request.receiverId !== me._id) {
      throw new ConvexError("Request not found");
    }
    if (request.status !== "pending") {
      throw new ConvexError("Request already handled");
    }
    await ctx.db.patch(args.requestId, {
      status: args.accept ? "accepted" : "declined",
      respondedAt: Date.now(),
    });
    if (args.accept) {
      await createFriendship(ctx, request.senderId, request.receiverId);
    }
  },
});

export const listFriendRequests = query({
  args: {
    direction: v.union(v.literal("incoming"), v.literal("outgoing")),
  },
  handler: async (ctx, args) => {
    const me = await requireUser(ctx);
    const rows =
      args.direction === "incoming"
        ? await ctx.db
            .query("friendRequests")
            .withIndex("by_receiver", (q) => q.eq("receiverId", me._id))
            .order("desc")
            .take(100)
        : await ctx.db
            .query("friendRequests")
            .withIndex("by_sender", (q) => q.eq("senderId", me._id))
            .order("desc")
            .take(100);

    const pending = rows.filter((r) => r.status === "pending");
    const result = [];
    for (const r of pending) {
      const otherId = args.direction === "incoming" ? r.senderId : r.receiverId;
      const other = await ctx.db.get(otherId);
      if (other === null || other.status !== "active") continue;
      result.push({
        _id: r._id,
        other: publicUser(other),
        createdAt: r.createdAt,
      });
    }
    return result;
  },
});

export const listFriends = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireUser(ctx);
    const [asA, asB] = await Promise.all([
      ctx.db
        .query("friendships")
        .withIndex("by_userA", (q) => q.eq("userAId", me._id))
        .collect(),
      ctx.db
        .query("friendships")
        .withIndex("by_userB", (q) => q.eq("userBId", me._id))
        .collect(),
    ]);
    const result = [];
    for (const f of [...asA, ...asB]) {
      const otherId = f.userAId === me._id ? f.userBId : f.userAId;
      const other = await ctx.db.get(otherId);
      if (other === null) continue;
      result.push({ ...publicUser(other), since: f.createdAt });
    }
    result.sort((a, b) => a.username.localeCompare(b.username));
    return result;
  },
});

/**
 * Removes the friendship. DOCUMENTED DECISION: conversation history is kept;
 * new messages are blocked until re-friended (enforced server-side in
 * sendMessage and createConversation). The pair's friendRequests rows are
 * deleted so either side can send a fresh request later.
 */
export const unfriend = mutation({
  args: { friendUserId: v.id("users") },
  handler: async (ctx, args) => {
    const me = await requireUser(ctx);
    const [userAId, userBId] = sortedPair(me._id, args.friendUserId);
    const row = await ctx.db
      .query("friendships")
      .withIndex("by_pair", (q) =>
        q.eq("userAId", userAId).eq("userBId", userBId),
      )
      .first();
    if (row !== null) {
      await ctx.db.delete(row._id);
    }
    for (const [s, r] of [
      [me._id, args.friendUserId],
      [args.friendUserId, me._id],
    ] as const) {
      const reqs = await ctx.db
        .query("friendRequests")
        .withIndex("by_pair", (q) => q.eq("senderId", s).eq("receiverId", r))
        .collect();
      for (const req of reqs) {
        await ctx.db.delete(req._id);
      }
    }
  },
});
