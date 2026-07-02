"use client";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  IMAGE_ALLOWED_TYPES,
  IMAGE_MAX_BYTES,
  MESSAGE_MAX_LENGTH,
} from "../../../convex/lib/validation";
import { useMutation } from "convex/react";
import { ImagePlus, SendHorizonal } from "lucide-react";
import { useRef, useState } from "react";

export function MessageInput({
  conversationId,
  disabled,
  onSendText,
  onSendImage,
}: {
  conversationId: Id<"conversations">;
  disabled: boolean;
  onSendText: (text: string) => void;
  onSendImage: (file: File) => void;
}) {
  const [text, setText] = useState("");
  const [imageError, setImageError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const lastTypingSentAt = useRef(0);
  const setTyping = useMutation(api.typing.setTyping);

  function handleChange(value: string) {
    setText(value);
    // Typing signal, throttled client-side to ~1/sec (spec Section 5).
    const now = Date.now();
    if (value.length > 0 && now - lastTypingSentAt.current > 1000) {
      lastTypingSentAt.current = now;
      void setTyping({ conversationId }).catch(() => {});
    }
  }

  function submit() {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    setText("");
    onSendText(trimmed);
  }

  function handleFile(file: File | undefined) {
    setImageError(null);
    if (!file) return;
    if (!IMAGE_ALLOWED_TYPES.includes(file.type)) {
      setImageError("Only JPEG, PNG, GIF or WebP images");
      return;
    }
    if (file.size > IMAGE_MAX_BYTES) {
      setImageError("Image too large (max 5 MB)");
      return;
    }
    onSendImage(file);
  }

  return (
    <div className="border-t border-line bg-surface/50 p-3">
      {imageError && <p className="mb-2 text-xs text-clay">{imageError}</p>}
      <div className="flex items-end gap-2">
        <input
          ref={fileRef}
          type="file"
          accept={IMAGE_ALLOWED_TYPES.join(",")}
          className="hidden"
          onChange={(e) => {
            handleFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <Button
          variant="ghost"
          size="icon"
          aria-label="Attach image"
          disabled={disabled}
          onClick={() => fileRef.current?.click()}
        >
          <ImagePlus className="h-5 w-5 text-ash" />
        </Button>
        <textarea
          value={text}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={1}
          maxLength={MESSAGE_MAX_LENGTH}
          disabled={disabled}
          placeholder={disabled ? "Messaging unavailable" : "Write a note…"}
          className="max-h-32 min-h-10 flex-1 resize-none rounded-xl border border-line bg-bg px-3 py-2.5 text-sm placeholder:text-ash focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-moss/40 disabled:opacity-50"
        />
        <Button
          variant="accent"
          size="icon"
          aria-label="Send"
          disabled={disabled || text.trim().length === 0}
          onClick={submit}
          className="rounded-xl"
        >
          <SendHorizonal className="h-5 w-5" />
        </Button>
      </div>
    </div>
  );
}
