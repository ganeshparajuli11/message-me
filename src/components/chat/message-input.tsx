"use client";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  IMAGE_ALLOWED_TYPES,
  IMAGE_MAX_BYTES,
  MESSAGE_MAX_LENGTH,
} from "../../../convex/lib/validation";
import { formatDuration } from "@/components/chat/message-bubble";
import { compressImage } from "@/lib/compress-image";
import {
  useVoiceRecorder,
  type VoiceRecording,
} from "@/hooks/use-voice-recorder";
import { useMutation } from "convex/react";
import { ImagePlus, Mic, SendHorizonal, Square, Trash2 } from "lucide-react";
import { useRef, useState } from "react";

export function MessageInput({
  conversationId,
  disabled,
  onSendText,
  onSendImage,
  onSendVoice,
}: {
  conversationId: Id<"conversations">;
  disabled: boolean;
  onSendText: (text: string) => void;
  onSendImage: (file: File) => void;
  onSendVoice: (recording: VoiceRecording) => void;
}) {
  const [text, setText] = useState("");
  const [imageError, setImageError] = useState<string | null>(null);
  const [compressing, setCompressing] = useState(false);
  // Voice UX decision (flagged): tap-to-start / tap-to-stop, not
  // hold-to-record — simpler and more reliable across devices.
  const recorder = useVoiceRecorder();
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

  // Polish Section 7: compress client-side toward the 5 MB cap instead of
  // rejecting outright — the error is the rare fallback, not the UX.
  async function handleFile(file: File | undefined) {
    setImageError(null);
    if (!file) return;
    if (!IMAGE_ALLOWED_TYPES.includes(file.type)) {
      setImageError("Only JPEG, PNG, GIF or WebP images");
      return;
    }
    try {
      setCompressing(true);
      const ready =
        file.size > IMAGE_MAX_BYTES
          ? await compressImage(file, IMAGE_MAX_BYTES)
          : file;
      onSendImage(ready);
    } catch (err) {
      setImageError(
        err instanceof Error ? err.message : "Could not process the image",
      );
    } finally {
      setCompressing(false);
    }
  }

  async function finishRecording() {
    const result = await recorder.stop();
    if (result) onSendVoice(result);
  }

  if (recorder.recording) {
    return (
      <div className="border-t border-line bg-surface/50 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="flex items-center gap-3">
          <span className="flex h-10 flex-1 items-center gap-3 rounded-xl border border-clay/40 bg-bg px-4">
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-clay" />
            <span className="text-sm text-fg">Recording…</span>
            <span className="ml-auto text-sm tabular-nums text-ash">
              {formatDuration(recorder.seconds)}
            </span>
          </span>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Discard recording"
            onClick={() => recorder.cancel()}
          >
            <Trash2 className="h-5 w-5 text-ash" />
          </Button>
          <Button
            variant="accent"
            size="icon"
            aria-label="Stop and send"
            onClick={() => void finishRecording()}
            className="rounded-xl"
          >
            <Square className="h-4 w-4 fill-current" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="border-t border-line bg-surface/50 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      {imageError && <p className="mb-2 text-xs text-clay">{imageError}</p>}
      {compressing && (
        <p className="mb-2 text-xs text-ash">Optimizing image…</p>
      )}
      {recorder.error && (
        <p className="mb-2 text-xs text-clay">{recorder.error}</p>
      )}
      <div className="flex items-end gap-2">
        <input
          ref={fileRef}
          type="file"
          accept={IMAGE_ALLOWED_TYPES.join(",")}
          className="hidden"
          onChange={(e) => {
            void handleFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <Button
          variant="ghost"
          size="icon"
          aria-label="Attach image"
          disabled={disabled || compressing}
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
        {text.trim().length === 0 ? (
          <Button
            variant="accent"
            size="icon"
            aria-label="Record a voice note"
            disabled={disabled}
            onClick={() => void recorder.start()}
            className="rounded-xl"
          >
            <Mic className="h-5 w-5" />
          </Button>
        ) : (
          <Button
            variant="accent"
            size="icon"
            aria-label="Send"
            disabled={disabled}
            onClick={submit}
            className="rounded-xl"
          >
            <SendHorizonal className="h-5 w-5" />
          </Button>
        )}
      </div>
    </div>
  );
}
