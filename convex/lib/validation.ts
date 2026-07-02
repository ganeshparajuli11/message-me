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
