"use client";

import { cn, formatTime } from "@/lib/utils";
import { AlertCircle, Check, CheckCheck } from "lucide-react";
/* eslint-disable @next/next/no-img-element */

export type BubbleMessage = {
  mine: boolean;
  type: "text" | "image";
  text: string | null;
  imageUrl: string | null;
  deleted: boolean;
  editedAt: number | null;
  createdAt: number | null; // null for optimistic/pending
  /** null = pending (optimistic), otherwise persisted */
  tick: "pending" | "sent" | "delivered" | "read" | "failed" | null;
  animateIn?: boolean;
};

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
}: {
  message: BubbleMessage;
  children?: React.ReactNode; // action buttons (edit/delete/report/retry)
}) {
  const { mine } = message;
  return (
    <div
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
        {message.deleted ? (
          <p className="text-sm italic opacity-80">Message deleted</p>
        ) : message.type === "image" ? (
          message.imageUrl ? (
            <img
              src={message.imageUrl}
              alt="Photo message"
              className="max-h-72 rounded-lg object-contain"
              loading="lazy"
            />
          ) : (
            <div className="h-40 w-52 animate-pulse rounded-lg bg-black/10" />
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
