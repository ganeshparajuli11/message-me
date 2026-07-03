/**
 * Client-side image compression (polish Section 7): canvas downscale +
 * re-encode, iterating quality/dimensions until under the cap. Hitting the
 * hard error should be rare — compression is the primary UX, rejection the
 * fallback. GIFs are passed through untouched (canvas would kill animation).
 */

const MAX_DIMENSION_STEPS = [2048, 1600, 1280, 1024];
const QUALITY_STEPS = [0.85, 0.7, 0.55, 0.4];

export async function compressImage(
  file: File,
  maxBytes: number,
): Promise<File> {
  // Already small enough — send as-is.
  if (file.size <= maxBytes) return file;
  // Animated formats can't round-trip through a canvas.
  if (file.type === "image/gif") {
    throw new Error("GIF is too large (max 5 MB) — please choose a smaller one");
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("Could not read this image file");
  }

  try {
    for (const maxDim of MAX_DIMENSION_STEPS) {
      const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Could not process the image");
      ctx.drawImage(bitmap, 0, 0, width, height);

      for (const quality of QUALITY_STEPS) {
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, "image/jpeg", quality),
        );
        if (blob && blob.size <= maxBytes) {
          return new File(
            [blob],
            file.name.replace(/\.[^.]+$/, "") + ".jpg",
            { type: "image/jpeg" },
          );
        }
      }
    }
  } finally {
    bitmap.close();
  }
  throw new Error("Image too large even after compression — please choose a smaller file");
}
