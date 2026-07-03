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
 * Calls (revamp Section 9). WebRTC peer-to-peer media; Convex is only the
 * signaling channel (offer/answer/ICE via calls.sendSignal/listSignals).
 *
 * ICE servers: a public STUN by default; the buyer's self-hosted coturn TURN
 * relay via NEXT_PUBLIC_TURN_* env vars (see deploy/coturn/). Kept
 * deliberately light: one component, no renegotiation — screen share swaps
 * the video track with RTCRtpSender.replaceTrack.
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

  // Incoming-call banner (only when not already in a call).
  if (callId === null) {
    if (!incoming) return null;
    return (
      <div className="fixed inset-x-0 top-4 z-50 mx-auto flex w-fit max-w-[92vw] items-center gap-3 rounded-2xl border border-line bg-bg px-4 py-3 shadow-xl animate-message-in">
        <Avatar username={incoming.caller.username} />
        <div className="min-w-0">
          <p className="truncate font-display font-semibold">
            {incoming.caller.username}
          </p>
          <p className="text-xs text-ash">
            incoming {incoming.type} call…
          </p>
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
  const offerSentRef = useRef(false);
  const closedRef = useRef(false);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);

  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [connected, setConnected] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const isVideo = call?.type === "video";
  const status = call?.status;

  const hangUp = useCallback(() => {
    if (closedRef.current) return;
    closedRef.current = true;
    void endCall({ callId }).catch(() => {});
    pcRef.current?.close();
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    onClose();
  }, [callId, endCall, onClose]);

  // --- Peer connection setup (once per call) ---
  useEffect(() => {
    if (call === undefined || call === null || pcRef.current) return;
    let cancelled = false;

    async function setup() {
      try {
        const pc = new RTCPeerConnection({ iceServers: iceServers() });
        pcRef.current = pc;

        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: call!.type === "video",
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
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
          if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remote;
          if (remoteAudioRef.current) remoteAudioRef.current.srcObject = remote;
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
          if (pc.connectionState === "connected") setConnected(true);
          if (["failed", "closed"].includes(pc.connectionState)) hangUp();
        };

        // Caller creates the offer immediately; the callee (mounted only
        // after accepting) reads it from the signal log.
        if (call!.iAmCaller && !offerSentRef.current) {
          offerSentRef.current = true;
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          await sendSignal({
            callId,
            type: "offer",
            payload: JSON.stringify(offer),
          });
        }
      } catch {
        setError("Could not access microphone/camera");
      }
    }
    void setup();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call === undefined || call === null]);

  // --- Process incoming signals sequentially ---
  useEffect(() => {
    const pc = pcRef.current;
    if (!pc || !signals || !call) return;
    const mine = signals
      .filter(
        (s) => s.fromUserId !== me._id && !processedRef.current.has(s._id),
      )
      .sort((a, b) => a.createdAt - b.createdAt);
    for (const s of mine) {
      processedRef.current.add(s._id);
      chainRef.current = chainRef.current
        .then(async () => {
          if (s.type === "offer" && !call.iAmCaller) {
            await pc.setRemoteDescription(JSON.parse(s.payload));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            await sendSignal({
              callId,
              type: "answer",
              payload: JSON.stringify(answer),
            });
          } else if (s.type === "answer" && call.iAmCaller) {
            await pc.setRemoteDescription(JSON.parse(s.payload));
          } else if (s.type === "ice-candidate") {
            const candidate = JSON.parse(s.payload) as RTCIceCandidateInit;
            if (pc.remoteDescription === null) {
              pendingIceRef.current.push(candidate);
            } else {
              await pc.addIceCandidate(candidate);
            }
          }
          // Flush ICE queued before the remote description arrived.
          if (pc.remoteDescription !== null && pendingIceRef.current.length) {
            const queued = pendingIceRef.current.splice(0);
            for (const c of queued) {
              await pc.addIceCandidate(c);
            }
          }
        })
        .catch(() => {});
    }
  }, [signals, call, callId, me._id, sendSignal]);

  // --- React to remote status changes ---
  useEffect(() => {
    if (status === "ended" || status === "declined" || status === "missed") {
      hangUp();
    }
  }, [status, hangUp]);

  // Ring timeout safety on the caller side.
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
      // User cancelled the picker — nothing to do.
    }
  }

  if (call === undefined) return null;
  if (call === null || call.other === null) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-ink text-paper">
      {/* Remote media */}
      <div className="relative min-h-0 flex-1">
        {isVideo ? (
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="h-full w-full object-contain"
          />
        ) : (
          <>
            <audio ref={remoteAudioRef} autoPlay />
            <div className="flex h-full flex-col items-center justify-center gap-4">
              <Avatar username={call.other.username} className="scale-[2.2]" />
              <p className="mt-6 font-display text-2xl font-semibold">
                {call.other.username}
              </p>
            </div>
          </>
        )}

        {/* Local preview (video calls) */}
        {isVideo && (
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className={cn(
              "absolute bottom-4 right-4 w-32 rounded-xl border border-paper/20 shadow-lg md:w-44",
              cameraOff && "opacity-30",
            )}
          />
        )}

        <div className="absolute left-0 right-0 top-4 text-center">
          <p className="font-display text-lg">{call.other.username}</p>
          <p className="text-sm text-paper/70">
            {error ??
              (status === "ringing"
                ? call.iAmCaller
                  ? "ringing…"
                  : "connecting…"
                : connected
                  ? formatDuration(elapsed)
                  : "connecting…")}
          </p>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-center gap-3 p-5">
        <Button
          size="icon"
          variant={muted ? "accent" : "ghost"}
          aria-label={muted ? "Unmute" : "Mute"}
          onClick={toggleMute}
          className="h-12 w-12 rounded-full bg-paper/10 text-paper hover:bg-paper/20"
        >
          {muted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
        </Button>
        {isVideo && (
          <>
            <Button
              size="icon"
              variant={cameraOff ? "accent" : "ghost"}
              aria-label={cameraOff ? "Turn camera on" : "Turn camera off"}
              onClick={toggleCamera}
              className="h-12 w-12 rounded-full bg-paper/10 text-paper hover:bg-paper/20"
            >
              {cameraOff ? (
                <VideoOff className="h-5 w-5" />
              ) : (
                <Video className="h-5 w-5" />
              )}
            </Button>
            <Button
              size="icon"
              variant={sharing ? "accent" : "ghost"}
              aria-label={sharing ? "Stop sharing screen" : "Share screen"}
              onClick={() => void toggleScreenShare()}
              className={cn(
                "h-12 w-12 rounded-full text-paper",
                sharing ? "bg-clay hover:bg-clay/80" : "bg-paper/10 hover:bg-paper/20",
              )}
            >
              <MonitorUp className="h-5 w-5" />
            </Button>
          </>
        )}
        <Button
          size="icon"
          variant="destructive"
          aria-label="End call"
          onClick={hangUp}
          className="h-12 w-12 rounded-full"
        >
          <PhoneOff className="h-5 w-5" />
        </Button>
      </div>
    </div>
  );
}
