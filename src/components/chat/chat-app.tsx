"use client";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { CallOverlay } from "@/components/chat/call-overlay";
import { ChatWindow } from "@/components/chat/chat-window";
import { ConversationList } from "@/components/chat/conversation-list";
import type { Me } from "@/components/chat/types";
import { FindFriendsDialog } from "@/components/friends/find-friends-dialog";
import { FriendsPanel } from "@/components/friends/friends-panel";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { UserButton } from "@clerk/nextjs";
import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { MessageSquare, Search, Shield, Users } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

/**
 * App shell (revamp Sections 2 + 3).
 * Layout notes for the responsive fix: the root is h-dvh + overflow-hidden;
 * every flex column that hosts a scroll region has min-h-0 so the message
 * input can never be pushed below the viewport (this was the input-hidden
 * bug on small laptop screens — a flex overflow issue, not a sizing issue).
 */
export function ChatApp({ me }: { me: Me }) {
  const heartbeat = useMutation(api.users.heartbeat);
  const incoming = useQuery(api.friends.listFriendRequests, {
    direction: "incoming",
  });
  const [selected, setSelected] = useState<Id<"conversations"> | null>(null);
  const [tab, setTab] = useState<"chats" | "friends">("chats");
  const [findOpen, setFindOpen] = useState(false);
  const [callId, setCallId] = useState<Id<"calls"> | null>(null);
  const [callError, setCallError] = useState<string | null>(null);
  const initiateCall = useMutation(api.calls.initiateCall);

  async function startCall(type: "voice" | "video") {
    if (selected === null) return;
    setCallError(null);
    try {
      const id = await initiateCall({ conversationId: selected, type });
      setCallId(id);
    } catch (err) {
      setCallError(
        err instanceof ConvexError && typeof err.data === "string"
          ? err.data
          : "Could not start the call",
      );
      setTimeout(() => setCallError(null), 4000);
    }
  }

  // Presence heartbeat (~30s) while the app is open.
  useEffect(() => {
    void heartbeat();
    const t = setInterval(() => void heartbeat(), 30_000);
    return () => clearInterval(t);
  }, [heartbeat]);

  const requestCount = incoming?.length ?? 0;

  return (
    <main className="relative z-10 mx-auto flex h-dvh max-w-6xl overflow-hidden">
      {/* Sidebar */}
      <aside
        className={cn(
          "flex w-full min-h-0 flex-col border-r border-line bg-bg/60 md:w-80",
          selected !== null && "hidden md:flex",
        )}
      >
        {/* Profile header */}
        <header className="flex items-center gap-3 border-b border-line px-4 py-3">
          <Avatar username={me.username} online />
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-display text-lg font-semibold leading-tight">
              {me.username}
            </h1>
            <p className="text-[11px] text-ash">Inkwell — private notes</p>
          </div>
          {me.role === "admin" && (
            <Link href="/admin">
              <Button variant="ghost" size="icon" aria-label="Admin panel">
                <Shield className="h-4 w-4" />
              </Button>
            </Link>
          )}
          <UserButton />
        </header>

        {/* Chats / Friends tabs */}
        <nav className="flex gap-1 border-b border-line p-2">
          <button
            onClick={() => setTab("chats")}
            className={cn(
              "flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium cursor-pointer transition-colors",
              tab === "chats"
                ? "bg-moss text-paper"
                : "text-ash hover:bg-surface hover:text-fg",
            )}
          >
            <MessageSquare className="h-4 w-4" /> Chats
          </button>
          <button
            onClick={() => setTab("friends")}
            className={cn(
              "relative flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium cursor-pointer transition-colors",
              tab === "friends"
                ? "bg-moss text-paper"
                : "text-ash hover:bg-surface hover:text-fg",
            )}
          >
            <Users className="h-4 w-4" /> Friends
            {requestCount > 0 && (
              <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-clay px-1.5 text-[11px] font-semibold text-paper">
                {requestCount}
              </span>
            )}
          </button>
        </nav>

        {tab === "chats" ? (
          <ConversationList
            selected={selected}
            onSelect={(id) => setSelected(id)}
            onFindFriends={() => setFindOpen(true)}
          />
        ) : (
          <FriendsPanel
            onOpenConversation={(id) => {
              setSelected(id);
              setTab("chats");
            }}
          />
        )}

        <div className="border-t border-line p-3">
          <Button
            variant="accent"
            className="w-full"
            onClick={() => setFindOpen(true)}
          >
            <Search className="h-4 w-4" />
            Find friends
          </Button>
        </div>
      </aside>

      {/* Chat window */}
      <section
        className={cn(
          "flex min-h-0 min-w-0 flex-1 flex-col",
          selected === null && "hidden md:flex",
        )}
      >
        {selected === null ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
            <MessageSquare className="h-8 w-8 text-ash/60" />
            <p className="font-display text-lg text-ash">
              Pick a conversation, or find a friend to start one.
            </p>
          </div>
        ) : (
          <ChatWindow
            key={selected}
            conversationId={selected}
            me={me}
            onBack={() => setSelected(null)}
            onStartCall={(t) => void startCall(t)}
          />
        )}
      </section>

      <FindFriendsDialog open={findOpen} onClose={() => setFindOpen(false)} />

      {callError && (
        <p className="fixed inset-x-0 top-4 z-50 mx-auto w-fit rounded-full border border-clay/40 bg-bg px-4 py-2 text-sm text-clay shadow-lg">
          {callError}
        </p>
      )}
      <CallOverlay
        me={me}
        callId={callId}
        onOpenCall={setCallId}
        onClose={() => setCallId(null)}
      />
    </main>
  );
}
