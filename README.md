# Inkwell - private 1:1 chat

Real-time, one-to-one chat with Clerk sign-in, username profiles, delivery/read
ticks, typing indicators, presence, image messages, block/report, and an admin
panel that can never see message content.

Stack: Next.js App Router, TypeScript, self-hosted Convex, Tailwind CSS v4, and
Clerk authentication.

## Local Development

1. Start a self-hosted Convex backend:

   ```bash
   cd deploy
   cp env.example .env
   docker compose up -d
   docker compose exec backend ./generate_admin_key.sh
   ```

2. Configure the app:

   ```bash
   cp .env.local.example .env.local
   npm install
   ```

3. Configure Clerk:

   - Create a Clerk app and activate the Convex integration:
     https://dashboard.clerk.com/apps/setup/convex
   - Copy the Clerk publishable key and secret key into `.env.local`.
   - Copy the Clerk Frontend API URL into `.env.local` as
     `CLERK_JWT_ISSUER_DOMAIN`.
   - Set the same issuer on Convex:

     ```bash
     npx convex env set CLERK_JWT_ISSUER_DOMAIN "https://your-clerk-frontend-api-url"
     ```

4. Push functions and run:

   ```bash
   npx convex dev
   npm run dev
   ```

5. Sign in with a Clerk account that has a username, then make it admin:

   ```bash
   npx convex run admin:promoteToAdminByUsername '{"username":"yourname"}'
   ```

The Convex dashboard runs at http://localhost:6791 when using the local
self-hosted stack.

## Production Deployment

1. Provision a VPS with Docker and a reverse proxy terminating TLS.
2. Copy `deploy/` to the server, fill in `.env`, and run `docker compose up -d`.
3. Generate the admin key on the server, configure the production Clerk app and
   domain, activate Clerk's Convex integration, and set the production Clerk
   Frontend API URL as `CLERK_JWT_ISSUER_DOMAIN` in Convex.
4. Push functions:

   ```bash
   CONVEX_SELF_HOSTED_URL=... CONVEX_SELF_HOSTED_ADMIN_KEY=... npx convex deploy
   ```

5. Build and run the Next.js frontend with
   `NEXT_PUBLIC_CONVEX_URL=https://convex.your-domain.com` plus the production
   Clerk keys.

## Phase 2 revamp (implemented)

Implements `inkwell-revamp-prompt.md` Sections 2–7:

- **Friend requests** — messaging is gated behind mutual acceptance.
  `convex/friends.ts`: searchUsers, sendFriendRequest, respondToFriendRequest,
  listFriendRequests, listFriends, unfriend. Enforced SERVER-SIDE in both
  `createConversation` and `sendMessage`.
- **Redesign** — Chats/Friends sidebar tabs with request badge, Find Friends
  dialog, profile header, Clerk components themed via the `appearance` prop
  (visual only). Responsive fix: root is `h-dvh overflow-hidden` and every
  scrolling flex column has `min-h-0`, so the message input can never be
  pushed off-screen (the small-laptop bug).
- **Typing indicator fix** — `getTyping` now returns the other side's latest
  typing timestamp; the client re-evaluates freshness against a 1s ticking
  clock, so the indicator clears ~3s after the last keystroke.
- **Pins** — `pinnedAt`/`pinnedBy` on messages, max 3 per conversation,
  pinned bar with jump-to-message, either participant may pin/unpin.
- **Delete for me / everyone** — `messageHiddenFor` table hides messages
  per-user; `deleteMessageForEveryone` is the old soft delete (sender only).
- **Image lightbox** — click to expand, blob download, Esc/backdrop close.
- **Voice notes** — MediaRecorder record-then-upload through the existing
  storage flow (no WebRTC). `type: "voice"` + `voiceStorageId` +
  `voiceDurationSeconds` on messages; server caps: 10 MB, 5 minutes,
  audio/webm|mp4|ogg|mpeg. Playback via a native audio element in the bubble.
- **Voice/video calls + screen share** — WebRTC peer-to-peer media; Convex is
  ONLY the signaling channel (`calls` + `callSignals` tables,
  `convex/calls.ts`: initiateCall/respondToCall/endCall/sendSignal/
  listSignals). One client component (`call-overlay.tsx`) handles ringing,
  accept/decline, mute, camera toggle, screen share (replaceTrack via
  getDisplayMedia — no renegotiation), and hang-up. Friend + block gates and
  a 10-calls/10-min rate limit apply. Signals are deleted when a call ends.
  TURN: self-hosted coturn on the same VPS (`deploy/coturn/`) keeps the
  one-hosting-bill cost model; calls fall back to public STUN without it.

**Assumptions made (flagged per revamp Section 10):**

1. Unfriending KEEPS conversation history and blocks new messages until
   re-friended; it also clears the pair's request rows so a fresh request
   works later.
2. Sending a request to someone who already requested you auto-accepts.
3. Pin cap is 3 per conversation; pins are visible to both participants.
   Pin counting/listing scans the newest 1000 messages of the conversation
   (older pins age out of the pinned bar).
4. Friend requests are rate-limited to 15 per sender per 10 minutes.
5. Voice recording is tap-to-start / tap-to-stop (not hold-to-record) —
   simpler and more reliable across devices. Format: audio/webm;codecs=opus
   where supported, audio/mp4 on Safari. `voiceStorageId` is a flagged schema
   addition — the audio blob needs its own reference field.
6. Calls: owner approved the self-hosted coturn plan (no metered TURN SaaS).
   `calls.by_caller`/`calls.by_callee` are flagged index additions (incoming-
   call subscription + rate limiting). Ringing calls time out as "missed"
   after 45s. Without TURN configured, calls still work on most networks via
   public STUN but may fail behind strict/symmetric NATs — configure
   `deploy/coturn/` + the `NEXT_PUBLIC_TURN_*` env vars for production.

## Bugfix pass (inkwell-bugfix-prompt.md)

1. **Call screen blank / no controls** — root cause was the RENDERING layer,
   not signaling (schema/signaling untouched, per the constraint): React
   StrictMode double-mounts effects in dev; the old setup effect left a
   cancelled PeerConnection in a ref, so the re-run bailed out and the call
   ran with NO media tracks (ICE "connects" the empty session, which is why
   the timer ticked over a black screen). The setup effect now fully tears
   down in its cleanup and rebuilds on re-run; signal processing waits on
   pcReady (fixes a signals-before-pc race); duplicate offers are ignored.
   UI: mirrored bottom-right self-view, remote fills the area, always-visible
   safe-area-aware control bar (mute / camera / screen share / red end),
   explicit "Connecting…" and failure states instead of silent black.
   NOTE for testing: two tabs on ONE machine can fight over the camera —
   test video across two devices; cross-network reliability needs the
   coturn TURN relay (deploy/coturn/).
2. **Duplicate sidebar avatar** — the header rendered both a decorative
   custom Avatar and Clerk's UserButton. The UserButton (which opens account
   settings) is now the single self-avatar.
3. **Profile picture not updating** — the users table stores a denormalized
   copy of Clerk profile data that was only written at signup. Chosen fix
   (documented alternative to a webhook, which a self-hosted/local backend
   can't easily receive): the presence heartbeat (~30s) re-syncs
   image/name/email from the verified Clerk JWT claims, so changes propagate
   within about a minute of the session token refreshing — for the user AND
   for everyone who sees their avatar. Avatars across the app (sidebar,
   chat header, friends, calls) now render the stored photo, falling back to
   initials.

## Architecture Notes

- `convex/schema.ts` stores app profile rows keyed by Clerk-backed
  `identity.tokenIdentifier`.
- `convex/lib/helpers.ts` centralizes `requireUser` and `requireAdmin`; backend
  functions derive identity from the authenticated session.
- Clerk owns sign-in/session management; Convex validates Clerk JWTs through
  `convex/auth.config.ts`.
- Blocking is enforced server-side inside `sendMessage` and
  `createConversation`.
- Rate limits: 20 messages per 10 seconds per user, 1 report per reporter
  per target per 24 hours, 15 friend requests per sender per 10 minutes.
- Friendship gate: `sendMessage` and `createConversation` both verify a
  `friendships` row (plus the existing block checks) server-side.
- `convex/admin.ts` never imports or queries `messages` or
  `messageHiddenFor`, so the admin panel cannot access private message
  content.

## Project Layout

```text
convex/               backend functions (schema, users, messages, admin...)
src/app/              Next.js pages (chat at /, admin at /admin)
src/components/       UI (chat/, admin/, auth/, ui/ primitives)
deploy/               docker-compose for self-hosted Convex
```
