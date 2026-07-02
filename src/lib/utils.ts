import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatLastSeen(ts: number | null): string {
  if (ts === null) return "offline";
  const diff = Date.now() - ts;
  if (diff < 60_000) return "online";
  const d = new Date(ts);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  if (sameDay) return `last seen ${formatTime(ts)}`;
  return `last seen ${d.toLocaleDateString([], { month: "short", day: "numeric" })}`;
}

export function formatListTimestamp(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return formatTime(ts);
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}
