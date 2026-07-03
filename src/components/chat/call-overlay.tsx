"use client";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { Me } from "@/components/chat/types";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { formatDuration } from "@/components/chat/message-bubble";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "convex/react";
import {
  Loader2,
  Mic,
  MicOff,
  MonitorUp,
  Phone,
  PhoneOff,
  Video,
  VideoOff,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Calls (revamp Section 9 + bugfix pass). WebRTC peer-to-peer media; Convex
 * is only the signaling channel. The calls/callSignals schema and signaling
 * logic are untouched by the bugfix — the blank-screen bug was a client
 * lifecycle issue:
 *
 * BUG 1 ROOT CAUSE (rendering layer, not signaling): React StrictMode mounts
 * effects twice in dev. The old setup effect set pcRef during a run that was
 * then cancelled, and the re-run bailed on `pcRef.current` — leaving a
 * PeerConnection with NO tracks attached. ICE happily "connects" the empty
 * session (so the timer ran) over a black screen with no media. Fix: the
 * setup effect now tears down completely in its cleanup (close pc, stop
 * tracks, reset refs) so a re-run rebuilds from scratch, and signal
 * processing waits on `pcReady` instead of racing the async setup.
 */

function iceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [
    {
      urls:
        process.env.NEXT_PUBLIC_STUN_URL ?? "stun:stun.l.google.com:19302",
    },
  ];
  const turnUrl = process.env.NEXT_PUBLIC_TURN_URL;
  if (turnUrl) {
    servers.push({
      urls: turnUrl,
      username: process.env.NEXT_PUBLIC_TURN_USERNAME,
      credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL,
    });
  }
  return servers;
}

export function CallOverlay({
  me,
  callId,
  onOpenCall,
  onClose,
}: {
  me: Me;
  callId: Id<"calls"> | null;
  onOpenCall: (id: Id<"calls">) => void;
  onClose: () => void;
}) {
  const incoming = useQuery(api.calls.myIncomingCall);
  const respondToCall = useMutation(api.calls.respondToCall);

  if (callId === null) {
    if (!incoming) return null;
    return (
      <div className="fixed inset-x-0 top-4 z-50 mx-auto flex w-fit max-w-[92vw] items-center gap-3 rounded-2xl border border-line bg-bg px-4 py-3 shadow-xl animate-message-in">
        <Avatar username={incoming.caller.username} imageUrl={incoming.caller.image} />
        <div className="min-w-0">
          <p className="truncate font-display font-semibold">
            {incoming.caller.username}
          </p>
          <p className="text-xs text-ash">incoming {incoming.type} call…</p>
        </div>
        <Button
          size="icon"
          aria-label="Accept call"
          onClick={() =>
            void respondToCall({ callId: incoming._id, accept: true }).then(
              () => onOpenCall(incoming._id),
            )
          }
        >
          <Phone className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          variant="destructive"
          aria-label="Decline call"
          onClick={() =>
            void respondToCall({ callId: incoming._id, accept: false })
          }
        >
          <PhoneOff className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return <CallPanel key={callId} me={me} callId={callId} onClose={onClose} />;
}

function CallPanel({
  me,
  callId,
  onClose,
}: {
  me: Me;
  callId: Id<"calls">;
  onClose: () => void;
}) {
  const call = useQuery(api.calls.getCall, { callId });
  const signals = useQuery(api.calls.listSignals, { callId });
  const sendSignal = useMutation(api.calls.sendSignal);
  const endCall = useMutation(api.calls.endCall);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const cameraTrackRef = useRef<MediaStreamTrack | null>(null);
  const processedRef = useRef(new Set<string>());
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);
  const endedRef = useRef(false);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);

  const [pcReady, setPcReady] = useState(false);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [connected, setConnected] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const isVideo = call?.type === "video";
  const status = call?.status;
  const callLoaded = call !== undefined && call !== null;

  const hangUp = useCallback(() => {
    if (endedRef.current) return;
    endedRef.current = true;
    void endCall({ callId }).catch(() => {});
    onClose();
  }, [callId, endCall, onClose]);

  // --- Peer connection lifecycle (StrictMode-safe: cleanup fully tears
  // down so a re-run rebuilds from scratch) ---
  useEffect(() => {
    if (!callLoaded) return;
    let cancelled = false;
    let pc: RTCPeerConnection | null = null;
    let stream: MediaStream | null = null;
    const video = call!.type === "video";
    const iAmCaller = call!.iAmCaller;

    async function setup() {
      try {
        pc = new RTCPeerConnection({ iceServers: iceServers() });
        stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video,
        });
        if (cancelled) return; // cleanup below stops everything

        localStreamRef.current = stream;
        cameraTrackRef.current = stream.getVideoTracks()[0] ?? null;
        for (const track of stream.getTracks()) {
          pc.addTrack(track, stream);
        }
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }

        pc.ontrack = (e) => {
          const [remote] = e.streams;
          if (remoteVideoRef.current && remoteVideoRef.current.srcObject !== remote) {
            remoteVideoRef.current.srcObject = remote;
            void remoteVideoRef.current.play().catch(() => {});
          }
          if (remoteAudioRef.current && remoteAudioRef.current.srcObject !== remote) {
            remoteAudioRef.current.srcObject = remote;
            void remoteAudioRef.current.play().catch(() => {});
          }
        };
        pc.onicecandidate = (e) => {
          if (e.candidate) {
            void sendSignal({
              callId,
              type: "ice-candidate",
              payload: JSON.stringify(e.candidate.toJSON()),
            }).catch(() => {});
          }
        };
        pc.onconnectionstatechange = () => {
          if (!pc) return;
          if (pc.connectionState === "connected") {
            setConnected(true);
            setFailed(null);
          }
          if (pc.connectionState === "failed") {
            setFailed(
              "Could not connect — both sides may be behind strict networks (a TURN relay fixes this).",
            );
          }
        };

        pcRef.current = pc;
        setPcReady(true);

        if (iAmCaller) {
          const offer = await pc.createOffer();
          if (cancelled) return;
          await pc.setLocalDescription(offer);
          await sendSignal({
            callId,
            type: "offer",
            payload: JSON.stringify(offer),
          });
        }
      } catch {
        if (!cancelled) {
          setFailed("Could not access your microphone/camera — check browser permissions.");
        }
      }
    }
    void setup();

    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
      pc?.close();
      pcRef.current = null;
      localStreamRef.current = null;
      cameraTrackRef.current = null;
      pendingIceRef.current = [];
      processedRef.current.clear();
      chainRef.current = Promise.resolve();
      setPcReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callLoaded, callId]);

  // --- Process signals sequentially once the pc exists (pcReady closes the
  // race where signals load before async setup finishes) ---
  useEffect(() => {
    const pc = pcRef.current;
    if (!pc || !pcReady || !signals || !call) return;
    const fresh = signals
      .filter(
        (s) => s.fromUserId !== me._id && !processedRef.current.has(s._id),
      )
      .sort((a, b) => a.createdAt - b.createdAt);
    for (const s of fresh) {
      processedRef.current.add(s._id);
      chainRef.current = chainRef.current
        .then(async () => {
          if (pcRef.current !== pc) return; // torn down mid-flight
          if (s.type === "offer" && !call.iAmCaller) {
            // Ignore duplicate offers (e.g. caller remounted in dev).
            if (pc.remoteDescription !== null) return;
            await pc.setRemoteDescription(JSON.parse(s.payload));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            await sendSignal({
              callId,
              type: "answer",
              payload: JSON.stringify(answer),
            });
          } else if (s.type === "answer" && call.iAmCaller) {
            if (pc.remoteDescription !== null) return;
            await pc.setRemoteDescription(JSON.parse(s.payload));
          } else if (s.type === "ice-candidate") {
            const candidate = JSON.parse(s.payload) as RTCIceCandidateInit;
            if (pc.remoteDescription === null) {
              pendingIceRef.current.push(candidate);
            } else {
              await pc.addIceCandidate(candidate);
            }
          }
          if (pc.remoteDescription !== null && pendingIceRef.current.length) {
            const queued = pendingIceRef.current.splice(0);
            for (const c of queued) {
              await pc.addIceCandidate(c);
            }
          }
        })
        .catch(() => {});
    }
  }, [signals, call, callId, me._id, pcReady, sendSignal]);

  // Remote side ended/declined → close.
  useEffect(() => {
    if (status === "ended" || status === "declined" || status === "missed") {
      hangUp();
    }
  }, [status, hangUp]);

  // Caller-side ring timeout.
  useEffect(() => {
    if (!call?.iAmCaller || status !== "ringing") return;
    const t = setTimeout(hangUp, 45_000);
    return () => clearTimeout(t);
  }, [call?.iAmCaller, status, hangUp]);

  // Duration ticker once connected.
  useEffect(() => {
    if (!connected) return;
    const started = Date.now();
    const t = setInterval(
      () => setElapsed(Math.round((Date.now() - started) / 1000)),
      1000,
    );
    return () => clearInterval(t);
  }, [connected]);

  function toggleMute() {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = muted;
    setMuted(!muted);
  }

  function toggleCamera() {
    const track = cameraTrackRef.current;
    if (!track) return;
    track.enabled = cameraOff;
    setCameraOff(!cameraOff);
  }

  async function toggleScreenShare() {
    const pc = pcRef.current;
    const camera = cameraTrackRef.current;
    if (!pc || !camera) return;
    const sender = pc.getSenders().find((x) => x.track?.kind === "video");
    if (!sender) return;
    if (sharing) {
      sender.track?.stop();
      await sender.replaceTrack(camera);
      setSharing(false);
      return;
    }
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({
        video: true,
      });
      const screenTrack = display.getVideoTracks()[0];
      await sender.replaceTrack(screenTrack);
      screenTrack.onended = () => {
        void sender.replaceTrack(camera);
        setSharing(false);
      };
      setSharing(true);
    } catch {
      // User cancelled the picker.
    }
  }

  if (call === undefined) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink">
        <Loader2 className="h-6 w-6 animate-spin text-paper/70" />
      </div>
    );
  }
  if (call === null || call.other === null) return null;

  const statusLine = failed
    ? null
    : status === "ringing"
      ? call.iAmCaller
        ? "ringing…"
        : "connecting…"
      : connected
        ? formatDuration(elapsed)
        : "connecting…";

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-ink text-paper">
      {/* Header — never overlaps controls, sits above the video */}
      <div className="pointer-events-none absolute left-0 right-0 top-0 z-10 bg-gradient-to-b from-ink/80 to-transparent px-4 pb-10 pt-4 text-center">
        <p className="font-display text-lg font-semibold">
          {call.other.username}
        </p>
        {statusLine && (
          <p className="text-sm tabular-nums text-paper/70">{statusLine}</p>
        )}
      </div>

      {/* Media area */}
      <div className="relative min-h-0 flex-1">
        {isVideo ? (
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="h-full w-full bg-black/40 object-contain"
          />
        ) : (
          <>
            <audio ref={remoteAudioRef} autoPlay />
            <div className="flex h-full flex-col items-center justify-center gap-6">
              <Avatar
                username={call.other.username}
                imageUrl={call.other.image}
                className="scale-[2.2]"
              />
              <p className="mt-4 font-display text-2xl font-semibold">
                {call.other.username}
              </p>
            </div>
          </>
        )}

        {/* Connecting / failed overlays — no more silent black screen */}
        {!connected && !failed && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-ink/60">
            <Loader2 className="h-7 w-7 animate-spin text-paper/80" />
            <p className="text-sm text-paper/80">
              {status === "ringing" && call.iAmCaller
                ? `Calling ${call.other.username}…`
                : "Connecting…"}
            </p>
          </div>
        )}
        {failed && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-ink/80 p-6 text-center">
            <p className="max-w-sm text-sm text-paper/90">{failed}</p>
            <Button variant="destructive" onClick={hangUp}>
              Close
            </Button>
          </div>
        )}

        {/* Local self-view: bottom-right, mirrored */}
        {isVideo && (
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className={cn(
              "absolute bottom-3 right-3 z-10 w-28 -scale-x-100 rounded-xl border border-paper/25 bg-black/50 shadow-lg sm:w-36 md:w-44",
              cameraOff && "opacity-30",
              sharing && "scale-x-100", // don't mirror a shared screen
            )}
          />
        )}
      </div>

      {/* Control bar — always visible, safe-area aware */}
      <div className="z-10 flex shrink-0 items-center justify-center gap-3 px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4">
        <Button
          size="icon"
          aria-label={muted ? "Unmute" : "Mute"}
          title={muted ? "Unmute" : "Mute"}
          onClick={toggleMute}
          className={cn(
            "h-13 w-13 rounded-full text-paper",
            muted ? "bg-clay hover:bg-clay/85" : "bg-paper/15 hover:bg-paper/25",
          )}
        >
          {muted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
        </Button>
        {isVideo && (
          <>
            <Button
              size="icon"
              aria-label={cameraOff ? "Turn camera on" : "Turn camera off"}
              title={cameraOff ? "Camera on" : "Camera off"}
              onClick={toggleCamera}
              className={cn(
                "h-13 w-13 rounded-full text-paper",
                cameraOff
                  ? "bg-clay hover:bg-clay/85"
                  : "bg-paper/15 hover:bg-paper/25",
              )}
            >
              {cameraOff ? (
                <VideoOff className="h-5 w-5" />
              ) : (
                <Video className="h-5 w-5" />
              )}
            </Button>
            <Button
              size="icon"
              aria-label={sharing ? "Stop sharing screen" : "Share screen"}
              title={sharing ? "Stop sharing" : "Share screen"}
              onClick={() => void toggleScreenShare()}
              className={cn(
                "h-13 w-13 rounded-full text-paper",
                sharing
                  ? "bg-clay hover:bg-clay/85"
                  : "bg-paper/15 hover:bg-paper/25",
              )}
            >
              <MonitorUp className="h-5 w-5" />
            </Button>
          </>
        )}
        <Button
          size="icon"
          aria-label="End call"
          title="End call"
          onClick={hangUp}
          className="h-13 w-13 rounded-full bg-red-600 text-paper hover:bg-red-700"
        >
          <PhoneOff className="h-5 w-5" />
        </Button>
      </div>
    </div>
  );
}
