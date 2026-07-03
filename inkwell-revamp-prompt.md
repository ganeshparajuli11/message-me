# Inkwell — Phase 2 Revamp Prompt


**Read this entire document before writing any code.** This is a revamp of an existing, working app — not a rebuild. Do not regenerate files that already work. Do not guess at existing structure — read the actual files listed in Section 0 first, then make targeted changes.

---

## 0. Before you start — read these files first

Do not assume schema, auth pattern, or component structure from general knowledge of Next.js/Convex apps. This project has specific existing conventions. Read, in this order:

1. `README.md` — architecture notes, project layout, deployment model
2. `convex/schema.ts` — current tables (do not duplicate or rename existing fields)
3. `convex/lib/helpers.ts` — `requireUser`/`requireAdmin` pattern — reuse this, do not invent a new auth-check pattern
4. `convex/auth.config.ts` — Clerk JWT validation setup
5. `convex/admin.ts` — confirm it currently never imports/queries `messages` — **this boundary must survive every change below**
6. `src/app/` — existing routes (chat at `/`, admin at `/admin`)
7. `src/components/chat/`, `src/components/admin/`, `src/components/auth/`, `src/components/ui/` — existing component conventions, naming, and styling approach
8. `AGENTS.md` / `CLAUDE.md` — any existing agent instructions already in the repo; follow those in addition to this document, and flag if anything here conflicts with them

**Known facts about the current stack (confirmed from repo README):**
- Auth is Clerk (already migrated from manual login — do not touch sign-in/session logic itself, only its visual presentation)
- Convex is self-hosted (local via `deploy/docker-compose.yml`, production via VPS + reverse proxy) — not Convex Cloud
- Identity is derived server-side from Clerk JWT via `convex/auth.config.ts` — never trust client-supplied user IDs
- Existing rate limits: 20 messages/10s per user, 1 report per reporter-per-target per 24h — **preserve these, don't remove**
- Existing features: delivery/read ticks, typing indicator, presence, image messages, block/report, admin panel

---

## 1. Scope of this revamp (in order of priority)

1. Friend request system (gate messaging behind mutual acceptance)
2. Full visual/UX redesign (auth pages, sidebar, chat screen, responsive behavior)
3. Fix typing indicator not clearing after user stops typing
4. Message pin
5. Delete for me / delete for everyone
6. Image lightbox (click to expand + download)
7. Voice notes
8. Voice/video calls with screen share (stretch — only after everything above is solid)

If time/token budget is constrained, stop after item 6 and confirm before starting calls — that's the most architecturally different piece.

---

## 2. Friend Request System

### Why
Currently anyone can presumably message anyone (or start via "New note"). New requirement: **users must send a friend request; the other user must accept before a conversation can be created.**

### Schema additions to `convex/schema.ts`
```ts
friendRequests: defineTable({
  senderId: v.id("users"),
  receiverId: v.id("users"),
  status: v.union(v.literal("pending"), v.literal("accepted"), v.literal("declined")),
  createdAt: v.number(),
  respondedAt: v.optional(v.number()),
})
  .index("by_receiver", ["receiverId"])
  .index("by_sender", ["senderId"])
  .index("by_pair", ["senderId", "receiverId"]),

friendships: defineTable({
  userAId: v.id("users"),   // store both directions or normalize — pick ONE approach and document it in code comments
  userBId: v.id("users"),
  createdAt: v.number(),
})
  .index("by_userA", ["userAId"])
  .index("by_userB", ["userBId"]),
```
Check field naming against the existing `users` table's id conventions in `convex/schema.ts` before finalizing — match existing style exactly.

### New file: `convex/friends.ts`
- `searchUsers(query)` — query, for "Find Friends" search by username, excludes self, excludes existing friends/pending requests from results (or marks their state so UI can show "Request sent" / "Already friends")
- `sendFriendRequest(receiverId)` — mutation. Reject if already friends, already pending, or receiver has blocked sender (reuse existing `blocks` check pattern from `convex/messages.ts`/`convex/conversations.ts`)
- `respondToFriendRequest(requestId, accept: boolean)` — mutation. On accept: insert into `friendships`, update request status. On decline: update status only.
- `listFriendRequests(direction: "incoming" | "outgoing")` — query
- `listFriends()` — query
- `unfriend(friendUserId)` — mutation. Removes the `friendships` row. Decide and document: does this also delete/archive the existing conversation, or just block future new conversations? Default recommendation: **keep conversation history, just prevent new messages until re-friended** — confirm this matches user expectation before finalizing, flag it in the PR description either way.

### Enforcement point
Update `createConversation` (existing file, likely `convex/conversations.ts`) to check `friendships` before allowing conversation creation — same pattern as the existing block-check. Do not duplicate the friendship check loosely in the UI only; it must be server-side.

### UI changes
- Replace the current bottom "New note" button (visible in the screenshots) with **two elements**: a "Find Friends" button (opens search/discovery) and a "Friends" view (list, with unfriend action per row).
- Incoming friend requests need visible affordance — a badge/notification indicator near "Friends," not buried.
- Sidebar empty state currently says "No conversations yet. Start a new note to say hello." — update copy to reflect the new flow (e.g. prompt to find friends first if they have none).

---

## 3. Visual/UX Redesign

### Problem statement (from screenshots provided)
- Current UI reads as a generic list/notes app, not a chat app — flat, low visual hierarchy, sidebar feels empty
- Auth pages (Clerk-hosted or Clerk components) don't match app branding
- On smaller laptop screens, the message input field disappears/gets hidden — this is a **bug**, not just a polish item, fix it as such

### Design direction
Apply a real design system, not incremental tweaks. Suggested direction (adjust if you already have brand preferences — flag before committing to a full palette):

**"Ink & Paper"** — warm, tactile, distinct from generic blue-bubble chat apps.
- `paper` `#F7F3EC` — background
- `ink` `#2B2621` — primary text
- `moss` `#4A5D45` — own message bubbles / primary actions
- `clay` `#C77B58` — accent (send button, unread badges, active nav states)
- `ash` `#9C9488` — timestamps, muted text
- Serif display font for usernames/headers (e.g. Fraunces), humanist sans for body (e.g. Inter)
- Dark mode: invert to `ink` background / `paper` text, keep `moss`/`clay` as accents

If a Tailwind theme/tokens already exist in the repo (check `tailwind.config` or CSS variables under Tailwind v4's `@theme` block, since this repo uses Tailwind v4), extend/replace there — don't create a second parallel token system.

### Screens to redesign
| Screen | Changes needed |
|---|---|
| Sign in / sign up (Clerk) | Use Clerk's `appearance` prop to theme Clerk's hosted components to match the app palette/fonts instead of default Clerk styling — do not rebuild Clerk's auth UI from scratch |
| Sidebar | Currently empty/flat per screenshots — add: user's own profile header (already present, restyle), Find Friends / Friends buttons (replacing New note), conversation list with better visual hierarchy (avatar, name, last message preview, timestamp, unread badge — some of this may already exist, restyle don't rebuild if logic is already correct) |
| Chat window | Restyle message bubbles per token system, ensure header (other user's name/presence) is visually distinct, restyle input bar |
| Admin panel | Apply same token system for consistency — lower priority than user-facing screens |

### Responsive requirements (hard requirement, not optional polish)
- Message input bar must **never** be hidden/cut off at any viewport width, including small laptop resolutions (e.g. 1280×720 and similar). Audit current layout for fixed-height containers or missing `min-h-0`/flex overflow handling — this is almost always a flexbox/overflow bug in the chat column's height calculation, not a CSS values problem.
- Test at minimum: mobile (~375px), small laptop (~1280px), large monitor (~1920px+). Sidebar should collapse to an overlay/drawer on mobile if it doesn't already.
- Confirm existing responsive behavior (if any) before rewriting — check `src/components/chat/` for any existing breakpoint handling first.

---

## 4. Fix: Typing indicator doesn't clear

### Current bug
Typing indicator shows correctly when the other user types, but stays visible after they stop typing instead of disappearing.

### Root cause (likely)
The typing indicator is probably rendered based on the mere *existence* of a `typingStatus` row, not its recency. Check `convex/typing.ts` (or wherever `setTyping` lives) and the component that reads it.

### Fix
- Server side: no change needed if `updatedAt` is already being set correctly on each keystroke-throttled call.
- Client side: the typing indicator should be computed as `isTyping = (Date.now() - typingStatus.updatedAt) < 3000`, **re-evaluated on an interval** (e.g. `setInterval` every 1s) while the row exists, not just when new data arrives from the subscription — a Convex reactive query only re-renders when the underlying data changes, so if no new typing event comes in, the client will keep showing stale "typing" state forever unless something periodically re-checks the timestamp against the current clock.
- Do not add a scheduled Convex mutation to clear old rows unless the above client-side fix is insufficient — it's simpler and cheaper to solve this on the client.

---

## 5. Message Pin

### Schema
Add to `messages` table in `convex/schema.ts`:
```ts
pinnedAt: v.optional(v.number()),
pinnedBy: v.optional(v.id("users")),
```
(Simpler than a separate table since pins are per-message, not per-user — confirm this matches "pin for both participants" expectation, which is the standard chat-app behavior, not a private pin.)

### Functions (add to `convex/messages.ts`)
- `pinMessage(messageId)` — mutation, sets `pinnedAt`/`pinnedBy`. Consider a cap (e.g. max 3 pinned per conversation) — reject with a clear error if exceeded, don't silently overwrite.
- `unpinMessage(messageId)` — mutation, clears both fields.
- Pinned messages surfaced via a small query or filtering client-side from `getMessages` results — no need for a separate query if message volume per conversation is small; if conversations get long, add `listPinnedMessages(conversationId)` as its own indexed query instead of scanning all messages client-side.

### UI
A pinned-messages bar/strip at the top of the chat window, tappable to jump to that message.

---

## 6. Delete for Me / Delete for Everyone

### Current state
`messages` already has `deletedAt` (soft delete) — this should become **"delete for everyone."**

### New: "delete for me"
Add a new table rather than an array field (arrays that grow unbounded per-document are worse for Convex's document size/read patterns than a separate indexed table):
```ts
messageHiddenFor: defineTable({
  messageId: v.id("messages"),
  userId: v.id("users"),
})
  .index("by_message", ["messageId"])
  .index("by_user", ["userId"]),
```

### Functions (`convex/messages.ts`)
- `deleteMessageForEveryone(messageId)` — mutation, only sender may call, sets `deletedAt` (existing pattern) — rendered as "This message was deleted" for both participants.
- `deleteMessageForMe(messageId)` — mutation, either participant may call, inserts a row into `messageHiddenFor`. Client filters out messages present in this table for the current user.

### UI
Long-press/right-click on own messages → "Delete for me" / "Delete for everyone." On others' messages → "Delete for me" only.

---

## 7. Image Lightbox

Pure frontend feature, no schema changes needed.
- Click/tap an image message → open a full-screen modal/lightbox showing the full-resolution image
- Include a download button — since images are in Convex file storage, get the storage URL and trigger a download via an anchor tag with the `download` attribute (or fetch-then-blob-download if cross-origin headers block direct `download` attribute behavior — verify which works against Convex's storage URL response headers)
- Close on background click / Escape key

---

## 8. Voice Notes

### Feasibility
Convex file storage is generic — any file type (including audio blobs) works the same way images already do in this app. This is **not a real-time streaming feature** — it's record-then-upload-then-send, exactly like an image message. Reuse the existing image upload pattern in `convex/messages.ts` and whatever upload flow the frontend already uses for images.

### Implementation
- Client: use the browser's `MediaRecorder` API to record audio (mic permission required), producing a blob (e.g. `audio/webm` or `audio/mp4` depending on browser support — check compatibility, Safari has quirks with `MediaRecorder` formats, verify current support before locking a single format)
- Upload the blob to Convex storage the same way image uploads currently work
- Extend the `messages` schema `type` union: `v.union(v.literal("text"), v.literal("image"), v.literal("voice"))`, and add `voiceDurationSeconds: v.optional(v.number())`
- UI: hold-to-record button (or tap-to-start/tap-to-stop, decide based on what's simpler given the timeline), waveform or simple duration display, playback control in the message bubble

This does **not** require WebRTC or any real-time media infrastructure — don't over-engineer it as such.

---

## 9. Voice/Video Calls + Screen Share (stretch goal)

### Feasibility — read carefully
Convex is not built for continuous real-time audio/video media relay (that's not what its reactive query/mutation model does). Live calls need **WebRTC** for the actual audio/video/screen-share streams (peer-to-peer). Convex's role is only as the **signaling channel** — exchanging SDP offers/answers and ICE candidates between the two peers, replacing what would normally be a dedicated WebSocket signaling server. Verify current best-practice patterns for this against up-to-date WebRTC documentation before implementing, since STUN/TURN requirements and browser API specifics change.

### Schema addition
```ts
calls: defineTable({
  conversationId: v.id("conversations"),
  callerId: v.id("users"),
  calleeId: v.id("users"),
  type: v.union(v.literal("voice"), v.literal("video")),
  status: v.union(v.literal("ringing"), v.literal("active"), v.literal("ended"), v.literal("declined"), v.literal("missed")),
  startedAt: v.number(),
  endedAt: v.optional(v.number()),
}).index("by_conversation", ["conversationId"]),

callSignals: defineTable({
  callId: v.id("calls"),
  fromUserId: v.id("users"),
  type: v.union(v.literal("offer"), v.literal("answer"), v.literal("ice-candidate")),
  payload: v.string(), // JSON-stringified SDP/ICE data
  createdAt: v.number(),
}).index("by_call", ["callId"]),
```

### Functions (`convex/calls.ts`, new file)
- `initiateCall(conversationId, type)` — mutation, creates a `calls` row with `status: "ringing"`
- `respondToCall(callId, accept: boolean)` — mutation
- `endCall(callId)` — mutation
- `sendSignal(callId, type, payload)` — mutation, inserts into `callSignals`
- `listSignals(callId)` — query, subscribed by both peers to exchange offer/answer/ICE data reactively

### Screen share
Once basic video call works, screen share is a relatively small addition: replace/add a track to the existing `RTCPeerConnection` using `navigator.mediaDevices.getDisplayMedia()`. Treat this as an extension of the video call work, not a separate system.

### Requirement for TURN server
Peer-to-peer WebRTC alone fails behind many NATs/firewalls in practice — a TURN server is typically needed for reliable connectivity outside of ideal network conditions. This has hosting/cost implications (STUN is generally free/public, TURN typically is not, unless self-hosted e.g. via coturn on the same VPS). **Flag this explicitly to the project owner before building calls** — it affects the "buyer pays hosting only, no other recurring cost" constraint from the original project spec, since a public TURN service would reintroduce a metered dependency. Self-hosting coturn on the same VPS is the option that preserves the original cost model — note this tradeoff rather than silently picking a SaaS TURN provider.

---

## 10. Non-negotiable constraints for whichever AI executes this

- **Admin/message boundary must survive every change.** No new function in `convex/admin.ts` may query `messages`, `messageHiddenFor`, voice note content, or call content. Friend requests/friendships are fine for admin to see (not message content), but confirm this scope explicitly if extending the admin panel.
- **Do not weaken existing rate limits** (20 msgs/10s, 1 report/24h) while adding new mutation types — apply equivalent sane limits to new mutations (e.g. friend requests, pins) so they can't be spammed either.
- **Do not touch Clerk auth/session logic** — only its visual theming via `appearance`.
- **Do not switch off self-hosted Convex** — no feature here requires Convex Cloud; if an AI agent suggests it (e.g. for a "Convex Cloud-only" real-time media feature), that's a sign it's misunderstanding the architecture — flag and stop.
- **Verify current library/API syntax** (Convex schema validators, Clerk `appearance` API, WebRTC APIs, `MediaRecorder` browser support) against current documentation rather than relying on training data — these all change across versions.
- **Preserve existing working features** — this is incremental work on a live app, not a rewrite. If a change to shared code (e.g. `convex/lib/helpers.ts`) risks breaking an existing feature, flag it rather than proceeding silently.
- If any requirement above is ambiguous (e.g. friendship-removal-vs-conversation-history behavior in Section 2, pin cap count in Section 5, hold-vs-tap recording UX in Section 8), make a reasonable default choice, implement it, and **clearly state the assumption in the PR description** rather than blocking on it.

---

## 11. Suggested execution order (for token/session efficiency)

Don't attempt all of this in one pass. Suggested PR breakdown:
1. PR 1 — Friend request system (schema + functions + minimal UI, gate `createConversation`)
2. PR 2 — Visual redesign (tokens, sidebar, auth pages, chat window, responsive fix) — largest PR, can run in parallel with PR1 on a separate branch if using multiple agent sessions
3. PR 3 — Typing indicator fix (small, fast)
4. PR 4 — Pin + delete-for-me/everyone + image lightbox (bundle — all message-bubble-adjacent features)
5. PR 5 — Voice notes
6. PR 6 — Voice/video calls + screen share (only after confirming TURN server plan with project owner)

Each PR should reference this document and note which section it implements.
