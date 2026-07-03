# Inkwell — Bug Fix Prompt: Call Screen UI + Profile Avatar Sync

**Repo:** https://github.com/ganeshparajuli11/message-me

This is a bug-fix pass on features that already exist in the codebase (video calling, Clerk profile sync) — not new features. Investigate root cause before changing code. Do not rebuild these systems from scratch; find what's actually wrong and fix it precisely.

---

## Bug 1 — Video call screen UI is unmanaged/broken

### Observed behavior (from live test, screenshot attached)
- During an active call, the screen shows only: the other user's name, a call duration timer (`0:25`), and an otherwise **blank/black full-screen area**
- No visible local video tile (self-view)
- No visible remote video tile positioned/sized correctly, or it's not rendering at all
- No visible call controls — no mute button, no camera toggle, no end-call button, no screen-share button visible anywhere on screen
- This was the **first real test** of the call feature, so treat this as "the call UI was never fully wired up / styled," not a regression from something that used to work

### Investigation steps
1. Find the call screen component (likely under `src/components/chat/` or a dedicated `src/components/calls/` directory — search for files referencing `RTCPeerConnection`, `getUserMedia`, or the `calls`/`callSignals` Convex tables from the previous revamp work).
2. Check whether:
   - Local and remote `MediaStream` objects are actually being attached to `<video>` elements (check for missing `srcObject` assignment, or a `<video>` element that exists in the DOM but has no stream attached)
   - Call control buttons (mute, camera, end call, screen share) exist in the component but are hidden by a CSS/layout bug (e.g. `overflow: hidden`, wrong `z-index`, zero height container) vs. genuinely not implemented yet
   - The `RTCPeerConnection` is actually reaching `connected` state — check browser console/`connectionState` logs during a test call; if ICE negotiation is failing, video correctly wouldn't render (this would point to a signaling or STUN/TURN config issue, not just a UI issue — verify which one this is before styling anything)
3. Confirm whether this was tested between two different networks/devices or two tabs on the same machine — same-machine testing can behave differently for ICE connectivity than real cross-network calls, so note which case is failing.

### What "fixed" looks like
- Local self-view: small tile, typically bottom-right corner, mirrored video
- Remote video: fills the main call area, scales properly at any viewport size
- Visible control bar (bottom of screen, always visible, not overlapping other UI): mute/unmute, camera on/off, end call (visually distinct — red), screen share toggle
- Caller name + call duration shown in a header area that doesn't overlap the video
- Graceful states: "Connecting…" while ICE negotiates, clear UI if the call fails to connect (not just a silent black screen), clean teardown UI when the other person ends the call
- Responsive: works on mobile viewport too, not just desktop

### Constraint
Do not change the underlying `calls`/`callSignals` Convex schema or signaling logic unless the investigation in step 2 finds an actual signaling bug (e.g. ICE candidates never exchanged). If the data layer is working and this is purely a rendering/layout/controls issue, fix only the UI layer.

---

## Bug 2 — Duplicate/confusing profile avatar in sidebar header

### Observed behavior (from screenshot)
The sidebar header area is showing **what looks like two separate avatar elements** near each other — one avatar tied to the current logged-in user (top-left, next to "Inkwell — private notes"), and what appears to be a second, differently-styled avatar element nearby. This reads as a layout bug, not two intentional pieces of UI stacked correctly.

### Investigation steps
1. Locate the sidebar header component (top of the conversation list, showing the current user's own name/avatar).
2. Check whether **two separate avatar-rendering elements** are present in the JSX — e.g. one from a Clerk `<UserButton />`/`<UserAvatar />` component and a second, separately-coded avatar circle both rendering in the same header, unintentionally.
3. Determine the intended design: there should be exactly **one** self-avatar element in that header (used to open account/profile settings). If two exist, remove the redundant one and keep whichever correctly triggers the Clerk account modal (per Image 3, "Update profile" flow should still work from wherever this lives).

### What "fixed" looks like
One clean avatar in the sidebar header, correctly sized, correctly clickable to open account settings — no visual duplication.

---

## Bug 3 — Profile picture doesn't update after changing it in Clerk

### Observed behavior
User changed their profile picture via Clerk's account settings (Image 3 shows the Clerk profile panel with a picture set). The avatar shown elsewhere in the app (sidebar, chat headers, message bubbles) does not reflect this updated picture.

### Likely root cause (verify before fixing)
This app almost certainly stores a denormalized copy of user profile data (username, avatar URL) in the Convex `users` table rather than reading live from Clerk on every render — this is a common and reasonable pattern for performance, but it means **Clerk profile changes need an explicit sync step** to propagate into Convex. Two likely failure points:
1. **No webhook/sync mechanism exists at all** — the `users` row was only ever written once, at signup, and never updated again.
2. **A sync mechanism exists but isn't firing correctly** — e.g. a Clerk webhook (`user.updated` event) pointed at a Convex HTTP action that either isn't registered correctly, isn't verifying/parsing the payload correctly, or isn't actually updating the `avatarUrl`/image field on the existing user row.

### Investigation steps
1. Check `convex/http.ts` (or wherever HTTP actions are defined) for a Clerk webhook handler.
2. Check the Clerk dashboard webhook configuration (endpoint URL, subscribed events) — confirm `user.updated` is actually a subscribed event, not just `user.created`.
3. If no webhook exists yet: this needs to be added — Clerk should call a Convex HTTP action on `user.updated`, which then patches the corresponding `users` row's avatar/name fields. Verify current Clerk webhook + svix signature verification setup against current Clerk documentation before implementing, since exact payload/verification steps can change across Clerk SDK versions.
4. Alternative/simpler fix if a full webhook is out of scope right now: read the avatar directly from Clerk's `useUser()` hook on the client for the **current user's own** avatar display (self-view is always fresh this way), while other users' avatars (seen by their chat partners) still rely on the Convex-stored copy and do need the webhook fix to stay current. Decide which approach fits the timeline and document the choice.

### What "fixed" looks like
Changing a profile picture in Clerk account settings reflects in the app (own avatar, and other users seeing it) within a reasonable time — either immediately (webhook) or on next reasonable sync point (documented fallback), not "never until manual re-signup."

---

## Execution notes for the agent

- These are three independent bugs — fix and verify each separately, don't bundle into one giant unreviewable diff.
- For Bug 1 in particular: confirm whether this is a **signaling problem** or a **rendering/layout problem** before writing any CSS — these look identical to the end user (blank screen) but require completely different fixes.
- Test Bug 1 across two different devices/networks if possible, not just two tabs on one machine, since NAT/ICE behavior differs.
- If any of these investigations reveal the previous call-feature implementation is missing more than expected (e.g. no controls were ever coded, not just hidden), say so plainly in the PR description rather than silently doing a much bigger implementation than "fixing a bug" implies — flag scope change back to the project owner.
