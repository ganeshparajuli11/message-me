"use client";

import { cn, formatTime } from "@/lib/utils";
import { AlertCircle, Check, CheckCheck, Mic, Pin } from "lucide-react";
/* eslint-disable @next/next/no-img-element */

export type BubbleMessage = {
  mine: boolean;
  type: "text" | "image" | "voice";
  text: string | null;
  imageUrl: string | null;
  voiceUrl?: string | null;
  voiceDurationSeconds?: number | null;
  deleted: boolean;
  editedAt: number | null;
  createdAt: number | null; // null for optimistic/pending
  /** null = pending (optimistic), otherwise persisted */
  tick: "pending" | "sent" | "delivered" | "read" | "failed" | null;
  pinned?: boolean;
  animateIn?: boolean;
};

export function formatDuration(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * WhatsApp-style ticks per spec Section 6:
 * pending → faded single tick; sent → gray single; delivered → gray double;
 * read → clay double (brand color, not blue).
 */
function Ticks({ tick }: { tick: BubbleMessage["tick"] }) {
  if (tick === null) return null;
  switch (tick) {
    case "pending":
      return <Check className="h-3.5 w-3.5 opacity-40" aria-label="sending" />;
    case "sent":
      return <Check className="h-3.5 w-3.5 opacity-80" aria-label="sent" />;
    case "delivered":
      return (
        <CheckCheck className="h-3.5 w-3.5 opacity-80" aria-label="delivered" />
      );
    case "read":
      return (
        <CheckCheck className="h-3.5 w-3.5 text-clay" aria-label="read" />
      );
    case "failed":
      return (
        <AlertCircle className="h-3.5 w-3.5 text-red-400" aria-label="failed" />
      );
  }
}

export function MessageBubble({
  message,
  children,
  onImageClick,
  domId,
}: {
  message: BubbleMessage;
  children?: React.ReactNode; // action buttons (edit/delete/report/retry)
  onImageClick?: () => void;
  domId?: string;
}) {
  const { mine } = message;
  return (
    <div
      id={domId}
      className={cn(
        "group flex w-full items-end gap-2",
        mine ? "justify-end" : "justify-start",
        message.animateIn && "animate-message-in",
      )}
    >
      {mine && (
        <span className="opacity-0 transition-opacity group-hover:opacity-100">
          {children}
        </span>
      )}
      <div
        className={cn(
          "max-w-[75%] px-3.5 py-2 shadow-sm",
          mine
            ? "bubble-own bg-moss text-paper"
            : "bubble-other bg-surface-2 text-fg",
          message.deleted && "opacity-60",
        )}
      >
        {message.pinned && !message.deleted && (
          <p
            className={cn(
              "mb-1 flex items-center gap-1 text-[10px] font-medium",
              mine ? "text-paper/70" : "text-ash",
            )}
          >
            <Pin className="h-3 w-3" /> Pinned
          </p>
        )}
        {message.deleted ? (
          <p className="text-sm italic opacity-80">This message was deleted</p>
        ) : message.type === "image" ? (
          message.imageUrl ? (
            <button
              type="button"
              onClick={onImageClick}
              aria-label="Expand image"
              className="block cursor-zoom-in"
            >
              <img
                src={message.imageUrl}
                alt="Photo message"
                className="max-h-72 rounded-lg object-contain"
                loading="lazy"
              />
            </button>
          ) : (
            <div className="h-40 w-52 animate-pulse rounded-lg bg-black/10" />
          )
        ) : message.type === "voice" ? (
          message.voiceUrl ? (
            <span className="flex items-center gap-2">
              <Mic
                className={cn(
                  "h-4 w-4 shrink-0",
                  mine ? "text-paper/80" : "text-moss",
                )}
              />
              <audio
                controls
                preload="metadata"
                src={message.voiceUrl}
                className="h-10 w-52 max-w-full"
              />
              {typeof message.voiceDurationSeconds === "number" && (
                <span
                  className={cn(
                    "text-[10px] tabular-nums",
                    mine ? "text-paper/70" : "text-ash",
                  )}
                >
                  {formatDuration(message.voiceDurationSeconds)}
                </span>
              )}
            </span>
          ) : (
            <span className="flex h-10 w-52 items-center gap-2 text-sm opacity-70">
              <Mic className="h-4 w-4 animate-pulse" /> Voice note…
            </span>
          )
        ) : (
          <p className="whitespace-pre-wrap break-words text-sm">
            {message.text}
          </p>
        )}
        <div
          className={cn(
            "mt-1 flex items-center justify-end gap-1 text-[10px]",
            mine ? "text-paper/70" : "text-ash",
          )}
        >
          {message.editedAt !== null && !message.deleted && (
            <span className="italic">edited</span>
          )}
          {message.createdAt !== null && (
            <span>{formatTime(message.createdAt)}</span>
          )}
          {mine && <Ticks tick={message.tick} />}
        </div>
      </div>
      {!mine && (
        <span className="opacity-0 transition-opacity group-hover:opacity-100">
          {children}
        </span>
      )}
    </div>
  );
}

export function TypingIndicator() {
  return (
    <div className="flex items-end gap-2">
      <div className="bubble-other flex items-center gap-1 bg-surface-2 px-4 py-3">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-1.5 w-1.5 animate-bounce rounded-full bg-ash"
            style={{ animationDelay: `${i * 150}ms` }}
          />
        ))}
      </div>
    </div>
  );
}
