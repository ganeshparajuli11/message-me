"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * MediaRecorder-based voice capture (revamp Section 8).
 * Format: prefers audio/webm;codecs=opus, falls back to audio/mp4 (Safari's
 * MediaRecorder records AAC in an MP4 container and does not support webm).
 * Record-then-upload — no streaming, no WebRTC.
 */
export function pickAudioMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  for (const t of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return "";
}

export type VoiceRecording = {
  blob: Blob;
  mimeType: string;
  durationSeconds: number;
};

export function useVoiceRecorder() {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const resolveRef = useRef<((r: VoiceRecording | null) => void) | null>(null);

  const cleanup = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    recorderRef.current?.stream.getTracks().forEach((t) => t.stop());
    recorderRef.current = null;
    setRecording(false);
    setSeconds(0);
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const start = useCallback(async () => {
    setError(null);
    if (typeof MediaRecorder === "undefined") {
      setError("Voice recording isn't supported in this browser");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickAudioMimeType();
      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined,
      );
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const durationSeconds = Math.max(
          1,
          Math.round((Date.now() - startedAtRef.current) / 1000),
        );
        const type = recorder.mimeType || mimeType || "audio/webm";
        // Normalize the container type (strip codec suffix for upload header).
        const blob = new Blob(chunksRef.current, {
          type: type.split(";")[0],
        });
        resolveRef.current?.({ blob, mimeType: blob.type, durationSeconds });
        resolveRef.current = null;
        cleanup();
      };
      recorderRef.current = recorder;
      startedAtRef.current = Date.now();
      recorder.start(250);
      setRecording(true);
      setSeconds(0);
      timerRef.current = setInterval(
        () =>
          setSeconds(Math.round((Date.now() - startedAtRef.current) / 1000)),
        500,
      );
    } catch {
      setError("Microphone access was denied");
    }
  }, [cleanup]);

  /** Stops and resolves with the finished recording. */
  const stop = useCallback((): Promise<VoiceRecording | null> => {
    return new Promise((resolve) => {
      const recorder = recorderRef.current;
      if (!recorder || recorder.state === "inactive") {
        resolve(null);
        cleanup();
        return;
      }
      resolveRef.current = resolve;
      recorder.stop();
    });
  }, [cleanup]);

  /** Discards the recording. */
  const cancel = useCallback(() => {
    const recorder = recorderRef.current;
    resolveRef.current = null;
    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = null;
      recorder.stop();
    }
    cleanup();
  }, [cleanup]);

  return { recording, seconds, error, start, stop, cancel };
}
