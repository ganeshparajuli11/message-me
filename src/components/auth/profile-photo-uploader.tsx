"use client";

import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { compressImage } from "@/lib/compress-image";
import { useUser } from "@clerk/nextjs";
import { Camera, Loader2, Upload } from "lucide-react";
import { useRef, useState } from "react";

const CLERK_AVATAR_MAX_BYTES = 10 * 1024 * 1024;

export function ProfilePhotoUploader({
  username,
}: {
  username: string;
}) {
  const { user } = useUser();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function onPick(file: File | undefined) {
    if (!file || !user) return;
    setError(null);
    setSuccess(null);

    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file");
      return;
    }

    try {
      setBusy(true);
      setOptimizing(file.size > CLERK_AVATAR_MAX_BYTES);
      const ready =
        file.size > CLERK_AVATAR_MAX_BYTES
          ? await compressImage(file, CLERK_AVATAR_MAX_BYTES)
          : file;
      await user.setProfileImage({ file: ready });
      await user.reload();
      setSuccess("Profile photo updated");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not upload profile photo",
      );
    } finally {
      setBusy(false);
      setOptimizing(false);
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          void onPick(e.target.files?.[0]);
          e.target.value = "";
        }}
      />

      <Button
        variant="ghost"
        size="icon"
        aria-label="Update profile photo"
        onClick={() => setOpen(true)}
      >
        <Camera className="h-4 w-4" />
      </Button>

      <Dialog open={open} onClose={() => setOpen(false)} title="Update profile photo">
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-xl border border-line bg-surface/60 p-3">
            <Avatar username={username} imageUrl={user?.imageUrl ?? null} />
            <div>
              <p className="text-sm font-medium">Upload a new profile image</p>
              <p className="text-xs text-ash">
                Large images are automatically compressed before upload.
              </p>
            </div>
          </div>

          {error && <p className="text-xs text-clay">{error}</p>}
          {success && <p className="text-xs text-moss">{success}</p>}
          {optimizing && (
            <p className="text-xs text-ash">Optimizing image before upload...</p>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              Close
            </Button>
            <Button
              variant="accent"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
            >
              {busy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Uploading
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4" />
                  Choose image
                </>
              )}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
