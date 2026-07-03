# Inkwell — Final Polish Prompt (Completion Pass)

**Repo:** https://github.com/ganeshparajuli11/message-me

This is the closing punch list before the project is considered feature-complete. Investigate existing code before changing it — most of these are refinements to systems that already work (calls, delete, uploads), not new systems, **except item 6 (encryption), which needs a real decision before implementation — read that section fully before coding it.**

---

## 1. Ongoing-call state must be visible and controllable from outside the call screen

### Current bug (from screenshot)
Attempting to start a second call while one is active correctly shows a toast — *"A call is already in progress"* — but there's no way to see or end that ongoing call from the chat view. The user is stuck: they know a call is active, but can't get back to it or hang up without finding it themselves.

### Fix
- Add a persistent **"call in progress" banner/bar** (e.g. thin bar at the top of the chat window or a floating pill) whenever a call is active but the full call screen isn't currently open — showing the other participant's name and elapsed time, tap to return to the full call screen.
- The banner must include a visible **end-call control** so the user can hang up without re-entering the full call UI.
- This state needs to be tracked globally (not just local to the call screen component) — likely a React context or a top-level subscription to the active `calls` row for the current user, mounted at a layout level high enough that it persists across navigation within the app.

---

## 2. Calls need to appear in the chat timeline, like Messenger

### Requirement
Just like a normal message, call events should show up inline in the conversation history:
- **Calling…** — while ringing, shown to both sides in real time
- **Call ended** — with duration (e.g. "Call ended · 2:14")
- **Missed call** — if not answered
- **Declined** — if explicitly rejected
- These act as a lightweight call history log inside the conversation itself, not a separate screen

### Implementation approach
Extend the `messages` type union (or add a clearly separate `type: "call_log"` entry) so a call event can render as a distinct row in the same timeline as text/image/voice messages — check how the existing message list component discriminates on `type` and follow that same pattern rather than building a parallel rendering path.
Populate this from the existing `calls` table's status transitions (`ringing` → `active`/`declined`/`missed` → `ended`) — when a call's status changes, either write a corresponding entry into `messages`/call-log at that point, or (cleaner) have the message list component read directly from `calls` for that conversation and merge/interleave them with regular messages client-side by timestamp, so you're not duplicating data across two tables. Pick whichever fits the existing `getMessages` pagination pattern more cleanly — flag the tradeoff in the PR if unsure.

---

## 3. Camera-off state should show a clear "video off" indicator, not a black tile

### Current bug (from screenshot)
When a participant turns their camera off mid-call, their video tile just goes black — no icon, no name, nothing to indicate this is intentional vs. a broken feed.

### Fix
When a participant's video track is disabled/absent, render that tile as: their avatar (or initials) centered on a neutral background, plus a small camera-off icon badge, plus their name — same visual pattern used by every major call product (Meet, Zoom, Messenger). Apply this to **both** the local self-view tile and any remote tile.

---

## 4. Screen-share self-indicator

### Requirement
When the current user is sharing their screen, show a small on-screen indicator confirming this (e.g. a small badge/pill reading "You're presenting" or a highlighted border on their own local tile, and/or a small pip preview of what's being shared) — same pattern as Meet/Messenger, so the presenter has clear confirmation their share is live, not just a control button that toggled state silently.
Also confirm the **remote** participant sees an equivalent indicator (e.g. "X is sharing their screen") — check both sides during testing, not just the presenter's own view.

---

## 5. Delete message needs a confirmation dialog

### Current bug (from screenshot)
Messages can currently be deleted directly (screenshot shows "This message was deleted" already applied) with no confirmation step — a stray tap/click permanently alters the conversation.

### Fix
Add a confirmation dialog before either `deleteMessageForMe` or `deleteMessageForEveryone` fires:
- Modal/dialog styled consistently with the rest of the app's design system (not a browser-native `confirm()`)
- Clearly distinguish the two options if both are being offered in the same flow — separate buttons, not a single generic "Delete" that's ambiguous about scope
- Destructive action (delete) should be visually distinct (e.g. red/warning styling) from the cancel action
- Closeable via an explicit Cancel button and via clicking outside/Escape

---

## 6. Encrypting images and voice notes — read this section fully before implementing

### What you asked for
Image and voice-note content should not be plainly readable by anyone with raw access to storage/database — i.e. **admin (or anyone with server/DB access) should *not* be able to casually view message media**, consistent with the existing rule that admins never see message content. (Assuming "admin should get the data" in the original ask was a typo for "should *not* get the data," matching the rest of this project's stated admin boundary — confirm this reading is correct before implementing, since it changes the goal entirely if not.)

### Two real options — this is a genuine architecture decision, not just a coding task

**Option A — Encrypt at the storage/infrastructure layer (recommended for your timeline)**
Enable disk-level encryption on the VPS hosting self-hosted Convex (e.g. LUKS-encrypted volume), or use encryption-at-rest on whatever storage backend the self-hosted Convex file storage writes to. This protects **all** data — text, images, voice notes, everything — from anyone who gets raw access to the server's disk (e.g. a stolen backup, a compromised host), with **zero application code changes**. It does *not* stop someone with legitimate database/API query access (e.g. an admin with direct DB query tools, or a compromised admin account) from reading message content directly through the running application layer — but neither would Option B, unless combined with strict access controls limiting who can query the `messages` table at all (which you already have via the `admin.ts` boundary).

**Option B — Application-level encryption of file bytes**
Encrypt image/audio bytes with a server-held key (e.g. AES-256-GCM) before writing to Convex file storage, and decrypt on serve. This is meaningfully more complex than it sounds for binary files specifically, because:
- Convex's normal `storage.getUrl()` serves raw bytes directly — encrypted files can't be served through a plain storage URL and displayed as `<img src>`/`<audio src>` directly, since the browser would receive ciphertext
- You'd need a custom HTTP action that authenticates the requester, fetches the encrypted blob, decrypts it server-side, and streams the decrypted bytes back — replacing direct storage URLs everywhere images/audio are currently displayed
- Key management (where the key lives, how it's rotated) needs to be solved properly, not just hardcoded

### Recommendation
Given the timeline and that the actual stated concern (admin shouldn't casually read message media) is already substantially addressed by the existing `admin.ts` boundary plus Option A's infrastructure-level protection, **implement Option A** unless there's a specific compliance/contractual requirement forcing true application-level encryption of binary content. If the project owner confirms Option B is a hard requirement, treat it as its own dedicated task — don't fold it into this general polish pass, it's a bigger piece of work than everything else in this document combined.

**Note on text messages:** if text-message-body encryption at the application level was already decided as a stretch goal (per the original project spec) and not yet implemented, apply the same reasoning — Option A likely satisfies the actual requirement without the added complexity Option B would introduce for streaming/serving encrypted media.

---

## 7. Image upload size limit + client-side compression

### Requirement
Cap effective image message size at 5MB, but don't just reject large images with an error — compress them client-side first so the user rarely hits a hard wall.

### Implementation
- Before upload, run the selected image through client-side compression/resizing (e.g. canvas-based downscale + re-encode, or a small compression library) — target under 5MB, potentially iterating (reduce quality/dimensions progressively) if the first pass doesn't get under the limit
- Only show an error ("Image too large, please choose a smaller file") if compression genuinely cannot bring it under the cap (e.g. an extremely large source file) — this should be a rare fallback, not the primary UX
- Show upload/compression progress in the UI (this may already partially exist from the original image message implementation — extend rather than replace)

---

## 8. Profile picture compression

Apply the same compression approach to profile picture uploads before they're saved, so oversized photos don't bloat storage or slow down avatar rendering across the app.

**Investigate first:** confirm whether profile pictures are uploaded through Clerk's own hosted upload widget (in which case this app doesn't control that pipeline — compression there is Clerk's own behavior, not something to build here) or through a custom upload flow in this app's own code. Only add compression logic where the app actually owns the upload path. If it's entirely Clerk-managed, note that in the PR and skip this item rather than building something that won't run.

---

## 9. Fix left-side gap on the call screen

### Observed (from screenshots)
On the full-screen call view, there's a visible black gap/margin on the left side of the video area — the video content isn't filling the available width correctly, leaving dead space rather than a properly centered or full-bleed layout.

### Fix
Audit the call screen's container CSS — likely a fixed-width or incorrectly centered flex/grid container not stretching to fill the viewport. Video tiles (both the main remote view and the call container as a whole) should use the full available width/height of the call screen at any viewport size, consistent with the responsive requirements already set for the rest of the app.

---

## 10. Explicit scope clarifications (from the original ask)

- **Two-user message content (text/image/voice) should be protected per Section 6 — profile pictures do not need this treatment.** Don't apply encryption logic to avatar storage.
- These are the last items before the project is considered complete per the original spec — after this pass, do a full regression check across: friend requests, messaging, calls, pin, delete, image lightbox, voice notes, admin panel, responsive layout — to confirm nothing in this polish pass broke earlier working features.

---

## Suggested PR breakdown
1. PR — Ongoing-call banner/control (Section 1) + call log entries in chat (Section 2) — related, same call-state work
2. PR — Camera-off indicator (Section 3) + screen-share self-indicator (Section 4) + left-side gap fix (Section 9) — all call-screen UI fixes, bundle together
3. PR — Delete confirmation dialog (Section 5)
4. PR — Image compression + upload cap (Section 7) + profile picture compression if applicable (Section 8)
5. PR — Encryption (Section 6) — **only after confirming Option A vs B with the project owner** — do not start this without that confirmation, since the two paths are very different amounts of work
