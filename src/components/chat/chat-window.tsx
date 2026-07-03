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
import type { VoiceRecording } from "@/hooks/use-voice-recorder";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Lightbox } from "@/components/ui/lightbox";
import { Menu, MenuItem } from "@/components/ui/menu";
import { useNow } from "@/hooks/use-now";
import { formatLastSeen } from "@/lib/utils";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import {
  ArrowLeft,
  Ban,
  Flag,
  Loader2,
  Pencil,
  Phone,
  PhoneMissed,
  Pin,
  PinOff,
  RotateCcw,
  Trash2,
  Video,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

const ONLINE_WINDOW_MS = 60_000;
const TYPING_WINDOW_MS = 3_000;

export function ChatWindow({
  conversationId,
  me,
  onBack,
  onStartCall,
}: {
  conversationId: Id<"conversations">;
  me: Me;
  onBack: () => void;
  onStartCall: (type: "voice" | "video") => void;
}) {
  const conversation = useQuery(api.conversations.getConversation, {
    conversationId,
  });
  // Server returns the other participant's latest typing timestamp; freshness
  // is evaluated against a 1s ticking clock so the indicator CLEARS when they
  // stop typing (revamp Section 4 — reactive queries alone would stay stale).
  const typingAt = useQuery(api.typing.getTyping, { conversationId });
  const pinned = useQuery(api.messages.listPinnedMessages, { conversationId });
  // Call history interleaved into the timeline (polish Section 2) — read
  // straight from the calls table, merged client-side; no duplicated data.
  const callEvents = useQuery(api.calls.listCallEvents, { conversationId });
  const nowFast = useNow(1000);
  const otherIsTyping =
    typeof typingAt === "number" && nowFast - typingAt < TYPING_WINDOW_MS;

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
  const deleteForEveryone = useMutation(api.messages.deleteMessageForEveryone);
  const deleteForMe = useMutation(api.messages.deleteMessageForMe);
  const pinMessage = useMutation(api.messages.pinMessage);
  const unpinMessage = useMutation(api.messages.unpinMessage);
  const generateUploadUrl = useMutation(api.messages.generateUploadUrl);
  const blockUser = useMutation(api.blocks.blockUser);
  const unblockUser = useMutation(api.blocks.unblockUser);
  const reportUser = useMutation(api.reports.reportUser);

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
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{
    id: Id<"messages">;
    scope: "me" | "everyone";
  } | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);

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

  function jumpToMessage(id: string) {
    const el = document.getElementById(`msg-${id}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setHighlightId(id);
      setTimeout(() => setHighlightId(null), 1600);
    } else if (pageStatus === "CanLoadMore") {
      // Message not loaded yet — pull in more history, user can tap again.
      loadMore(100);
    }
  }

  function friendly(err: unknown, fallback: string) {
    return err instanceof ConvexError && typeof err.data === "string"
      ? err.data
      : fallback;
  }

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
      setActionError(friendly(err, "Message failed to send"));
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
      setActionError(friendly(err, "Image failed to send"));
      setPending((p) =>
        p.map((m) => (m.key === key ? { ...m, failed: true } : m)),
      );
    }
  }

  async function handleSendVoice(recording: VoiceRecording) {
    const key = `p${crypto.randomUUID()}`;
    setPending((p) => [
      ...p,
      { key, type: "voice", text: null, imagePreviewUrl: null, failed: false },
    ]);
    try {
      const uploadUrl = await generateUploadUrl();
      const res = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": recording.mimeType },
        body: recording.blob,
      });
      if (!res.ok) throw new Error("Upload failed");
      const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
      await sendMessage({
        conversationId,
        type: "voice",
        voiceStorageId: storageId,
        voiceDurationSeconds: recording.durationSeconds,
      });
      setPending((p) => p.filter((m) => m.key !== key));
    } catch (err) {
      setActionError(friendly(err, "Voice note failed to send"));
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
      setActionError(friendly(err, "Could not send the report"));
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
    other.lastActiveAt !== null &&
    nowFast - other.lastActiveAt < ONLINE_WINDOW_MS;
  const blocked = conversation.iBlockedThem || conversation.theyBlockedMe;

  // Newest-first from the server; render oldest → newest.
  const ordered = [...messages].reverse();

  // Interleave call events with messages by timestamp. Only show events
  // within the loaded message window (all of them once fully paginated).
  const oldestLoadedAt = ordered[0]?.createdAt ?? 0;
  const visibleCallEvents = (callEvents ?? []).filter(
    (c) => pageStatus === "Exhausted" || c.startedAt >= oldestLoadedAt,
  );
  type TimelineRow =
    | { kind: "message"; ts: number; message: (typeof ordered)[number] }
    | { kind: "call"; ts: number; call: (typeof visibleCallEvents)[number] };
  const timeline: TimelineRow[] = [
    ...ordered.map((m) => ({ kind: "message" as const, ts: m.createdAt, message: m })),
    ...visibleCallEvents.map((c) => ({ kind: "call" as const, ts: c.startedAt, call: c })),
  ].sort((a, b) => a.ts - b.ts);

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
      voiceUrl: m.voiceUrl,
      voiceDurationSeconds: m.voiceDurationSeconds,
      deleted: m.deleted,
      editedAt: m.editedAt,
      createdAt: m.createdAt,
      pinned: m.pinnedAt !== null,
      tick,
    };
  };

  const act = (fn: () => Promise<unknown>, fallback: string) => () =>
    void fn().catch((err) => setActionError(friendly(err, fallback)));

  return (
    <>
      {/* Header */}
      <header className="flex items-center gap-3 border-b border-line bg-surface/40 px-4 py-3">
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          aria-label="Back"
          onClick={onBack}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Avatar username={other.username} imageUrl={other.image} online={online} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-base font-semibold leading-tight">
            {other.username}
          </p>
          <p className="text-xs text-ash">
            {otherIsTyping ? (
              <span className="text-moss">typing…</span>
            ) : online ? (
              "online"
            ) : (
              formatLastSeen(other.lastActiveAt)
            )}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Voice call"
          title="Voice call"
          disabled={blocked}
          onClick={() => onStartCall("voice")}
        >
          <Phone className="h-4 w-4 text-moss" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Video call"
          title="Video call"
          disabled={blocked}
          onClick={() => onStartCall("video")}
        >
          <Video className="h-4 w-4 text-moss" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={conversation.iBlockedThem ? "Unblock user" : "Block user"}
          title={conversation.iBlockedThem ? "Unblock" : "Block"}
          onClick={act(
            () =>
              conversation.iBlockedThem
                ? unblockUser({ userId: other._id })
                : blockUser({ userId: other._id }),
            "Could not update block",
          )}
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

      {/* Pinned bar (revamp Section 5) */}
      {pinned !== undefined && pinned.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto border-b border-line bg-surface/60 px-3 py-2">
          <Pin className="h-3.5 w-3.5 shrink-0 text-clay" />
          {pinned.map((p) => (
            <button
              key={p._id}
              onClick={() => jumpToMessage(p._id)}
              className="flex max-w-56 shrink-0 items-center gap-1.5 rounded-full border border-line bg-bg px-3 py-1 text-xs hover:border-clay cursor-pointer"
              title="Jump to message"
            >
              <span className="truncate">
                {p.type === "image"
                  ? "📷 Photo"
                  : p.type === "voice"
                    ? "🎤 Voice note"
                    : p.text}
              </span>
              <span
                role="button"
                aria-label="Unpin"
                onClick={(e) => {
                  e.stopPropagation();
                  void unpinMessage({ messageId: p._id }).catch(() => {});
                }}
                className="rounded-full p-0.5 text-ash hover:text-clay"
              >
                <X className="h-3 w-3" />
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Messages — min-h-0 keeps this the ONLY growing region so the input
          bar below can never be pushed out of the viewport (revamp Section 3
          responsive bug fix). */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-4"
      >
        {pageStatus === "LoadingMore" && (
          <div className="flex justify-center py-2">
            <Loader2 className="h-4 w-4 animate-spin text-ash" />
          </div>
        )}
        {pageStatus === "Exhausted" && timeline.length > 0 && (
          <p className="pb-2 text-center text-[11px] text-ash">
            This is the beginning of your conversation
          </p>
        )}
        {timeline.length === 0 && pending.length === 0 && (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-ash">
              No messages yet — write the first note.
            </p>
          </div>
        )}

        {timeline.map((row) => {
          if (row.kind === "call") {
            return <CallLogRow key={row.call._id} call={row.call} />;
          }
          const m = row.message;
          const mine = m.senderId === me._id;
          const isPinned = m.pinnedAt !== null;
          return (
            <div
              key={m._id}
              className={
                highlightId === m._id
                  ? "rounded-2xl ring-2 ring-clay/60 transition-shadow"
                  : undefined
              }
            >
              <MessageBubble
                message={toBubble(m)}
                domId={`msg-${m._id}`}
                onImageClick={
                  m.imageUrl ? () => setLightboxUrl(m.imageUrl) : undefined
                }
              >
                {!m.deleted && (
                  <Menu align={mine ? "end" : "start"}>
                    <MenuItem
                      onSelect={act(
                        () =>
                          isPinned
                            ? unpinMessage({ messageId: m._id })
                            : pinMessage({ messageId: m._id }),
                        "Could not update pin",
                      )}
                    >
                      {isPinned ? (
                        <>
                          <PinOff className="h-3.5 w-3.5" /> Unpin
                        </>
                      ) : (
                        <>
                          <Pin className="h-3.5 w-3.5" /> Pin
                        </>
                      )}
                    </MenuItem>
                    {mine && m.type === "text" && (
                      <MenuItem
                        onSelect={() =>
                          setEditing({ id: m._id, text: m.text ?? "" })
                        }
                      >
                        <Pencil className="h-3.5 w-3.5" /> Edit
                      </MenuItem>
                    )}
                    {!mine && m.type === "text" && (
                      <MenuItem
                        onSelect={() => {
                          setReporting({ snapshot: m.text });
                          setReportDone(false);
                        }}
                      >
                        <Flag className="h-3.5 w-3.5" /> Report
                      </MenuItem>
                    )}
                    <MenuItem
                      destructive
                      onSelect={() =>
                        setConfirmDelete({ id: m._id, scope: "me" })
                      }
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Delete for me
                    </MenuItem>
                    {mine && (
                      <MenuItem
                        destructive
                        onSelect={() =>
                          setConfirmDelete({ id: m._id, scope: "everyone" })
                        }
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Delete for everyone
                      </MenuItem>
                    )}
                  </Menu>
                )}
              </MessageBubble>
            </div>
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

        {otherIsTyping && <TypingIndicator />}
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
        onSendVoice={(r) => void handleSendVoice(r)}
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
                }).catch((err) =>
                  setActionError(friendly(err, "Could not edit the message")),
                );
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

      {/* Delete confirmation (polish Section 5) */}
      <Dialog
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        title={
          confirmDelete?.scope === "everyone"
            ? "Delete for everyone?"
            : "Delete for me?"
        }
      >
        {confirmDelete && (
          <div className="space-y-4">
            <p className="text-sm text-ash">
              {confirmDelete.scope === "everyone"
                ? `This message will be removed for both you and ${other.username}. Everyone will see "This message was deleted".`
                : "This message will disappear from your view only — the other person will still see it. This can't be undone."}
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirmDelete(null)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  const { id, scope } = confirmDelete;
                  setConfirmDelete(null);
                  void (
                    scope === "everyone"
                      ? deleteForEveryone({ messageId: id })
                      : deleteForMe({ messageId: id })
                  ).catch((err) =>
                    setActionError(friendly(err, "Could not delete")),
                  );
                }}
              >
                <Trash2 className="h-4 w-4" /> Delete
              </Button>
            </div>
          </div>
        )}
      </Dialog>

      {lightboxUrl && (
        <Lightbox imageUrl={lightboxUrl} onClose={() => setLightboxUrl(null)} />
      )}
    </>
  );
}

/** Inline call-history row (polish Section 2) — Messenger-style chip. */
function CallLogRow({
  call,
}: {
  call: {
    _id: string;
    type: "voice" | "video";
    status: "ringing" | "active" | "ended" | "declined" | "missed";
    mine: boolean;
    startedAt: number;
    durationSeconds: number | null;
  };
}) {
  const Icon =
    call.status === "missed" || call.status === "declined"
      ? PhoneMissed
      : call.type === "video"
        ? Video
        : Phone;
  const label =
    call.status === "ringing"
      ? "Calling…"
      : call.status === "active"
        ? "Call in progress…"
        : call.status === "declined"
          ? "Call declined"
          : call.status === "missed"
            ? call.mine
              ? "No answer"
              : "Missed call"
            : call.durationSeconds !== null
              ? `Call ended · ${formatDurationLabel(call.durationSeconds)}`
              : "Call ended";
  const alarming = call.status === "missed" || call.status === "declined";
  return (
    <div className="flex justify-center py-1">
      <span
        className={
          alarming
            ? "flex max-w-[calc(100vw-2rem)] items-center gap-2 rounded-full border border-clay/30 bg-clay/10 px-3 py-1.5 text-xs text-clay sm:max-w-full"
            : "flex max-w-[calc(100vw-2rem)] items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-xs text-ash sm:max-w-full"
        }
      >
        <Icon className="h-3.5 w-3.5" />
        <span className="truncate">{label}</span>
        <span className="opacity-70">
          {new Date(call.startedAt).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      </span>
    </div>
  );
}

function formatDurationLabel(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const sec = totalSeconds % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}
