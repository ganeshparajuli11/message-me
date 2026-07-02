import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { publicUser, requireUser } from "./lib/helpers";
import { USERNAME_MAX, validateUsernameFormat } from "./lib/validation";

const SUGGESTION_WORD_POOL = [
  "sky",
  "ink",
  "moss",
  "clay",
  "note",
  "echo",
  "wren",
  "fern",
];

/**
 * Live username availability check + deterministic suggestions (no AI call).
 * Suggestions: number suffixes, underscore variants, word-prefix pool —
 * checked against the DB via by_usernameLower, capped at 4. (Spec Section 5.)
 *
 * Public query (runs pre-auth during signup) — returns no user data, only
 * availability booleans.
 */
export const checkUsernameAndSuggest = query({
  args: { username: v.string() },
  handler: async (ctx, args) => {
    const username = args.username.trim();
    const format = validateUsernameFormat(username);
    if (!format.valid) {
      return {
        valid: false,
        available: false,
        error: format.error,
        suggestions: [] as string[],
      };
    }
    const lower = username.toLowerCase();

    const isTaken = async (candidateLower: string) => {
      const existing = await ctx.db
        .query("users")
        .withIndex("by_usernameLower", (q) =>
          q.eq("usernameLower", candidateLower),
        )
        .first();
      return existing !== null;
    };

    const available = !(await isTaken(lower));
    if (available) {
      return { valid: true, available: true, suggestions: [] as string[] };
    }

    // Deterministic candidate generation, then DB-checked, capped at 4.
    const candidates: string[] = [];
    for (const n of [1, 2, 7, 9, 42, 99]) {
      candidates.push(`${username}${n}`);
    }
    candidates.push(`${username}_`, `_${username}`, `${username}_1`);
    for (const w of SUGGESTION_WORD_POOL) {
      candidates.push(`${w}_${username}`, `${username}_${w}`);
    }

    const suggestions: string[] = [];
    for (const c of candidates) {
      if (suggestions.length >= 4) break;
      if (c.length > USERNAME_MAX) continue;
      if (!validateUsernameFormat(c).valid) continue;
      if (!(await isTaken(c.toLowerCase()))) {
        suggestions.push(c);
      }
    }
    return { valid: true, available: false, suggestions };
  },
});

/** Current signed-in user (or null) — used by the app shell. */
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

/**
 * Presence heartbeat — client pings every ~30s while the app is open.
 * Online = lastActiveAt within PRESENCE_ONLINE_WINDOW_MS; otherwise the
 * timestamp doubles as "last seen".
 */
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

/**
 * Resolve a login identifier (username or email) to the auth email identifier
 * used by Convex Auth's Password provider.
 */
export const resolveLoginEmail = query({
  args: { identifier: v.string() },
  handler: async (ctx, args) => {
    const raw = args.identifier.trim().toLowerCase();
    if (raw.length === 0) return null;
    if (raw.includes("@")) return raw;

    const user = await ctx.db
      .query("users")
      .withIndex("by_usernameLower", (q) => q.eq("usernameLower", raw))
      .first();
    if (user === null) return null;
    return user.email ?? null;
  },
});
