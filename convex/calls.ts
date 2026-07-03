import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import {
  areFriends,
  isBlockedEitherDirection,
  otherParticipantId,
  publicUser,
  requireParticipant,
  requireUser,
} from "./lib/helpers";
import {
  CALL_RATE_LIMIT_COUNT,
  CALL_RATE_LIMIT_WINDOW_MS,
  RING_TIMEOUT_MS,
  SIGNAL_PAYLOAD_MAX_BYTES,
} from "./lib/validation";

/**
 * Voice/video calls (revamp Section 9).
 *
 * Convex is ONLY the signaling channel: it relays SDP offers/answers and ICE
 * candidates between the two peers. The audio/video/screen-share media never
 * touches Convex — it flows peer-to-peer over WebRTC (STUN, or the buyer's
 * self-hosted coturn TURN relay — see deploy/coturn/).
 */

async function requireCallParticipant(
  ctx: QueryCtx | MutationCtx,
  call: Doc<"calls"> | null,
  userId: Doc<"users">["_id"],
): Promise<Doc<"calls">> {
  if (call === null) throw new ConvexError("Call not found");
  if (call.callerId !== userId && call.calleeId !== userId) {
    throw new ConvexError("Not a participant of this call");
  }
  return call;
}

function isLive(call: Doc<"calls">, now: number): boolean {
  if (call.status === "active") return true;
  return call.status === "ringing" && call.startedAt > now - RING_TIMEOUT_MS;
}

/** Start a call. Friend + block gates match messaging. */
export const initiateCall = mutation({
  args: {
    conversationId: v.id("conversations"),
    type: v.union(v.literal("voice"), v.literal("video")),
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
      throw new ConvexError("You cannot call this user");
    }
    if (!(await areFriends(ctx, me._id, otherId))) {
      throw new ConvexError("You can only call friends");
    }

    const now = Date.now();

    // One live call per conversation.
    const recentHere = await ctx.db
      .query("calls")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", args.conversationId),
      )
      .order("desc")
      .take(3);
    if (recentHere.some((c) => isLive(c, now))) {
      throw new ConvexError("A call is already in progress");
    }

    // Rate limit: 10 initiated calls per caller per 10 minutes.
    const recentMine = await ctx.db
      .query("calls")
      .withIndex("by_caller", (q) => q.eq("callerId", me._id))
      .order("desc")
      .take(CALL_RATE_LIMIT_COUNT);
    if (
      recentMine.length >= CALL_RATE_LIMIT_COUNT &&
      recentMine[CALL_RATE_LIMIT_COUNT - 1].startedAt >
        now - CALL_RATE_LIMIT_WINDOW_MS
    ) {
      throw new ConvexError("Too many calls — try again in a few minutes");
    }

    return await ctx.db.insert("calls", {
      conversationId: args.conversationId,
      callerId: me._id,
      calleeId: otherId,
      type: args.type,
      status: "ringing",
      startedAt: now,
    });
  },
});

/** Callee accepts or declines a ringing call. */
export const respondToCall = mutation({
  args: { callId: v.id("calls"), accept: v.boolean() },
  handler: async (ctx, args) => {
    const me = await requireUser(ctx);
    const call = await ctx.db.get(args.callId);
    if (call === null || call.calleeId !== me._id) {
      throw new ConvexError("Call not found");
    }
    if (call.status !== "ringing") {
      throw new ConvexError("Call is no longer ringing");
    }
    if (args.accept) {
      await ctx.db.patch(args.callId, { status: "active" });
    } else {
      await ctx.db.patch(args.callId, {
        status: "declined",
        endedAt: Date.now(),
      });
    }
  },
});

/**
 * Ends a call (either participant). Caller hanging up while still ringing is
 * recorded as "missed". Signals are deleted — they're transient plumbing.
 */
export const endCall = mutation({
  args: { callId: v.id("calls") },
  handler: async (ctx, args) => {
    const me = await requireUser(ctx);
    const call = await requireCallParticipant(
      ctx,
      await ctx.db.get(args.callId),
      me._id,
    );
    if (
      call.status === "ended" ||
      call.status === "declined" ||
      call.status === "missed"
    ) {
      return;
    }
    await ctx.db.patch(args.callId, {
      status:
        call.status === "ringing" && call.callerId === me._id
          ? "missed"
          : "ended",
      endedAt: Date.now(),
    });
    const signals = await ctx.db
      .query("callSignals")
      .withIndex("by_call", (q) => q.eq("callId", args.callId))
      .collect();
    for (const s of signals) {
      await ctx.db.delete(s._id);
    }
  },
});

/** Relay one SDP/ICE payload to the other peer. */
export const sendSignal = mutation({
  args: {
    callId: v.id("calls"),
    type: v.union(
      v.literal("offer"),
      v.literal("answer"),
      v.literal("ice-candidate"),
    ),
    payload: v.string(),
  },
  handler: async (ctx, args) => {
    const me = await requireUser(ctx);
    const call = await requireCallParticipant(
      ctx,
      await ctx.db.get(args.callId),
      me._id,
    );
    if (call.status !== "ringing" && call.status !== "active") {
      throw new ConvexError("Call has ended");
    }
    if (args.payload.length > SIGNAL_PAYLOAD_MAX_BYTES) {
      throw new ConvexError("Signal payload too large");
    }
    await ctx.db.insert("callSignals", {
      callId: args.callId,
      fromUserId: me._id,
      type: args.type,
      payload: args.payload,
      createdAt: Date.now(),
    });
  },
});

/** Subscribed by both peers; each filters out its own signals client-side. */
export const listSignals = query({
  args: { callId: v.id("calls") },
  handler: async (ctx, args) => {
    const me = await requireUser(ctx);
    await requireCallParticipant(ctx, await ctx.db.get(args.callId), me._id);
    const signals = await ctx.db
      .query("callSignals")
      .withIndex("by_call", (q) => q.eq("callId", args.callId))
      .take(500);
    return signals.map((s) => ({
      _id: s._id,
      fromUserId: s.fromUserId,
      type: s.type,
      payload: s.payload,
      createdAt: s.createdAt,
    }));
  },
});

/** Live call state + both usernames, for the in-call UI. */
export const getCall = query({
  args: { callId: v.id("calls") },
  handler: async (ctx, args) => {
    const me = await requireUser(ctx);
    const call = await requireCallParticipant(
      ctx,
      await ctx.db.get(args.callId),
      me._id,
    );
    const otherId = call.callerId === me._id ? call.calleeId : call.callerId;
    const other = await ctx.db.get(otherId);
    return {
      _id: call._id,
      conversationId: call.conversationId,
      type: call.type,
      status: call.status,
      startedAt: call.startedAt,
      iAmCaller: call.callerId === me._id,
      other: other === null ? null : publicUser(other),
    };
  },
});

/** Newest fresh ringing call for me — drives the incoming-call banner. */
export const myIncomingCall = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireUser(ctx);
    const recent = await ctx.db
      .query("calls")
      .withIndex("by_callee", (q) => q.eq("calleeId", me._id))
      .order("desc")
      .take(5);
    const now = Date.now();
    const ringing = recent.find(
      (c) => c.status === "ringing" && c.startedAt > now - RING_TIMEOUT_MS,
    );
    if (ringing === undefined) return null;
    const caller = await ctx.db.get(ringing.callerId);
    if (caller === null) return null;
    return {
      _id: ringing._id,
      type: ringing.type,
      caller: publicUser(caller),
    };
  },
});
