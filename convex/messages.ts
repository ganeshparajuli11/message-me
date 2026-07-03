import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  areFriends,
  isBlockedEitherDirection,
  otherParticipantId,
  requireParticipant,
  requireUser,
} from "./lib/helpers";
import {
  IMAGE_ALLOWED_TYPES,
  IMAGE_MAX_BYTES,
  VOICE_ALLOWED_TYPES,
  VOICE_MAX_BYTES,
  VOICE_MAX_DURATION_S,
  MAX_PINNED_PER_CONVERSATION,
  MESSAGE_MAX_LENGTH,
  PIN_SCAN_LIMIT,
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
    type: v.union(v.literal("text"), v.literal("image"), v.literal("voice")),
    text: v.optional(v.string()),
    imageStorageId: v.optional(v.id("_storage")),
    voiceStorageId: v.optional(v.id("_storage")),
    voiceDurationSeconds: v.optional(v.number()),
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
    // Friend gate (revamp Section 2): unfriending keeps history but blocks
    // new messages until re-friended — enforced here, not just in the UI.
    if (!(await areFriends(ctx, me._id, otherId))) {
      throw new ConvexError("You can only message friends");
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
    } else if (args.type === "image") {
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
    } else {
      // Voice note (revamp Section 8) — server-side caps like images.
      if (args.voiceStorageId === undefined) {
        throw new ConvexError("Missing voice recording");
      }
      const meta = await ctx.db.system.get(args.voiceStorageId);
      if (meta === null) throw new ConvexError("Recording not found");
      if (meta.size > VOICE_MAX_BYTES) {
        throw new ConvexError("Voice note too large (max 10 MB)");
      }
      if (
        meta.contentType === undefined ||
        !VOICE_ALLOWED_TYPES.includes(meta.contentType)
      ) {
        throw new ConvexError("Unsupported audio format");
      }
      if (
        args.voiceDurationSeconds === undefined ||
        args.voiceDurationSeconds <= 0 ||
        args.voiceDurationSeconds > VOICE_MAX_DURATION_S
      ) {
        throw new ConvexError("Voice notes can be up to 5 minutes");
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
      voiceStorageId: args.type === "voice" ? args.voiceStorageId : undefined,
      voiceDurationSeconds:
        args.type === "voice"
          ? Math.round(args.voiceDurationSeconds ?? 0)
          : undefined,
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

    // "Delete for me": drop messages hidden for the caller (indexed point
    // lookups per message in the page — revamp Section 6).
    const visible = [];
    for (const m of page.page) {
      const hiddenRows = await ctx.db
        .query("messageHiddenFor")
        .withIndex("by_message", (q) => q.eq("messageId", m._id))
        .collect();
      if (!hiddenRows.some((h) => h.userId === me._id)) visible.push(m);
    }

    return {
      ...page,
      page: await Promise.all(
        visible.map(async (m) => {
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
            voiceUrl:
              !deleted && m.type === "voice" && m.voiceStorageId !== undefined
                ? await ctx.storage.getUrl(m.voiceStorageId)
                : null,
            voiceDurationSeconds: m.voiceDurationSeconds ?? null,
            status: m.status,
            editedAt: m.editedAt ?? null,
            deleted,
            pinnedAt: m.pinnedAt ?? null,
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

/**
 * "Delete for everyone" — soft delete (existing deletedAt pattern), only the
 * sender may call. Rendered as a tombstone for both participants.
 * (Spec Section 5 soft delete + revamp Section 6.)
 */
export const deleteMessageForEveryone = mutation({
  args: { messageId: v.id("messages") },
  handler: async (ctx, args) => {
    const me = await requireUser(ctx);
    const message = await ctx.db.get(args.messageId);
    if (message === null) throw new ConvexError("Message not found");
    if (message.senderId !== me._id) {
      throw new ConvexError("You can only delete your own messages");
    }
    await ctx.db.patch(args.messageId, {
      deletedAt: Date.now(),
      // A deleted message cannot stay pinned.
      pinnedAt: undefined,
      pinnedBy: undefined,
    });
  },
});

/**
 * "Delete for me" — either participant may hide any message from their own
 * view only. (Revamp Section 6.)
 */
export const deleteMessageForMe = mutation({
  args: { messageId: v.id("messages") },
  handler: async (ctx, args) => {
    const me = await requireUser(ctx);
    const message = await ctx.db.get(args.messageId);
    if (message === null) throw new ConvexError("Message not found");
    await requireParticipant(ctx, message.conversationId, me._id);
    const existing = await ctx.db
      .query("messageHiddenFor")
      .withIndex("by_message", (q) => q.eq("messageId", args.messageId))
      .collect();
    if (existing.some((h) => h.userId === me._id)) return;
    await ctx.db.insert("messageHiddenFor", {
      messageId: args.messageId,
      userId: me._id,
    });
  },
});

/**
 * Pin a message for both participants (revamp Section 5). Max 3 pinned per
 * conversation — rejected with a clear error, never silently overwritten.
 * Pin counting scans the newest PIN_SCAN_LIMIT messages of the conversation
 * via by_conversation (bounded, indexed).
 */
export const pinMessage = mutation({
  args: { messageId: v.id("messages") },
  handler: async (ctx, args) => {
    const me = await requireUser(ctx);
    const message = await ctx.db.get(args.messageId);
    if (message === null || message.deletedAt !== undefined) {
      throw new ConvexError("Message not found");
    }
    await requireParticipant(ctx, message.conversationId, me._id);
    if (message.pinnedAt !== undefined) return;

    const recent = await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", message.conversationId),
      )
      .order("desc")
      .take(PIN_SCAN_LIMIT);
    const pinnedCount = recent.filter((m) => m.pinnedAt !== undefined).length;
    if (pinnedCount >= MAX_PINNED_PER_CONVERSATION) {
      throw new ConvexError(
        `You can pin at most ${MAX_PINNED_PER_CONVERSATION} messages — unpin one first`,
      );
    }
    await ctx.db.patch(args.messageId, {
      pinnedAt: Date.now(),
      pinnedBy: me._id,
    });
  },
});

/** Unpin — either participant may unpin. (Revamp Section 5.) */
export const unpinMessage = mutation({
  args: { messageId: v.id("messages") },
  handler: async (ctx, args) => {
    const me = await requireUser(ctx);
    const message = await ctx.db.get(args.messageId);
    if (message === null) throw new ConvexError("Message not found");
    await requireParticipant(ctx, message.conversationId, me._id);
    await ctx.db.patch(args.messageId, {
      pinnedAt: undefined,
      pinnedBy: undefined,
    });
  },
});

/**
 * Pinned messages for the pinned bar. Bounded indexed scan (newest
 * PIN_SCAN_LIMIT) — pins older than that window simply age out of the bar.
 */
export const listPinnedMessages = query({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    const me = await requireUser(ctx);
    await requireParticipant(ctx, args.conversationId, me._id);
    const recent = await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", args.conversationId),
      )
      .order("desc")
      .take(PIN_SCAN_LIMIT);
    return recent
      .filter((m) => m.pinnedAt !== undefined && m.deletedAt === undefined)
      .sort((a, b) => (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0))
      .map((m) => ({
        _id: m._id,
        type: m.type,
        text: m.text ?? null,
        senderId: m.senderId,
        createdAt: m.createdAt,
        pinnedAt: m.pinnedAt ?? 0,
      }));
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
