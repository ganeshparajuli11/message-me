import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  isBlockedEitherDirection,
  otherParticipantId,
  publicUser,
  requireParticipant,
  requireUser,
} from "./lib/helpers";

/**
 * createConversation(otherUserId) — checks blocks both directions and reuses
 * an existing 1:1 conversation between the two users. (Spec Section 5.)
 *
 * Membership rows: a conversationReads row (lastReadAt: 0) is upserted for
 * BOTH participants at creation. These rows double as the indexed membership
 * list that listConversations walks (via by_user).
 */
export const createConversation = mutation({
  args: { otherUserId: v.id("users") },
  handler: async (ctx, args) => {
    const me = await requireUser(ctx);
    if (args.otherUserId === me._id) {
      throw new ConvexError("Cannot start a conversation with yourself");
    }
    const other = await ctx.db.get(args.otherUserId);
    if (other === null || other.status !== "active") {
      throw new ConvexError("User not found");
    }
    if (await isBlockedEitherDirection(ctx, me._id, args.otherUserId)) {
      throw new ConvexError("You cannot message this user");
    }

    // participantIds are always stored sorted so the array-equality index
    // lookup is deterministic — this is how duplicates are prevented.
    const participantIds = [me._id, args.otherUserId].sort();
    const existing = await ctx.db
      .query("conversations")
      .withIndex("by_participant", (q) =>
        q.eq("participantIds", participantIds),
      )
      .first();
    if (existing !== null) {
      return existing._id;
    }

    const conversationId = await ctx.db.insert("conversations", {
      participantIds,
    });
    for (const userId of participantIds) {
      await ctx.db.insert("conversationReads", {
        conversationId,
        userId,
        lastReadAt: 0,
      });
    }
    return conversationId;
  },
});

/**
 * listConversations() — current user's conversations with the other
 * participant, last message preview and unread count derived from
 * conversationReads vs message createdAt. (Spec Section 5.)
 */
export const listConversations = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireUser(ctx);

    const myReads = await ctx.db
      .query("conversationReads")
      .withIndex("by_user", (q) => q.eq("userId", me._id))
      .collect();

    const result = [];
    for (const read of myReads) {
      const conversation = await ctx.db.get(read.conversationId);
      if (
        conversation === null ||
        !conversation.participantIds.some((id) => id === me._id)
      ) {
        continue;
      }
      const otherId = otherParticipantId(conversation, me._id);
      const other = await ctx.db.get(otherId);
      if (other === null) continue;

      const lastMessage = await ctx.db
        .query("messages")
        .withIndex("by_conversation", (q) =>
          q.eq("conversationId", conversation._id),
        )
        .order("desc")
        .first();

      // Unread = other user's messages newer than my lastReadAt (bounded scan
      // over the newest messages via the by_conversation index).
      const recent = await ctx.db
        .query("messages")
        .withIndex("by_conversation", (q) =>
          q.eq("conversationId", conversation._id),
        )
        .order("desc")
        .take(50);
      const unreadCount = recent.filter(
        (m) =>
          m.senderId !== me._id &&
          m.deletedAt === undefined &&
          m.createdAt > read.lastReadAt,
      ).length;

      result.push({
        _id: conversation._id,
        other: publicUser(other),
        lastMessage: lastMessage
          ? {
              type: lastMessage.type,
              text:
                lastMessage.deletedAt !== undefined
                  ? null
                  : (lastMessage.text ?? null),
              deleted: lastMessage.deletedAt !== undefined,
              mine: lastMessage.senderId === me._id,
              createdAt: lastMessage.createdAt,
            }
          : null,
        unreadCount,
      });
    }

    result.sort(
      (a, b) =>
        (b.lastMessage?.createdAt ?? 0) - (a.lastMessage?.createdAt ?? 0),
    );
    return result;
  },
});

/**
 * Chat-window header data: other participant (presence), their lastReadAt
 * (drives read ticks per Section 6) and block state. UI helper for the
 * screens in Section 7 — no new scope.
 */
export const getConversation = query({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    const me = await requireUser(ctx);
    const conversation = await requireParticipant(
      ctx,
      args.conversationId,
      me._id,
    );
    const otherId = otherParticipantId(conversation, me._id);
    const other = await ctx.db.get(otherId);
    if (other === null) throw new ConvexError("User not found");

    const otherRead = await ctx.db
      .query("conversationReads")
      .withIndex("by_conversation_user", (q) =>
        q.eq("conversationId", conversation._id).eq("userId", otherId),
      )
      .first();

    const myBlocks = await ctx.db
      .query("blocks")
      .withIndex("by_blocker", (q) => q.eq("blockerId", me._id))
      .collect();
    const theirBlocks = await ctx.db
      .query("blocks")
      .withIndex("by_blocker", (q) => q.eq("blockerId", otherId))
      .collect();

    return {
      _id: conversation._id,
      other: publicUser(other),
      otherLastReadAt: otherRead?.lastReadAt ?? 0,
      iBlockedThem: myBlocks.some((b) => b.blockedId === otherId),
      theyBlockedMe: theirBlocks.some((b) => b.blockedId === me._id),
    };
  },
});
