"use client";

import { Download, Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";
/* eslint-disable @next/next/no-img-element */

/**
 * Full-screen image lightbox (revamp Section 7): click-to-expand, download,
 * close on Escape/backdrop. Download goes fetch→blob→anchor so it works even
 * if the storage response headers don't honor the `download` attribute
 * cross-origin.
 */
export function Lightbox({
  imageUrl,
  onClose,
}: {
  imageUrl: string;
  onClose: () => void;
}) {
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function download() {
    setDownloading(true);
    try {
      const res = await fetch(imageUrl);
      const blob = await res.blob();
      const ext = (blob.type.split("/")[1] ?? "jpg").replace("jpeg", "jpg");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `inkwell-image-${Date.now()}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      // Fall back to opening in a new tab if fetch is blocked.
      window.open(imageUrl, "_blank", "noopener");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Image preview"
      onClick={onClose}
    >
      <div className="absolute right-4 top-4 flex gap-2">
        <button
          aria-label="Download image"
          onClick={(e) => {
            e.stopPropagation();
            void download();
          }}
          className="rounded-full bg-paper/10 p-2.5 text-paper hover:bg-paper/20 cursor-pointer"
        >
          {downloading ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <Download className="h-5 w-5" />
          )}
        </button>
        <button
          aria-label="Close preview"
          onClick={onClose}
          className="rounded-full bg-paper/10 p-2.5 text-paper hover:bg-paper/20 cursor-pointer"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
      <img
        src={imageUrl}
        alt="Full size"
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90dvh] max-w-[92vw] rounded-xl object-contain shadow-2xl"
      />
    </div>
  );
}
