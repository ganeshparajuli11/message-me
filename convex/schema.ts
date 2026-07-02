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
    type: v.union(v.literal("text"), v.literal("image")),
    text: v.optional(v.string()),
    imageStorageId: v.optional(v.id("_storage")),
    status: v.union(
      v.literal("sent"),
      v.literal("delivered"),
      v.literal("read"),
    ),
    editedAt: v.optional(v.number()),
    deletedAt: v.optional(v.number()),
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

  reports: defineTable({
    reporterId: v.id("users"),
    reportedUserId: v.id("users"),
    reason: v.string(),
    messageSnapshot: v.optional(v.string()),
    status: v.union(v.literal("open"), v.literal("resolved")),
    createdAt: v.number(),
  }).index("by_reportedUser", ["reportedUserId"]),
});
