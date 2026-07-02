import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";
import type { DataModel, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { validateUsernameFormat } from "./lib/validation";

function normalizeEmail(input: unknown): string {
  return String(input ?? "").trim().toLowerCase();
}

function isLikelyEmail(input: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input);
}

function fallbackUsernameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "";
  const cleaned = local.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 20);
  return cleaned.length > 0 ? cleaned : "user";
}

/**
 * Username + password auth via Convex Auth (self-hosted friendly, no vendor).
 *
 * Spec mapping: the spec's `createUser(username, ...authFields)` mutation is
 * implemented by this provider's sign-up flow:
 *  - `profile()` re-validates the username format server-side.
 *  - Convex Auth's `createAccount` runs inside a single Convex mutation
 *    (transaction) keyed on the lowercase username as the account id, which is
 *    the final race-condition guard against duplicate usernames.
 *  - `afterUserCreatedOrUpdated` re-checks uniqueness against the
 *    `by_usernameLower` index inside the same transaction (defense in depth)
 *    and would abort the transaction by throwing.
 *
 * Convex Auth's Password provider uses `profile.email` as the account
 * identifier. We store the user's real lowercase email there.
 */
const UsernamePassword = Password<DataModel>({
  profile(params) {
    const flow = String(params.flow ?? "");
    const isSignUp = flow === "signUp";

    const name = String(params.name ?? "").trim();
    if (isSignUp && name.length < 1) {
      throw new ConvexError("Name is required");
    }

    const email = normalizeEmail(params.email);
    if (!isLikelyEmail(email)) {
      throw new ConvexError("Invalid email address");
    }

    const providedUsername = String(params.username ?? "").trim();
    const username =
      providedUsername.length > 0
        ? providedUsername
        : fallbackUsernameFromEmail(email);

    if (isSignUp) {
      const check = validateUsernameFormat(username);
      if (!check.valid) {
        throw new ConvexError(`Invalid username: ${check.error}`);
      }
    }

    const usernameLower = username.toLowerCase();
    return {
      email,
      name: name.length > 0 ? name : undefined,
      username,
      usernameLower,
      role: "user" as const,
      status: "active" as const,
    };
  },
});

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [UsernamePassword],
  callbacks: {
    async afterUserCreatedOrUpdated(genericCtx, { userId }) {
      // Convex Auth types its callback ctx against its own generic data
      // model; cast to this app's typed ctx (same runtime object).
      const ctx = genericCtx as unknown as MutationCtx;
      const user = await ctx.db.get(userId as Id<"users">);
      if (user === null) return;
      // Transactional uniqueness guard on usernameLower.
      const clashes = await ctx.db
        .query("users")
        .withIndex("by_usernameLower", (q) =>
          q.eq("usernameLower", user.usernameLower),
        )
        .collect();
      if (clashes.some((u) => u._id !== userId)) {
        throw new ConvexError("Username is already taken");
      }
    },
  },
});
