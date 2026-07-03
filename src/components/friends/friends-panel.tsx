"use client";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useNow } from "@/hooks/use-now";
import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { Check, Loader2, MessageSquare, UserMinus, X } from "lucide-react";
import { useState } from "react";

const ONLINE_WINDOW_MS = 60_000;

/**
 * Friends view (revamp Section 2): incoming requests with accept/decline,
 * outgoing pending, and the friends list with message + unfriend actions.
 */
export function FriendsPanel({
  onOpenConversation,
}: {
  onOpenConversation: (id: Id<"conversations">) => void;
}) {
  const now = useNow();
  const incoming = useQuery(api.friends.listFriendRequests, {
    direction: "incoming",
  });
  const outgoing = useQuery(api.friends.listFriendRequests, {
    direction: "outgoing",
  });
  const friends = useQuery(api.friends.listFriends);
  const respond = useMutation(api.friends.respondToFriendRequest);
  const unfriend = useMutation(api.friends.unfriend);
  const createConversation = useMutation(api.conversations.createConversation);

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmUnfriend, setConfirmUnfriend] = useState<string | null>(null);

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(
        err instanceof ConvexError && typeof err.data === "string"
          ? err.data
          : "Something went wrong",
      );
    } finally {
      setBusy(null);
    }
  }

  if (incoming === undefined || friends === undefined) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-ash" />
      </div>
    );
  }

  return (
    <div className="flex-1 space-y-5 overflow-y-auto p-3">
      {error && <p className="px-1 text-xs text-clay">{error}</p>}

      {incoming.length > 0 && (
        <section>
          <h3 className="px-1 pb-2 text-xs font-semibold uppercase tracking-wide text-ash">
            Requests for you
          </h3>
          <ul className="space-y-1">
            {incoming.map((r) => (
              <li
                key={r._id}
                className="flex items-center gap-3 rounded-xl bg-surface px-3 py-2.5"
              >
                <Avatar username={r.other.username} className="scale-90" />
                <span className="min-w-0 flex-1 truncate font-display font-semibold">
                  {r.other.username}
                </span>
                <Button
                  size="sm"
                  disabled={busy === r._id}
                  aria-label={`Accept ${r.other.username}`}
                  onClick={() =>
                    void run(r._id, () =>
                      respond({ requestId: r._id, accept: true }),
                    )
                  }
                >
                  <Check className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy === r._id}
                  aria-label={`Decline ${r.other.username}`}
                  onClick={() =>
                    void run(r._id, () =>
                      respond({ requestId: r._id, accept: false }),
                    )
                  }
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3 className="px-1 pb-2 text-xs font-semibold uppercase tracking-wide text-ash">
          Friends {friends.length > 0 && `(${friends.length})`}
        </h3>
        {friends.length === 0 ? (
          <p className="px-1 text-sm text-ash">
            No friends yet — use Find friends below to send a request.
          </p>
        ) : (
          <ul className="space-y-1">
            {friends.map((f) => {
              const online =
                f.lastActiveAt !== null && now - f.lastActiveAt < ONLINE_WINDOW_MS;
              return (
                <li
                  key={f._id}
                  className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-surface"
                >
                  <Avatar username={f.username} online={online} className="scale-90" />
                  <span className="min-w-0 flex-1 truncate font-display font-semibold">
                    {f.username}
                  </span>
                  {confirmUnfriend === f._id ? (
                    <>
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={busy === f._id}
                        onClick={() =>
                          void run(f._id, async () => {
                            await unfriend({ friendUserId: f._id });
                            setConfirmUnfriend(null);
                          })
                        }
                      >
                        Unfriend
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setConfirmUnfriend(null)}
                      >
                        Keep
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Message ${f.username}`}
                        disabled={busy === f._id}
                        onClick={() =>
                          void run(f._id, async () => {
                            const id = await createConversation({
                              otherUserId: f._id,
                            });
                            onOpenConversation(id);
                          })
                        }
                      >
                        <MessageSquare className="h-4 w-4 text-moss" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Unfriend ${f.username}`}
                        onClick={() => setConfirmUnfriend(f._id)}
                      >
                        <UserMinus className="h-4 w-4 text-ash" />
                      </Button>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {outgoing !== undefined && outgoing.length > 0 && (
        <section>
          <h3 className="px-1 pb-2 text-xs font-semibold uppercase tracking-wide text-ash">
            Sent requests
          </h3>
          <ul className="space-y-1">
            {outgoing.map((r) => (
              <li
                key={r._id}
                className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-ash"
              >
                <Avatar username={r.other.username} className="scale-75" />
                <span className="min-w-0 flex-1 truncate">
                  {r.other.username}
                </span>
                <span className="text-xs">pending</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
