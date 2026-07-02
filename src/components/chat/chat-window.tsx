"use client";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  MessageBubble,
  TypingIndicator,
  type BubbleMessage,
} from "@/components/chat/message-bubble";
import { MessageInput } from "@/components/chat/message-input";
import type { Me, PendingMessage } from "@/components/chat/types";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatLastSeen } from "@/lib/utils";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import {
  ArrowLeft,
  Ban,
  Flag,
  Loader2,
  Pencil,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNow } from "@/hooks/use-now";

const ONLINE_WINDOW_MS = 60_000;

export function ChatWindow({
  conversationId,
  me,
  onBack,
}: {
  conversationId: Id<"conversations">;
  me: Me;
  onBack: () => void;
}) {
  const conversation = useQuery(api.conversations.getConversation, {
    conversationId,
  });
  const typing = useQuery(api.typing.getTyping, { conversationId });
  const {
    results: messages,
    status: pageStatus,
    loadMore,
  } = usePaginatedQuery(
    api.messages.getMessages,
    { conversationId },
    { initialNumItems: 30 },
  );

  const sendMessage = useMutation(api.messages.sendMessage);
  const markRead = useMutation(api.messages.markRead);
  const editMessage = useMutation(api.messages.editMessage);
  const deleteMessage = useMutation(api.messages.deleteMessage);
  const generateUploadUrl = useMutation(api.messages.generateUploadUrl);
  const blockUser = useMutation(api.blocks.blockUser);
  const unblockUser = useMutation(api.blocks.unblockUser);
  const reportUser = useMutation(api.reports.reportUser);

  const now = useNow();
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [editing, setEditing] = useState<{
    id: Id<"messages">;
    text: string;
  } | null>(null);
  const [reporting, setReporting] = useState<{ snapshot: string | null } | null>(
    null,
  );
  const [reportReason, setReportReason] = useState("");
  const [reportBusy, setReportBusy] = useState(false);
  const [reportDone, setReportDone] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const newestIdRef = useRef<string | null>(null);

  // Mark read when viewing and whenever a new incoming message lands.
  const newestId = messages[0]?._id ?? null;
  useEffect(() => {
    if (document.visibilityState === "visible") {
      void markRead({ conversationId });
    }
  }, [conversationId, newestId, markRead]);

  // Stick to bottom on new messages.
  useEffect(() => {
    if (newestId !== newestIdRef.current) {
      newestIdRef.current = newestId;
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [newestId, pending.length]);

  // Infinite scroll: load older messages when scrolled to top.
  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (el && el.scrollTop < 60 && pageStatus === "CanLoadMore") {
      loadMore(30);
    }
  }, [pageStatus, loadMore]);

  async function handleSendText(text: string) {
    const key = `p${crypto.randomUUID()}`;
    setPending((p) => [
      ...p,
      { key, type: "text", text, imagePreviewUrl: null, failed: false },
    ]);
    try {
      await sendMessage({ conversationId, type: "text", text });
      setPending((p) => p.filter((m) => m.key !== key));
    } catch (err) {
      setActionError(
        err instanceof ConvexError && typeof err.data === "string"
          ? err.data
          : "Message failed to send",
      );
      setPending((p) =>
        p.map((m) => (m.key === key ? { ...m, failed: true } : m)),
      );
    }
  }

  async function handleSendImage(file: File) {
    const key = `p${crypto.randomUUID()}`;
    const previewUrl = URL.createObjectURL(file);
    setPending((p) => [
      ...p,
      { key, type: "image", text: null, imagePreviewUrl: previewUrl, failed: false },
    ]);
    try {
      const uploadUrl = await generateUploadUrl();
      const res = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!res.ok) throw new Error("Upload failed");
      const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
      await sendMessage({
        conversationId,
        type: "image",
        imageStorageId: storageId,
      });
      setPending((p) => p.filter((m) => m.key !== key));
      URL.revokeObjectURL(previewUrl);
    } catch (err) {
      setActionError(
        err instanceof ConvexError && typeof err.data === "string"
          ? err.data
          : "Image failed to send",
      );
      setPending((p) =>
        p.map((m) => (m.key === key ? { ...m, failed: true } : m)),
      );
    }
  }

  function retryPending(msg: PendingMessage) {
    setPending((p) => p.filter((m) => m.key !== msg.key));
    if (msg.type === "text" && msg.text) void handleSendText(msg.text);
    // Failed image sends must be re-attached (the original File is gone).
  }

  async function submitReport() {
    if (!conversation || !reportReason.trim()) return;
    setReportBusy(true);
    setActionError(null);
    try {
      await reportUser({
        reportedUserId: conversation.other._id,
        reason: reportReason.trim(),
        messageSnapshot: reporting?.snapshot ?? undefined,
      });
      setReportDone(true);
      setReportReason("");
    } catch (err) {
      setActionError(
        err instanceof ConvexError && typeof err.data === "string"
          ? err.data
          : "Could not send the report",
      );
    } finally {
      setReportBusy(false);
    }
  }

  if (conversation === undefined) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-ash" />
      </div>
    );
  }

  const other = conversation.other;
  const online =
    other.lastActiveAt !== null && now - other.lastActiveAt < ONLINE_WINDOW_MS;
  const blocked = conversation.iBlockedThem || conversation.theyBlockedMe;

  // Newest-first from the server; render oldest → newest.
  const ordered = [...messages].reverse();

  const toBubble = (m: (typeof messages)[number]): BubbleMessage => {
    const mine = m.senderId === me._id;
    let tick: BubbleMessage["tick"] = null;
    if (mine) {
      if (conversation.otherLastReadAt >= m.createdAt) tick = "read";
      else if ((other.lastActiveAt ?? 0) >= m.createdAt) tick = "delivered";
      else tick = "sent";
    }
    return {
      mine,
      type: m.type,
      text: m.text,
      imageUrl: m.imageUrl,
      deleted: m.deleted,
      editedAt: m.editedAt,
      createdAt: m.createdAt,
      tick,
    };
  };

  return (
    <>
      {/* Header */}
      <header className="flex items-center gap-3 border-b border-line px-4 py-3">
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          aria-label="Back"
          onClick={onBack}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Avatar username={other.username} online={online} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-display font-semibold">{other.username}</p>
          <p className="text-xs text-ash">
            {typing
              ? "typing…"
              : online
                ? "online"
                : formatLastSeen(other.lastActiveAt)}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label={conversation.iBlockedThem ? "Unblock user" : "Block user"}
          title={conversation.iBlockedThem ? "Unblock" : "Block"}
          onClick={() =>
            void (conversation.iBlockedThem
              ? unblockUser({ userId: other._id })
              : blockUser({ userId: other._id }))
          }
        >
          <Ban
            className={
              conversation.iBlockedThem ? "h-4 w-4 text-clay" : "h-4 w-4 text-ash"
            }
          />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Report user"
          title="Report"
          onClick={() => {
            setReporting({ snapshot: null });
            setReportDone(false);
          }}
        >
          <Flag className="h-4 w-4 text-ash" />
        </Button>
      </header>

      {/* Messages */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex-1 space-y-2 overflow-y-auto px-4 py-4"
      >
        {pageStatus === "LoadingMore" && (
          <div className="flex justify-center py-2">
            <Loader2 className="h-4 w-4 animate-spin text-ash" />
          </div>
        )}
        {pageStatus === "Exhausted" && ordered.length > 0 && (
          <p className="pb-2 text-center text-[11px] text-ash">
            This is the beginning of your conversation
          </p>
        )}
        {ordered.length === 0 && pending.length === 0 && (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-ash">
              No messages yet — write the first note.
            </p>
          </div>
        )}

        {ordered.map((m) => {
          const mine = m.senderId === me._id;
          return (
            <MessageBubble key={m._id} message={toBubble(m)}>
              {mine && !m.deleted ? (
                <span className="flex gap-1">
                  {m.type === "text" && (
                    <button
                      aria-label="Edit message"
                      className="rounded p-1 text-ash hover:text-fg cursor-pointer"
                      onClick={() =>
                        setEditing({ id: m._id, text: m.text ?? "" })
                      }
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <button
                    aria-label="Delete message"
                    className="rounded p-1 text-ash hover:text-clay cursor-pointer"
                    onClick={() => void deleteMessage({ messageId: m._id })}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </span>
              ) : !mine && !m.deleted && m.type === "text" ? (
                <button
                  aria-label="Report this message"
                  title="Report this message"
                  className="rounded p-1 text-ash hover:text-clay cursor-pointer"
                  onClick={() => {
                    setReporting({ snapshot: m.text });
                    setReportDone(false);
                  }}
                >
                  <Flag className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </MessageBubble>
          );
        })}

        {pending.map((m) => (
          <MessageBubble
            key={m.key}
            message={{
              mine: true,
              type: m.type,
              text: m.text,
              imageUrl: m.imagePreviewUrl,
              deleted: false,
              editedAt: null,
              createdAt: null,
              tick: m.failed ? "failed" : "pending",
              animateIn: true,
            }}
          >
            {m.failed && (
              <span className="flex gap-1">
                {m.type === "text" && (
                  <button
                    aria-label="Retry send"
                    className="rounded p-1 text-clay cursor-pointer"
                    onClick={() => retryPending(m)}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </button>
                )}
                <button
                  aria-label="Discard failed message"
                  className="rounded p-1 text-ash cursor-pointer"
                  onClick={() =>
                    setPending((p) => p.filter((x) => x.key !== m.key))
                  }
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </span>
            )}
          </MessageBubble>
        ))}

        {typing === true && <TypingIndicator />}
      </div>

      {actionError && (
        <p className="border-t border-line bg-clay/10 px-4 py-2 text-xs text-clay">
          {actionError}
        </p>
      )}
      {blocked && (
        <p className="border-t border-line bg-surface px-4 py-2 text-center text-xs text-ash">
          {conversation.iBlockedThem
            ? "You blocked this user — unblock to continue the conversation."
            : "You can't message this user."}
        </p>
      )}

      <MessageInput
        conversationId={conversationId}
        disabled={blocked}
        onSendText={(t) => void handleSendText(t)}
        onSendImage={(f) => void handleSendImage(f)}
      />

      {/* Edit dialog */}
      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title="Edit message"
      >
        {editing && (
          <div className="space-y-3">
            <Input
              value={editing.text}
              onChange={(e) => setEditing({ ...editing, text: e.target.value })}
              autoFocus
            />
            <Button
              className="w-full"
              disabled={editing.text.trim().length === 0}
              onClick={() => {
                void editMessage({
                  messageId: editing.id,
                  newText: editing.text,
                });
                setEditing(null);
              }}
            >
              Save changes
            </Button>
          </div>
        )}
      </Dialog>

      {/* Report dialog */}
      <Dialog
        open={reporting !== null}
        onClose={() => setReporting(null)}
        title={`Report @${other.username}`}
      >
        {reportDone ? (
          <div className="space-y-3">
            <p className="text-sm">
              Thanks — your report was sent to the admins. They see who reported
              whom, when, why, and the one message you chose to share (if any).
              They never browse your conversation.
            </p>
            <Button className="w-full" onClick={() => setReporting(null)}>
              Done
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <textarea
              value={reportReason}
              onChange={(e) => setReportReason(e.target.value)}
              placeholder="Why are you reporting this user?"
              rows={3}
              maxLength={500}
              className="w-full resize-none rounded-lg border border-line bg-surface px-3 py-2 text-sm placeholder:text-ash focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-moss/40"
            />
            {reporting?.snapshot && (
              <div className="rounded-lg border border-line bg-surface p-3">
                <p className="mb-1 text-[11px] font-medium text-ash">
                  Message you&apos;re sharing with the report:
                </p>
                <p className="text-xs">{reporting.snapshot}</p>
              </div>
            )}
            <Button
              variant="accent"
              className="w-full"
              disabled={reportBusy || reportReason.trim().length === 0}
              onClick={() => void submitReport()}
            >
              {reportBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Send report"
              )}
            </Button>
          </div>
        )}
      </Dialog>
    </>
  );
}
