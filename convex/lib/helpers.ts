import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

/**
 * Shared auth helpers (spec Section 5). Every query/mutation must call one of
 * these first. Identity always derives from the authenticated session —
 * never from client-supplied arguments.
 */

export async function requireUser(
  ctx: QueryCtx | MutationCtx,
): Promise<Doc<"users">> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) {
    throw new ConvexError("Not authenticated");
  }
  const user = await ctx.db.get(userId);
  if (user === null) {
    throw new ConvexError("Not authenticated");
  }
  if (user.status === "banned") {
    throw new ConvexError("Your account has been banned");
  }
  if (user.status === "suspended") {
    throw new ConvexError("Your account is suspended");
  }
  return user;
}

export async function requireAdmin(
  ctx: QueryCtx | MutationCtx,
): Promise<Doc<"users">> {
  const user = await requireUser(ctx);
  if (user.role !== "admin") {
    throw new ConvexError("Admin access required");
  }
  return user;
}

/** True if `a` blocked `b` OR `b` blocked `a`. Indexed via by_blocker. */
export async function isBlockedEitherDirection(
  ctx: QueryCtx | MutationCtx,
  a: Id<"users">,
  b: Id<"users">,
): Promise<boolean> {
  const [aBlocks, bBlocks] = await Promise.all([
    ctx.db
      .query("blocks")
      .withIndex("by_blocker", (q) => q.eq("blockerId", a))
      .collect(),
    ctx.db
      .query("blocks")
      .withIndex("by_blocker", (q) => q.eq("blockerId", b))
      .collect(),
  ]);
  return (
    aBlocks.some((x) => x.blockedId === b) ||
    bBlocks.some((x) => x.blockedId === a)
  );
}

/** Throws unless the user is a participant of the conversation. */
export async function requireParticipant(
  ctx: QueryCtx | MutationCtx,
  conversationId: Id<"conversations">,
  userId: Id<"users">,
): Promise<Doc<"conversations">> {
  const conversation = await ctx.db.get(conversationId);
  if (conversation === null) {
    throw new ConvexError("Conversation not found");
  }
  if (!conversation.participantIds.some((id) => id === userId)) {
    throw new ConvexError("Not a participant of this conversation");
  }
  return conversation;
}

export function otherParticipantId(
  conversation: Doc<"conversations">,
  me: Id<"users">,
): Id<"users"> {
  const other = conversation.participantIds.find((id) => id !== me);
  if (other === undefined) {
    throw new ConvexError("Malformed conversation");
  }
  return other;
}

/** Public, non-sensitive user projection sent to clients. */
export function publicUser(user: Doc<"users">) {
  return {
    _id: user._id,
    username: user.username,
    status: user.status,
    lastActiveAt: user.lastActiveAt ?? null,
  };
}
