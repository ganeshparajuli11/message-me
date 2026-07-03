"use client";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { Me } from "@/components/chat/types";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { formatDuration } from "@/components/chat/message-bubble";
import { useNow } from "@/hooks/use-now";
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
 * Calls (revamp Section 9 + bugfix + final polish).
 * WebRTC peer-to-peer media; Convex is only the signaling channel.
 *
 * Polish pass additions:
 * - Persistent "call in progress" bar when a live call exists server-side
 *   but the full screen isn't open (e.g. after a reload) — tap to return,
 *   with an inline end-call control. (Section 1)
 * - Peer state (camera off / presenting) is exchanged over a WebRTC DATA
 *   CHANNEL — no schema changes — driving camera-off avatar tiles and
 *   "You're presenting" / "X is sharing their screen" indicators. (3, 4)
 * - Camera video renders object-cover (fills the stage, no side gap);
 *   screen shares render object-contain so content isn't cropped. (9)
 * - Rejoin: the caller side re-offers on remount; the callee rebuilds its
 *   peer connection when a newer offer arrives (renegotiation-lite).
 */

type PeerState = { cameraOff: boolean; sharing: boolean };

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
  const activeCall = useQuery(api.calls.myActiveCall);
  const respondToCall = useMutation(api.calls.respondToCall);
  const endCall = useMutation(api.calls.endCall);
  const now = useNow(1000);

  if (callId === null) {
    if (incoming) {
      return (
        <div className="fixed inset-x-0 top-4 z-50 mx-auto flex w-fit max-w-[92vw] items-center gap-3 rounded-2xl border border-line bg-bg px-4 py-3 shadow-xl animate-message-in">
          <Avatar
            username={incoming.caller.username}
            imageUrl={incoming.caller.image}
          />
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

    // Polish Section 1: live call exists but the call screen is closed
    // (e.g. after a page reload) — persistent, controllable bar.
    if (activeCall) {
      return (
        <div className="fixed inset-x-0 top-4 z-50 mx-auto flex w-fit max-w-[92vw] items-center gap-3 rounded-full border border-moss/40 bg-moss px-4 py-2 text-paper shadow-xl animate-message-in">
          <button
            className="flex min-w-0 items-center gap-2 cursor-pointer"
            onClick={() => onOpenCall(activeCall._id)}
            title="Return to call"
          >
            {activeCall.type === "video" ? (
              <Video className="h-4 w-4 shrink-0" />
            ) : (
              <Phone className="h-4 w-4 shrink-0" />
            )}
            <span className="truncate text-sm font-medium">
              {activeCall.status === "ringing" ? "Calling" : "In call with"}{" "}
              {activeCall.other.username}
            </span>
            <span className="text-xs tabular-nums text-paper/80">
              {formatDuration(
                Math.max(0, Math.round((now - activeCall.startedAt) / 1000)),
              )}
            </span>
          </button>
          <button
            aria-label="End call"
            title="End call"
            onClick={() => void endCall({ callId: activeCall._id })}
            className="rounded-full bg-red-600 p-1.5 hover:bg-red-700 cursor-pointer"
          >
            <PhoneOff className="h-3.5 w-3.5" />
          </button>
        </div>
      );
    }
    return null;
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
  const channelRef = useRef<RTCDataChannel | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const cameraTrackRef = useRef<MediaStreamTrack | null>(null);
  const processedRef = useRef(new Set<string>());
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);
  const offerSentAtRef = useRef(0);
  const acceptedOfferAtRef = useRef(0);
  const endedRef = useRef(false);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);

  const [epoch, setEpoch] = useState(0); // bump to rebuild the peer connection
  const [pcReady, setPcReady] = useState(false);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [remoteState, setRemoteState] = useState<PeerState>({
    cameraOff: false,
    sharing: false,
  });
  const [localPortrait, setLocalPortrait] = useState(false);
  const [remotePortrait, setRemotePortrait] = useState(false);
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

  // --- Peer connection lifecycle (StrictMode-safe; epoch bumps rebuild) ---
  useEffect(() => {
    if (!callLoaded) return;
    let cancelled = false;
    let pc: RTCPeerConnection | null = null;
    let stream: MediaStream | null = null;
    const video = call!.type === "video";
    const iAmCaller = call!.iAmCaller;

    const wireChannel = (channel: RTCDataChannel) => {
      channelRef.current = channel;
      channel.onmessage = (e) => {
        try {
          const state = JSON.parse(e.data) as PeerState;
          setRemoteState(state);
        } catch {
          /* ignore malformed */
        }
      };
      channel.onopen = () => {
        // Announce current state as soon as the channel is live.
        channel.send(
          JSON.stringify({
            cameraOff: !(cameraTrackRef.current?.enabled ?? true),
            sharing: false,
          } satisfies PeerState),
        );
      };
    };

    async function setup() {
      try {
        pc = new RTCPeerConnection({ iceServers: iceServers() });
        stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video,
        });
        if (cancelled) return;

        localStreamRef.current = stream;
        cameraTrackRef.current = stream.getVideoTracks()[0] ?? null;
        for (const track of stream.getTracks()) {
          pc.addTrack(track, stream);
        }
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
          localVideoRef.current.onloadedmetadata = () => {
            const el = localVideoRef.current;
            if (!el) return;
            setLocalPortrait(el.videoHeight > el.videoWidth);
          };
        }

        // Peer-state sync channel (camera off / presenting) — polish 3+4.
        if (iAmCaller) {
          wireChannel(pc.createDataChannel("state"));
        } else {
          pc.ondatachannel = (e) => wireChannel(e.channel);
        }

        pc.ontrack = (e) => {
          const [remote] = e.streams;
          if (
            remoteVideoRef.current &&
            remoteVideoRef.current.srcObject !== remote
          ) {
            remoteVideoRef.current.srcObject = remote;
            remoteVideoRef.current.onloadedmetadata = () => {
              const el = remoteVideoRef.current;
              if (!el) return;
              setRemotePortrait(el.videoHeight > el.videoWidth);
            };
            void remoteVideoRef.current.play().catch(() => {});
          }
          if (
            remoteAudioRef.current &&
            remoteAudioRef.current.srcObject !== remote
          ) {
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
          offerSentAtRef.current = Date.now();
          await sendSignal({
            callId,
            type: "offer",
            payload: JSON.stringify(offer),
          });
        }
      } catch {
        if (!cancelled) {
          setFailed(
            "Could not access your microphone/camera — check browser permissions.",
          );
        }
      }
    }
    void setup();

    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
      channelRef.current = null;
      pc?.close();
      pcRef.current = null;
      localStreamRef.current = null;
      cameraTrackRef.current = null;
      pendingIceRef.current = [];
      processedRef.current.clear();
      chainRef.current = Promise.resolve();
      acceptedOfferAtRef.current = 0;
      setPcReady(false);
      setConnected(false);
      setSharing(false);
      setCameraOff(false);
      setLocalPortrait(false);
      setRemotePortrait(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callLoaded, callId, epoch]);

  // Broadcast local state changes to the peer.
  useEffect(() => {
    const channel = channelRef.current;
    if (channel && channel.readyState === "open") {
      channel.send(JSON.stringify({ cameraOff, sharing } satisfies PeerState));
    }
  }, [cameraOff, sharing, connected]);

  // --- Process signals sequentially once the pc exists ---
  useEffect(() => {
    const pc = pcRef.current;
    if (!pc || !pcReady || !signals || !call) return;

    const remote = signals
      .filter((s) => s.fromUserId !== me._id)
      .sort((a, b) => a.createdAt - b.createdAt);

    // Rejoin support: only the NEWEST offer matters. Mark older ones done.
    const offers = remote.filter((s) => s.type === "offer");
    const newestOffer = offers[offers.length - 1];
    for (const o of offers) {
      if (newestOffer && o._id !== newestOffer._id) {
        processedRef.current.add(o._id);
      }
    }
    // A newer offer than the one this pc accepted → the caller rebuilt
    // (e.g. returned after a reload). Rebuild our side too.
    if (
      !call.iAmCaller &&
      newestOffer &&
      acceptedOfferAtRef.current !== 0 &&
      newestOffer.createdAt > acceptedOfferAtRef.current &&
      !processedRef.current.has(newestOffer._id)
    ) {
      setEpoch((e) => e + 1);
      return;
    }

    const fresh = remote.filter((s) => !processedRef.current.has(s._id));
    for (const s of fresh) {
      processedRef.current.add(s._id);
      chainRef.current = chainRef.current
        .then(async () => {
          if (pcRef.current !== pc) return;
          if (s.type === "offer" && !call.iAmCaller) {
            if (pc.remoteDescription !== null) return;
            acceptedOfferAtRef.current = s.createdAt;
            await pc.setRemoteDescription(JSON.parse(s.payload));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            await sendSignal({
              callId,
              type: "answer",
              payload: JSON.stringify(answer),
            });
          } else if (s.type === "answer" && call.iAmCaller) {
            // Ignore stale answers to offers from a previous session.
            if (pc.remoteDescription !== null) return;
            if (s.createdAt < offerSentAtRef.current) return;
            await pc.setRemoteDescription(JSON.parse(s.payload));
          } else if (s.type === "ice-candidate") {
            const candidate = JSON.parse(s.payload) as RTCIceCandidateInit;
            if (pc.remoteDescription === null) {
              pendingIceRef.current.push(candidate);
            } else {
              await pc.addIceCandidate(candidate).catch(() => {});
            }
          }
          if (pc.remoteDescription !== null && pendingIceRef.current.length) {
            const queued = pendingIceRef.current.splice(0);
            for (const c of queued) {
              await pc.addIceCandidate(c).catch(() => {});
            }
          }
        })
        .catch(() => {});
    }
  }, [signals, call, callId, me._id, pcReady, sendSignal]);

  useEffect(() => {
    if (status === "ended" || status === "declined" || status === "missed") {
      hangUp();
    }
  }, [status, hangUp]);

  useEffect(() => {
    if (!call?.iAmCaller || status !== "ringing") return;
    const t = setTimeout(hangUp, 45_000);
    return () => clearTimeout(t);
  }, [call?.iAmCaller, status, hangUp]);

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
      /* picker cancelled */
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

  const remoteCameraTileVisible =
    isVideo && connected && remoteState.cameraOff && !remoteState.sharing;

  return (
    <div className="fixed inset-0 z-50 flex w-screen flex-col bg-ink text-paper">
      <div className="pointer-events-none absolute left-0 right-0 top-0 z-10 bg-gradient-to-b from-ink/80 to-transparent px-4 pb-10 pt-4 text-center">
        <p className="font-display text-lg font-semibold">
          {call.other.username}
        </p>
        {statusLine && (
          <p className="text-sm tabular-nums text-paper/70">{statusLine}</p>
        )}
      </div>

      {/* Presenting indicators (polish Section 4) */}
      {sharing && (
        <div className="absolute left-1/2 top-16 z-20 -translate-x-1/2 rounded-full bg-clay px-3 py-1 text-xs font-medium text-paper shadow-lg">
          You&apos;re presenting your screen
        </div>
      )}
      {!sharing && remoteState.sharing && (
        <div className="absolute left-1/2 top-16 z-20 -translate-x-1/2 rounded-full bg-paper/15 px-3 py-1 text-xs font-medium text-paper shadow-lg">
          {call.other.username} is sharing their screen
        </div>
      )}

      {/* Stage — full-bleed width (polish Section 9): camera video uses
          object-cover (no side gaps); screen shares use object-contain. */}
      <div className="relative flex min-h-0 w-full flex-1 items-center justify-center overflow-hidden bg-ink">
        {isVideo ? (
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className={cn(
              "max-h-full max-w-full bg-ink",
              remoteState.sharing
                ? "h-full w-full object-contain"
                : remotePortrait
                  ? "h-full w-auto object-contain"
                  : "h-full w-full object-cover",
            )}
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

        {/* Remote camera-off tile (polish Section 3) */}
        {remoteCameraTileVisible && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-ink/95">
            <Avatar
              username={call.other.username}
              imageUrl={call.other.image}
              className="scale-[2]"
            />
            <p className="mt-3 flex items-center gap-2 text-sm text-paper/80">
              <VideoOff className="h-4 w-4" />
              {call.other.username}&apos;s camera is off
            </p>
          </div>
        )}

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

        {/* Local self-view (polish Section 3: camera-off shows avatar tile;
            Section 4: clay ring while presenting) */}
        {isVideo && (
          <div
            className={cn(
              "absolute bottom-3 right-3 z-10 w-28 overflow-hidden rounded-xl border shadow-lg sm:w-36 md:w-44",
              sharing ? "border-clay ring-2 ring-clay/70" : "border-paper/25",
            )}
          >
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className={cn(
                "w-full bg-ink object-cover",
                localPortrait ? "aspect-[9/16]" : "aspect-video",
                !sharing && "-scale-x-100",
                cameraOff && !sharing && "hidden",
              )}
            />
            {cameraOff && !sharing && (
              <div
                className={cn(
                  "flex w-full flex-col items-center justify-center gap-1 bg-surface-2/20",
                  localPortrait ? "aspect-[9/16]" : "aspect-video",
                )}
              >
                <Avatar username={me.username} className="scale-75" />
                <span className="flex items-center gap-1 text-[10px] text-paper/80">
                  <VideoOff className="h-3 w-3" /> You
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Control bar */}
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
