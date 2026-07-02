"use client";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

export function NewChatDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: Id<"conversations">) => void;
}) {
  const [username, setUsername] = useState("");
  const [debounced, setDebounced] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const createConversation = useMutation(api.conversations.createConversation);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(username.trim()), 300);
    return () => clearTimeout(t);
  }, [username]);

  const found = useQuery(
    api.users.getUserByUsername,
    open && debounced.length >= 3 ? { username: debounced } : "skip",
  );

  async function handleCreate() {
    if (!found) return;
    setCreating(true);
    setError(null);
    try {
      const id = await createConversation({ otherUserId: found._id });
      setUsername("");
      onCreated(id);
    } catch (err) {
      setError(
        err instanceof ConvexError && typeof err.data === "string"
          ? err.data
          : "Could not start the conversation",
      );
    } finally {
      setCreating(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="New note">
      <div className="space-y-3">
        <Input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Exact username, e.g. quiet_wren"
          autoFocus
        />
        {debounced.length >= 3 && found === undefined && (
          <p className="flex items-center gap-2 text-xs text-ash">
            <Loader2 className="h-3 w-3 animate-spin" /> Looking up…
          </p>
        )}
        {debounced.length >= 3 && found === null && (
          <p className="text-xs text-ash">No active user with that username.</p>
        )}
        {found && (
          <p className="text-xs text-moss">Found @{found.username}</p>
        )}
        {error && <p className="text-xs text-clay">{error}</p>}
        <Button
          className="w-full"
          disabled={!found || creating}
          onClick={() => void handleCreate()}
        >
          {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : "Start chatting"}
        </Button>
      </div>
    </Dialog>
  );
}
