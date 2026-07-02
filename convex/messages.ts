import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  isBlockedEitherDirection,
  otherParticipantId,
  requireParticipant,
  requireUser,
} from "./lib/helpers";
import {
  IMAGE_ALLOWED_TYPES,
  IMAGE_MAX_BYTES,
  MESSAGE_MAX_LENGTH,
  SEND_RATE_LIMIT_COUNT,
  SEND_RATE_LIMIT_WINDOW_MS,
} from "./lib/validation";

/**
 * sendMessage — validates participant + not blocked, enforces message length
 * cap, image size/type caps and the 20-msgs/10s per-user rate limit, all
 * server-side. Inserts with status "sent". (Spec Sections 5, 8.)
 */
export const sendMessage = mutation({
  args: {
    conversationId: v.id("conversations"),
    type: v.union(v.literal("text"), v.literal("image")),
    text: v.optional(v.string()),
    imageStorageId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, args) => {
    const me = await requireUser(ctx);
    const conversation = await requireParticipant(
      ctx,
      args.conversationId,
      me._id,
    );
    const otherId = otherParticipantId(conversation, me._id);
    if (await isBlockedEitherDirection(ctx, me._id, otherId)) {
      throw new ConvexError("You cannot message this user");
    }

    // Content validation.
    if (args.type === "text") {
      const text = args.text?.trim();
      if (!text) throw new ConvexError("Message is empty");
      if (text.length > MESSAGE_MAX_LENGTH) {
        throw new ConvexError(
          `Message too long (max ${MESSAGE_MAX_LENGTH} characters)`,
        );
      }
    } else {
      if (args.imageStorageId === undefined) {
        throw new ConvexError("Missing image");
      }
      const meta = await ctx.db.system.get(args.imageStorageId);
      if (meta === null) throw new ConvexError("Image not found");
      if (meta.size > IMAGE_MAX_BYTES) {
        throw new ConvexError("Image too large (max 5 MB)");
      }
      if (
        meta.contentType === undefined ||
        !IMAGE_ALLOWED_TYPES.includes(meta.contentType)
      ) {
        throw new ConvexError("Unsupported image type");
      }
    }

    // Rate limit: reject if >20 messages in the last 10s from this user
    // (global across conversations, via by_sender index).
    const now = Date.now();
    const recentBySender = await ctx.db
      .query("messages")
      .withIndex("by_sender", (q) => q.eq("senderId", me._id))
      .order("desc")
      .take(SEND_RATE_LIMIT_COUNT);
    if (
      recentBySender.length >= SEND_RATE_LIMIT_COUNT &&
      recentBySender[SEND_RATE_LIMIT_COUNT - 1].createdAt >
        now - SEND_RATE_LIMIT_WINDOW_MS
    ) {
      throw new ConvexError("You're sending messages too quickly — slow down");
    }

    return await ctx.db.insert("messages", {
      conversationId: args.conversationId,
      senderId: me._id,
      type: args.type,
      text: args.type === "text" ? args.text?.trim() : undefined,
      imageStorageId: args.type === "image" ? args.imageStorageId : undefined,
      status: "sent",
      createdAt: now,
    });
  },
});

/**
 * getMessages — paginated, newest-first off by_conversation, consumed with
 * usePaginatedQuery for infinite scroll. (Spec Section 5.)
 * Soft-deleted messages return a tombstone (no content). Image messages
 * include a serving URL.
 */
export const getMessages = query({
  args: {
    conversationId: v.id("conversations"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const me = await requireUser(ctx);
    await requireParticipant(ctx, args.conversationId, me._id);

    const page = await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", args.conversationId),
      )
      .order("desc")
      .paginate(args.paginationOpts);

    return {
      ...page,
      page: await Promise.all(
        page.page.map(async (m) => {
          const deleted = m.deletedAt !== undefined;
          return {
            _id: m._id,
            senderId: m.senderId,
            type: m.type,
            text: deleted ? null : (m.text ?? null),
            imageUrl:
              !deleted && m.type === "image" && m.imageStorageId !== undefined
                ? await ctx.storage.getUrl(m.imageStorageId)
                : null,
            status: m.status,
            editedAt: m.editedAt ?? null,
            deleted,
            createdAt: m.createdAt,
          };
        }),
      ),
    };
  },
});

/** markRead — upserts the caller's conversationReads row. (Spec Section 5.) */
export const markRead = mutation({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    const me = await requireUser(ctx);
    await requireParticipant(ctx, args.conversationId, me._id);
    const existing = await ctx.db
      .query("conversationReads")
      .withIndex("by_conversation_user", (q) =>
        q.eq("conversationId", args.conversationId).eq("userId", me._id),
      )
      .first();
    const now = Date.now();
    if (existing !== null) {
      await ctx.db.patch(existing._id, { lastReadAt: now });
    } else {
      await ctx.db.insert("conversationReads", {
        conversationId: args.conversationId,
        userId: me._id,
        lastReadAt: now,
      });
    }
  },
});

/** editMessage — only the sender may edit; sets editedAt. (Spec Section 5.) */
export const editMessage = mutation({
  args: { messageId: v.id("messages"), newText: v.string() },
  handler: async (ctx, args) => {
    const me = await requireUser(ctx);
    const message = await ctx.db.get(args.messageId);
    if (message === null || message.deletedAt !== undefined) {
      throw new ConvexError("Message not found");
    }
    if (message.senderId !== me._id) {
      throw new ConvexError("You can only edit your own messages");
    }
    if (message.type !== "text") {
      throw new ConvexError("Only text messages can be edited");
    }
    const text = args.newText.trim();
    if (!text) throw new ConvexError("Message is empty");
    if (text.length > MESSAGE_MAX_LENGTH) {
      throw new ConvexError(
        `Message too long (max ${MESSAGE_MAX_LENGTH} characters)`,
      );
    }
    await ctx.db.patch(args.messageId, { text, editedAt: Date.now() });
  },
});

/** deleteMessage — soft delete, only the sender may call. (Spec Section 5.) */
export const deleteMessage = mutation({
  args: { messageId: v.id("messages") },
  handler: async (ctx, args) => {
    const me = await requireUser(ctx);
    const message = await ctx.db.get(args.messageId);
    if (message === null) throw new ConvexError("Message not found");
    if (message.senderId !== me._id) {
      throw new ConvexError("You can only delete your own messages");
    }
    await ctx.db.patch(args.messageId, { deletedAt: Date.now() });
  },
});

/**
 * Image upload URL (Convex file storage). Implied infrastructure for
 * "Images: upload, send, view" (Sections 2, 10). Size/type caps are enforced
 * in sendMessage before the file is ever attached to a message.
 */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});
