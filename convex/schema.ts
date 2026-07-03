import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Schema per project spec Section 4 — field names/types are exact, do not modify.
 *
 * Clerk owns authentication. The app keeps profile rows for usernames, roles,
 * status, presence, and chat relationships.
 *
 * FLAGGED DEVIATION (indexes only, no field changes) — Section 4's own rule
 * ("every query must use an index, no unindexed full scans") is impossible to
 * satisfy for two spec features without two extra indexes:
 *   - messages.by_sender        → global 20-msgs/10s rate limit (Section 8)
 *   - conversationReads.by_user → listConversations for the current user
 * Field names/types are untouched. See README "Spec deviations".
 * NOTE: `tokenIdentifier` is Convex's stable Clerk identity key for auth-linked
 * lookups.
 */
export default defineSchema({
  users: defineTable({
    // --- Spec fields (Section 4) ---
    tokenIdentifier: v.string(),
    username: v.string(),
    usernameLower: v.string(),
    role: v.union(v.literal("user"), v.literal("admin")),
    status: v.union(
      v.literal("active"),
      v.literal("banned"),
      v.literal("suspended"),
    ),
    lastActiveAt: v.optional(v.number()),
    // --- Clerk profile fields mirrored for display/admin context ---
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    email: v.optional(v.string()),
  })
    .index("by_tokenIdentifier", ["tokenIdentifier"])
    .index("by_usernameLower", ["usernameLower"])
    .index("by_email", ["email"]),

  conversations: defineTable({
    participantIds: v.array(v.id("users")),
  }).index("by_participant", ["participantIds"]),

  messages: defineTable({
    conversationId: v.id("conversations"),
    senderId: v.id("users"),
    type: v.union(v.literal("text"), v.literal("image"), v.literal("voice")),
    text: v.optional(v.string()),
    imageStorageId: v.optional(v.id("_storage")),
    // Voice notes (revamp Section 8): record-then-upload, same storage flow
    // as images. voiceStorageId is a flagged addition — the audio blob needs
    // its own reference field.
    voiceStorageId: v.optional(v.id("_storage")),
    voiceDurationSeconds: v.optional(v.number()),
    status: v.union(
      v.literal("sent"),
      v.literal("delivered"),
      v.literal("read"),
    ),
    editedAt: v.optional(v.number()),
    deletedAt: v.optional(v.number()),
    // Message pin (revamp Section 5): pin is per-message, visible to both
    // participants (standard chat behavior), max 3 per conversation.
    pinnedAt: v.optional(v.number()),
    pinnedBy: v.optional(v.id("users")),
    createdAt: v.number(),
  })
    .index("by_conversation", ["conversationId"])
    .index("by_sender", ["senderId"]),

  conversationReads: defineTable({
    conversationId: v.id("conversations"),
    userId: v.id("users"),
    lastReadAt: v.number(),
  })
    .index("by_conversation_user", ["conversationId", "userId"])
    .index("by_user", ["userId"]),

  typingStatus: defineTable({
    conversationId: v.id("conversations"),
    userId: v.id("users"),
    updatedAt: v.number(),
  }).index("by_conversation", ["conversationId"]),

  blocks: defineTable({
    blockerId: v.id("users"),
    blockedId: v.id("users"),
  }).index("by_blocker", ["blockerId"]),

  friendRequests: defineTable({
    senderId: v.id("users"),
    receiverId: v.id("users"),
    status: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("declined"),
    ),
    createdAt: v.number(),
    respondedAt: v.optional(v.number()),
  })
    .index("by_receiver", ["receiverId"])
    .index("by_sender", ["senderId"])
    .index("by_pair", ["senderId", "receiverId"]),

  /**
   * Friendships are stored NORMALIZED: exactly one row per pair, with
   * userAId < userBId (sorted by id string, same convention as
   * conversations.participantIds). Query both indexes to list a user's
   * friends.
   */
  friendships: defineTable({
    userAId: v.id("users"),
    userBId: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_userA", ["userAId"])
    .index("by_userB", ["userBId"])
    .index("by_pair", ["userAId", "userBId"]),

  /**
   * "Delete for me" (revamp Section 6): rows here hide a message from one
   * user only. Separate table (not an array on messages) to keep message
   * documents small.
   */
  messageHiddenFor: defineTable({
    messageId: v.id("messages"),
    userId: v.id("users"),
  })
    .index("by_message", ["messageId"])
    .index("by_user", ["userId"]),

  /**
   * Calls (revamp Section 9). WebRTC carries the actual media peer-to-peer;
   * these tables are ONLY the signaling channel (SDP offers/answers + ICE).
   * by_caller/by_callee are flagged index additions: incoming-call
   * subscription and per-caller rate limiting need them.
   */
  calls: defineTable({
    conversationId: v.id("conversations"),
    callerId: v.id("users"),
    calleeId: v.id("users"),
    type: v.union(v.literal("voice"), v.literal("video")),
    status: v.union(
      v.literal("ringing"),
      v.literal("active"),
      v.literal("ended"),
      v.literal("declined"),
      v.literal("missed"),
    ),
    startedAt: v.number(),
    endedAt: v.optional(v.number()),
  })
    .index("by_conversation", ["conversationId"])
    .index("by_caller", ["callerId"])
    .index("by_callee", ["calleeId"]),

  callSignals: defineTable({
    callId: v.id("calls"),
    fromUserId: v.id("users"),
    type: v.union(
      v.literal("offer"),
      v.literal("answer"),
      v.literal("ice-candidate"),
    ),
    payload: v.string(), // JSON-stringified SDP/ICE data
    createdAt: v.number(),
  }).index("by_call", ["callId"]),

  reports: defineTable({
    reporterId: v.id("users"),
    reportedUserId: v.id("users"),
    reason: v.string(),
    messageSnapshot: v.optional(v.string()),
    status: v.union(v.literal("open"), v.literal("resolved")),
    createdAt: v.number(),
  }).index("by_reportedUser", ["reportedUserId"]),
});
