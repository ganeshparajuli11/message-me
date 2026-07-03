"use client";

import { api } from "../../../convex/_generated/api";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { Check, Loader2, Search, UserPlus } from "lucide-react";
import { useEffect, useState } from "react";

/** "Find Friends" search + request sending (revamp Section 2). */
export function FindFriendsDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const sendFriendRequest = useMutation(api.friends.sendFriendRequest);
  const respondToFriendRequest = useMutation(api.friends.respondToFriendRequest);
  const incoming = useQuery(
    api.friends.listFriendRequests,
    open ? { direction: "incoming" } : "skip",
  );

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const results = useQuery(
    api.friends.searchUsers,
    open && debounced.length >= 2 ? { query: debounced } : "skip",
  );

  async function handleAdd(userId: string) {
    setBusyId(userId);
    setError(null);
    try {
      await sendFriendRequest({
        receiverId: userId as Parameters<typeof sendFriendRequest>[0]["receiverId"],
      });
    } catch (err) {
      setError(
        err instanceof ConvexError && typeof err.data === "string"
          ? err.data
          : "Could not send the request",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function handleAccept(userId: string) {
    const req = (incoming ?? []).find((r) => r.other._id === userId);
    if (!req) return;
    setBusyId(userId);
    try {
      await respondToFriendRequest({ requestId: req._id, accept: true });
    } catch {
      setError("Could not accept the request");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Find friends">
      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ash" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by username…"
            className="pl-9"
            autoFocus
          />
        </div>
        {error && <p className="text-xs text-clay">{error}</p>}

        {debounced.length < 2 ? (
          <p className="py-4 text-center text-xs text-ash">
            Type at least two characters to search.
          </p>
        ) : results === undefined ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-ash" />
          </div>
        ) : results.length === 0 ? (
          <p className="py-4 text-center text-xs text-ash">
            No one found with that username.
          </p>
        ) : (
          <ul className="max-h-72 space-y-1 overflow-y-auto">
            {results.map((u) => (
              <li
                key={u._id}
                className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-surface"
              >
                <Avatar username={u.username} imageUrl={u.image} className="scale-90" />
                <span className="min-w-0 flex-1 truncate font-display font-semibold">
                  {u.username}
                </span>
                {u.state === "friends" ? (
                  <span className="flex items-center gap-1 text-xs text-moss">
                    <Check className="h-3.5 w-3.5" /> Friends
                  </span>
                ) : u.state === "outgoing" ? (
                  <span className="text-xs text-ash">Requested</span>
                ) : u.state === "incoming" ? (
                  <Button
                    size="sm"
                    disabled={busyId === u._id}
                    onClick={() => void handleAccept(u._id)}
                  >
                    Accept
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="accent"
                    disabled={busyId === u._id}
                    onClick={() => void handleAdd(u._id)}
                  >
                    {busyId === u._id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <>
                        <UserPlus className="h-3.5 w-3.5" /> Add
                      </>
                    )}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
