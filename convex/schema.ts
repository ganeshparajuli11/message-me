import { defineSchema, defineTable } from "convex/server";
import { authTables } from "@convex-dev/auth/server";
import { v } from "convex/values";

/**
 * Schema per project spec Section 4 — field names/types are exact, do not modify.
 *
 * The only additions are the Convex Auth tables (`authTables`) and the
 * optional fields Convex Auth manages on `users` (email, phone, etc.).
 * These are required by the auth library, not an invented scope change.
 *
 * FLAGGED DEVIATION (indexes only, no field changes) — Section 4's own rule
 * ("every query must use an index, no unindexed full scans") is impossible to
 * satisfy for two spec features without two extra indexes:
 *   - messages.by_sender        → global 20-msgs/10s rate limit (Section 8)
 *   - conversationReads.by_user → listConversations for the current user
 * Field names/types are untouched. See README "Spec deviations".
 * NOTE: `email` stores the lowercase real email address used as the auth
 * account identifier by Convex Auth's Password provider.
 */
export default defineSchema({
  ...authTables,

  users: defineTable({
    // --- Spec fields (Section 4) ---
    username: v.string(),
    usernameLower: v.string(),
    role: v.union(v.literal("user"), v.literal("admin")),
    status: v.union(
      v.literal("active"),
      v.literal("banned"),
      v.literal("suspended"),
    ),
    lastActiveAt: v.optional(v.number()),
    // --- Convex Auth managed fields (all optional, library requirement) ---
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phone: v.optional(v.string()),
    phoneVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),
  })
    .index("by_usernameLower", ["usernameLower"])
    .index("email", ["email"])
    .index("phone", ["phone"]),

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
