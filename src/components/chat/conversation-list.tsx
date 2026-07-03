"use client";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { cn, formatListTimestamp } from "@/lib/utils";
import { useQuery } from "convex/react";
import { useNow } from "@/hooks/use-now";
import { ImageIcon, Mic } from "lucide-react";

const ONLINE_WINDOW_MS = 60_000;

export function ConversationList({
  selected,
  onSelect,
  onFindFriends,
}: {
  selected: Id<"conversations"> | null;
  onSelect: (id: Id<"conversations">) => void;
  onFindFriends: () => void;
}) {
  const conversations = useQuery(api.conversations.listConversations);
  const now = useNow();

  if (conversations === undefined) {
    return (
      <div className="flex-1 space-y-3 overflow-hidden p-4">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="flex animate-pulse items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-surface-2" />
            <div className="flex-1 space-y-2">
              <div className="h-3 w-24 rounded bg-surface-2" />
              <div className="h-3 w-40 rounded bg-surface-2" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm text-ash">
          No conversations yet.
          <br />
          Chats open once a friend request is accepted.
        </p>
        <button
          onClick={onFindFriends}
          className="text-sm font-medium text-clay underline underline-offset-4 hover:text-clay/80 cursor-pointer"
        >
          Find friends
        </button>
      </div>
    );
  }

  return (
    <nav className="flex-1 overflow-y-auto" aria-label="Conversations">
      <ul>
        {conversations.map((c) => {
          const online =
            c.other.lastActiveAt !== null &&
            now - c.other.lastActiveAt < ONLINE_WINDOW_MS;
          return (
            <li key={c._id}>
              <button
                onClick={() => onSelect(c._id)}
                className={cn(
                  "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface cursor-pointer",
                  selected === c._id && "bg-surface",
                )}
              >
                <Avatar
                  username={c.other.username}
                  imageUrl={c.other.image}
                  online={online}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate font-display font-semibold">
                      {c.other.username}
                    </span>
                    {c.lastMessage && (
                      <span className="shrink-0 text-[11px] text-ash">
                        {formatListTimestamp(c.lastMessage.createdAt)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm text-ash">
                      {c.lastMessage === null ? (
                        <span className="italic">Say hello</span>
                      ) : c.lastMessage.deleted ? (
                        <span className="italic">Message deleted</span>
                      ) : c.lastMessage.type === "image" ? (
                        <span className="inline-flex items-center gap-1">
                          <ImageIcon className="h-3.5 w-3.5" /> Photo
                        </span>
                      ) : c.lastMessage.type === "voice" ? (
                        <span className="inline-flex items-center gap-1">
                          <Mic className="h-3.5 w-3.5" /> Voice note
                        </span>
                      ) : (
                        <>
                          {c.lastMessage.mine && "You: "}
                          {c.lastMessage.text}
                        </>
                      )}
                    </span>
                    {c.unreadCount > 0 && (
                      <Badge variant="accent">{c.unreadCount}</Badge>
                    )}
                  </div>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
