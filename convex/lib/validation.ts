/**
 * Shared validation constants and pure helpers.
 * Used by both backend functions and (via import) the frontend.
 */

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;
export const USERNAME_REGEX = /^[a-zA-Z0-9_]+$/;

export const MESSAGE_MAX_LENGTH = 4000; // server-enforced text cap
export const REPORT_REASON_MAX_LENGTH = 500;

export const IMAGE_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
export const IMAGE_ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
];

// Rate limits (Section 8)
export const SEND_RATE_LIMIT_COUNT = 20;
export const SEND_RATE_LIMIT_WINDOW_MS = 10_000;
export const REPORT_RATE_LIMIT_PER_TARGET_MS = 24 * 60 * 60 * 1000; // 1 per target per 24h

// Friend requests (revamp Section 2): anti-spam cap
export const FRIEND_REQUEST_LIMIT_COUNT = 15;
export const FRIEND_REQUEST_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 15 per 10 min

// Voice notes (revamp Section 8)
export const VOICE_MAX_BYTES = 10 * 1024 * 1024; // 10 MB
export const VOICE_MAX_DURATION_S = 300; // 5 minutes
export const VOICE_ALLOWED_TYPES = [
  "audio/webm",
  "audio/webm;codecs=opus",
  "audio/mp4",
  "audio/ogg",
  "audio/ogg;codecs=opus",
  "audio/mpeg",
];

// Calls (revamp Section 9)
export const CALL_RATE_LIMIT_COUNT = 10;
export const CALL_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 per 10 min
export const SIGNAL_PAYLOAD_MAX_BYTES = 32 * 1024; // SDP/ICE JSON cap
export const RING_TIMEOUT_MS = 45_000; // ringing older than this = missed

// Message pins (revamp Section 5)
export const MAX_PINNED_PER_CONVERSATION = 3;
// Bounded scan window when counting/listing pins in one conversation.
export const PIN_SCAN_LIMIT = 1000;

// Presence: online if lastActiveAt within this window
export const PRESENCE_ONLINE_WINDOW_MS = 60_000;
// Typing: considered typing if updatedAt within this window (spec Section 5)
export const TYPING_WINDOW_MS = 3_000;

export function validateUsernameFormat(username: string): {
  valid: boolean;
  error?: string;
} {
  if (username.length < USERNAME_MIN) {
    return { valid: false, error: `At least ${USERNAME_MIN} characters` };
  }
  if (username.length > USERNAME_MAX) {
    return { valid: false, error: `At most ${USERNAME_MAX} characters` };
  }
  if (!USERNAME_REGEX.test(username)) {
    return { valid: false, error: "Only letters, numbers and underscores" };
  }
  return { valid: true };
}
