"use client";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { ChatWindow } from "@/components/chat/chat-window";
import { ConversationList } from "@/components/chat/conversation-list";
import { NewChatDialog } from "@/components/chat/new-chat-dialog";
import type { Me } from "@/components/chat/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { UserButton } from "@clerk/nextjs";
import { useMutation } from "convex/react";
import { PenLine, Shield } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

export function ChatApp({ me }: { me: Me }) {
  const heartbeat = useMutation(api.users.heartbeat);
  const [selected, setSelected] = useState<Id<"conversations"> | null>(null);
  const [newChatOpen, setNewChatOpen] = useState(false);

  // Presence heartbeat (~30s) while the app is open.
  useEffect(() => {
    void heartbeat();
    const t = setInterval(() => void heartbeat(), 30_000);
    return () => clearInterval(t);
  }, [heartbeat]);

  return (
    <main className="relative z-10 mx-auto flex h-dvh max-w-6xl">
      {/* Sidebar */}
      <aside
        className={cn(
          "flex w-full flex-col border-r border-line md:w-80",
          selected !== null && "hidden md:flex",
        )}
      >
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <div>
            <h1 className="font-display text-xl font-semibold">Inkwell</h1>
            <p className="text-xs text-ash">@{me.username}</p>
          </div>
          <div className="flex items-center gap-1">
            {me.role === "admin" && (
              <Link href="/admin">
                <Button variant="ghost" size="icon" aria-label="Admin panel">
                  <Shield className="h-4 w-4" />
                </Button>
              </Link>
            )}
            <UserButton />
          </div>
        </header>

        <ConversationList selected={selected} onSelect={setSelected} />

        <div className="border-t border-line p-3">
          <Button
            variant="accent"
            className="w-full"
            onClick={() => setNewChatOpen(true)}
          >
            <PenLine className="h-4 w-4" />
            New note
          </Button>
        </div>
      </aside>

      {/* Chat window */}
      <section
        className={cn(
          "flex min-w-0 flex-1 flex-col",
          selected === null && "hidden md:flex",
        )}
      >
        {selected === null ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
            <PenLine className="h-8 w-8 text-ash/60" />
            <p className="font-display text-lg text-ash">
              Pick a conversation, or start a new note.
            </p>
          </div>
        ) : (
          <ChatWindow
            key={selected}
            conversationId={selected}
            me={me}
            onBack={() => setSelected(null)}
          />
        )}
      </section>

      <NewChatDialog
        open={newChatOpen}
        onClose={() => setNewChatOpen(false)}
        onCreated={(id) => {
          setNewChatOpen(false);
          setSelected(id);
        }}
      />
    </main>
  );
}
