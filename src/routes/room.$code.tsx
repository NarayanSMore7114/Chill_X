import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check, Copy, Crown, GripVertical, Headphones, ListMusic, LogOut, MessageSquare, Pause, Play, Plus,
  Rewind, FastForward, Search, Send, Share2, ShieldAlert, ShieldCheck, SkipBack, SkipForward, Smile, ThumbsUp, Volume2, VolumeX, Vote, X,
} from "lucide-react";
import { toast } from "sonner";
import { CATALOG, INITIAL_QUEUE, fmt, thumb, type Listener, type Message, type Track } from "@/lib/mock";
import { cn } from "@/lib/utils";
import { socket } from "@/socket";

export const Route = createFileRoute("/room/$code")({
  component: Room,
});

const EMOJIS = ["🔥", "😍", "🎵", "🎧", "💜", "😂", "🙌", "👏", "🥹", "✨", "🕺", "💯"];
const now = () => new Date().toTimeString().slice(0, 5);

interface RoomUser extends Listener {
  isHost?: boolean;
  canPlay?: boolean;
}

function Avatar({ l, size = "size-8" }: { l?: RoomUser; size?: string }) {
  const initial = (l?.name?.trim()?.[0] || "?").toUpperCase();
  const colorClass = l?.color || "bg-primary";

  return (
    <div className="relative">
      <div className={cn("grid shrink-0 place-items-center rounded-full font-display text-xs font-bold text-primary-foreground select-none", colorClass, size)}>
        {initial}
      </div>
      {l?.isHost ? (
        <span className="absolute -top-1.5 -right-1.5 grid size-4 place-items-center rounded-full bg-amber-500 text-[10px] text-white shadow ring-1 ring-background" title="Room Host">
          <Crown className="size-2.5" />
        </span>
      ) : l?.canPlay ? (
        <span className="absolute -top-1.5 -right-1.5 grid size-4 place-items-center rounded-full bg-emerald-500 text-[10px] text-white shadow ring-1 ring-background" title="Co-DJ">
          <Headphones className="size-2.5" />
        </span>
      ) : null}
    </div>
  );
}

function Room() {
  const { code } = Route.useParams();
  const cleanCode = useMemo(() => String(code || "").trim().toUpperCase(), [code]);
  const navigate = useNavigate();

  const [me] = useState<Listener>(() => {
    try {
      const s = typeof window !== "undefined" ? sessionStorage.getItem("chillx-user") : null;
      if (s) {
        const u = JSON.parse(s);
        return { id: "me", name: u.name?.trim() || "You", color: u.color || "bg-avatar-6" };
      }
    } catch {}
    return { id: "me", name: "You", color: "bg-avatar-6" };
  });

  const [queue, setQueue] = useState<Track[]>(INITIAL_QUEUE);
  const queueRef = useRef<Track[]>(INITIAL_QUEUE);
  queueRef.current = queue;

  const [currentId, setCurrentId] = useState<string>(INITIAL_QUEUE[0]?.id || "");
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [volume, setVolume] = useState(70);
  const [muted, setMuted] = useState(false);
  const [tab, setTab] = useState<"queue" | "chat">("queue");
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeUsers, setActiveUsers] = useState<RoomUser[]>([]);
  const [isHost, setIsHost] = useState(false);
  const [canPlay, setCanPlay] = useState(false);
  const [selectedUserForDj, setSelectedUserForDj] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [myId, setMyId] = useState<string>(socket.id || "");

  const [skipVotes, setSkipVotes] = useState({ count: 0, required: 1 });
  const [hasVotedSkip, setHasVotedSkip] = useState(false);

  const frame = useRef<HTMLIFrameElement>(null);
  const canControl = isHost || canPlay;

  const idx = Math.max(0, queue.findIndex((t) => t.id === currentId));
  const current = queue[idx];

  const cmd = (func: string, args: unknown[] = []) => {
    frame.current?.contentWindow?.postMessage(
      JSON.stringify({ event: "command", func, args }),
      "*"
    );
  };

  useEffect(() => {
    if (socket.id) setMyId(socket.id);
    const onConnect = () => setMyId(socket.id || "");
    socket.on("connect", onConnect);
    return () => {
      socket.off("connect", onConnect);
    };
  }, []);

  useEffect(() => {
    if (!cleanCode) return;

    const username = me.name !== "You" ? me.name : `User-${socket.id ? socket.id.slice(0, 4) : "Guest"}`;
    socket.emit("join_room", { roomcode: cleanCode, username });

    const handleSyncState = (data: {
      recentMessages?: Message[];
      isPlaying?: boolean;
      currentTime?: number;
      isHost?: boolean;
      canPlay?: boolean;
      queue?: Track[];
      skipVotes?: { count: number; required: number; hasVoted: boolean };
    }) => {
      if (typeof data?.isHost === "boolean") setIsHost(data.isHost);
      if (typeof data?.canPlay === "boolean") setCanPlay(data.canPlay);
      if (data?.recentMessages && Array.isArray(data.recentMessages)) setMessages(data.recentMessages);
      if (data?.queue && Array.isArray(data.queue) && data.queue.length > 0) setQueue(data.queue);

      if (data?.skipVotes) {
        setSkipVotes({ count: data.skipVotes.count, required: data.skipVotes.required });
        setHasVotedSkip(data.skipVotes.hasVoted);
      }

      if (typeof data?.currentTime === "number" && data.currentTime > 0) {
        setTime(data.currentTime);
        cmd("seekTo", [data.currentTime, true]);
      }

      if (data?.isPlaying) {
        setPlaying(true);
        cmd("playVideo");
      } else {
        setPlaying(false);
        cmd("pauseVideo");
      }
    };

    const handleMusicPlayed = ({ currentTime }: { currentTime?: number }) => {
      setPlaying(true);
      if (typeof currentTime === "number") {
        setTime(currentTime);
        cmd("seekTo", [currentTime, true]);
      }
      cmd("playVideo");
    };

    const handleMusicPaused = ({ currentTime }: { currentTime?: number }) => {
      setPlaying(false);
      if (typeof currentTime === "number") {
        setTime(currentTime);
        cmd("seekTo", [currentTime, true]);
      }
      cmd("pauseVideo");
    };

    const handleMusicSeeked = ({ currentTime }: { currentTime: number }) => {
      if (typeof currentTime === "number") {
        setTime(currentTime);
        cmd("seekTo", [currentTime, true]);
      }
    };

    const handleTrackChanged = ({ trackIndex }: { trackIndex: number }) => {
      const target = queueRef.current[trackIndex];
      if (target) {
        setCurrentId(target.id);
        setTime(0);
        setPlaying(true);
        setHasVotedSkip(false);
        setSkipVotes((v) => ({ ...v, count: 0 }));
      }
    };

    const handleSkipVotesUpdate = (data: { count: number; required: number }) => {
      setSkipVotes(data);
    };

    const handleQueueUpdated = (newQueue: Track[]) => {
      setQueue(newQueue);
    };

    const handlePermissionDenied = ({ message }: { message: string }) => {
      toast.error(message);
    };

    const handleReceiveMessage = (msg: { id?: string; senderId?: string; user?: string; name?: string; message?: string; text?: string; time?: string; color?: string }) => {
      if (msg.senderId && msg.senderId === socket.id) return;
      setMessages((prev) => [
        ...prev,
        {
          id: msg.id || String(Date.now() + Math.random()),
          userId: msg.senderId || "peer",
          name: msg.user || msg.name || "Peer",
          color: msg.color || "bg-avatar-2",
          text: msg.message || msg.text || "",
          time: msg.time || now(),
        },
      ]);
    };

    const handleRoomUsers = (usersList: Array<{ id: string; username: string; isHost?: boolean; canPlay?: boolean }>) => {
      const mapped: RoomUser[] = (usersList || []).map((u, i) => ({
        id: u.id,
        name: u.username,
        color: `bg-avatar-${(i % 6) + 1}`,
        isHost: !!u.isHost,
        canPlay: !!u.canPlay,
      }));
      setActiveUsers(mapped);

      const meEntry = usersList.find((u) => u.id === socket.id);
      if (meEntry) {
        setIsHost(!!meEntry.isHost);
        setCanPlay(!!meEntry.canPlay);
      } else if (usersList.length === 1) {
        setIsHost(true);
        setCanPlay(true);
      }

      setSkipVotes((v) => ({ ...v, required: Math.floor(usersList.length / 2) + 1 }));
    };

    socket.on("sync_state", handleSyncState);
    socket.on("music_played", handleMusicPlayed);
    socket.on("music_paused", handleMusicPaused);
    socket.on("music_seeked", handleMusicSeeked);
    socket.on("track_changed", handleTrackChanged);
    socket.on("skip_votes_update", handleSkipVotesUpdate);
    socket.on("queue_updated", handleQueueUpdated);
    socket.on("permission_denied", handlePermissionDenied);
    socket.on("receive_message", handleReceiveMessage);
    socket.on("room_users_update", handleRoomUsers);

    return () => {
      socket.off("sync_state", handleSyncState);
      socket.off("music_played", handleMusicPlayed);
      socket.off("music_paused", handleMusicPaused);
      socket.off("music_seeked", handleMusicSeeked);
      socket.off("track_changed", handleTrackChanged);
      socket.off("skip_votes_update", handleSkipVotesUpdate);
      socket.off("queue_updated", handleQueueUpdated);
      socket.off("permission_denied", handlePermissionDenied);
      socket.off("receive_message", handleReceiveMessage);
      socket.off("room_users_update", handleRoomUsers);
    };
  }, [cleanCode, me.name]);

  useEffect(() => {
    if (!playing) return;
    const interval = setInterval(() => {
      setTime((t) => {
        if (current && t + 1 >= current.duration) {
          if (canControl) {
            socket.emit("track_ended_auto_next", { roomcode: cleanCode });
          }
          return 0;
        }
        return t + 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [playing, current?.id, current?.duration, canControl, cleanCode]);

  useEffect(() => {
    if (!canControl || !playing) return;

    const syncInterval = setInterval(() => {
      socket.emit("sync_time", { roomcode: cleanCode, currentTime: time });
    }, 5000);

    return () => clearInterval(syncInterval);
  }, [canControl, playing, cleanCode, time]);

  useEffect(() => {
    const handleSyncTimeUpdate = ({ currentTime }: { currentTime: number }) => {
      if (canControl) return;
      const drift = Math.abs(time - currentTime);
      if (drift > 1.5) {
        setTime(currentTime);
        cmd("seekTo", [currentTime, true]);
      }
    };

    socket.on("sync_time_update", handleSyncTimeUpdate);
    return () => {
      socket.off("sync_time_update", handleSyncTimeUpdate);
    };
  }, [canControl, time]);

  useEffect(() => {
    cmd("setVolume", [volume]);
    cmd(muted ? "mute" : "unMute");
  }, [volume, muted]);

  const togglePlay = () => {
    if (!canControl) {
      toast.error("You don't have DJ playback permissions.");
      return;
    }
    const nextState = !playing;
    setPlaying(nextState);
    if (nextState) {
      cmd("playVideo");
      socket.emit("play_music", { roomcode: cleanCode, currentTime: time });
    } else {
      cmd("pauseVideo");
      socket.emit("pause_music", { roomcode: cleanCode, currentTime: time });
    }
  };

  const seek = (targetTime: number) => {
    if (!canControl) return;
    const validTime = Math.min(Math.max(0, targetTime), current?.duration ?? 0);
    setTime(validTime);
    cmd("seekTo", [validTime, true]);
    socket.emit("seek_music", { roomcode: cleanCode, currentTime: validTime });
  };

  const play = (id: string) => {
    if (!canControl) {
      toast.error("Only the room Host or DJs can choose tracks.");
      return;
    }
    const selectedIdx = queue.findIndex((t) => t.id === id);
    if (selectedIdx === -1) return;

    setCurrentId(id);
    setTime(0);
    setPlaying(true);
    socket.emit("change_track", { roomcode: cleanCode, trackIndex: selectedIdx });
  };

  const voteTrack = (trackId: string) => {
    socket.emit("vote_track", {
      roomcode: cleanCode,
      trackId,
      currentTrackId: currentId,
      defaultQueue: queue,
    });
  };

  const handleVoteToSkip = () => {
    setHasVotedSkip((prev) => !prev);
    socket.emit("vote_to_skip", { roomcode: cleanCode });
  };

  const toggleDjPermission = (targetUserId: string) => {
    socket.emit("toggle_dj_permission", { roomcode: cleanCode, targetUserId });
    setSelectedUserForDj(null);
  };

  function next() {
    if (queue.length) {
      const nextIndex = (idx + 1) % queue.length;
      play(queue[nextIndex]!.id);
    }
  }

  const prev = () => {
    if (time > 3) {
      seek(0);
    } else if (queue.length) {
      const prevIndex = (idx - 1 + queue.length) % queue.length;
      play(queue[prevIndex]!.id);
    }
  };

  const addTrack = (t: Track) => {
    const newTrack = { ...t, id: `${t.id}-${Date.now()}`, votes: [] };
    socket.emit("add_to_queue", { roomcode: cleanCode, song: newTrack });
    toast.success(`Added "${t.title}" to shared queue`);
  };

  const copy = (text: string, label: string) => {
    navigator.clipboard?.writeText(text);
    toast.success(label);
  };

  const send = (text: string) => {
    const currentName = me.name && me.name !== "You" ? me.name : "You";
    const localMsg: Message = {
      id: String(Date.now()),
      userId: "me",
      name: currentName,
      color: me.color,
      text,
      time: now(),
    };
    setMessages((m) => [...m, localMsg]);

    socket.emit("send_message", {
      roomcode: cleanCode,
      message: text,
      username: currentName,
    });
  };

  const listeners = useMemo(() => {
    return activeUsers.length > 0 ? activeUsers : [{ ...me, isHost: true, canPlay: true }];
  }, [activeUsers, me]);

  return (
    <div className="bg-ambient flex h-screen flex-col overflow-hidden">
      <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-border bg-background/80 px-4 backdrop-blur-xl z-30 md:px-6">
        <div className="flex items-center gap-4">
          <span className="font-display text-xl font-bold">Chill<span className="text-primary">_X</span></span>
          <div className="flex items-center gap-1 rounded-full border border-border bg-card py-1 pl-3 pr-1">
            <span className="size-1.5 rounded-full bg-live" />
            <span className="font-display text-xs font-semibold tracking-widest">{cleanCode}</span>
            <button
              title="Click to copy"
              onClick={() => { copy(cleanCode, "Room code copied"); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
              className="press grid size-7 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              {copied ? <Check className="size-3.5 text-live" /> : <Copy className="size-3.5" />}
            </button>
            <button
              title="Copy share link"
              onClick={() => copy(window.location.href, "Invite link copied")}
              className="press grid size-7 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <Share2 className="size-3.5" />
            </button>
          </div>

          <div className="hidden sm:flex items-center gap-1.5 rounded-full border border-border bg-card/60 px-3 py-1 text-xs font-semibold">
            {isHost ? (
              <span className="flex items-center gap-1 text-amber-400">
                <Crown className="size-3.5 fill-amber-400" /> Room Host
              </span>
            ) : canPlay ? (
              <span className="flex items-center gap-1 text-emerald-400">
                <Headphones className="size-3.5" /> Co-DJ
              </span>
            ) : (
              <span className="flex items-center gap-1 text-muted-foreground">
                🎧 Listener
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative flex -space-x-2">
            {listeners.map((l) => (
              <div key={l.id} className="relative">
                <button
                  type="button"
                  title={isHost && l.id !== socket.id ? `Manage permissions for ${l.name}` : l.name}
                  onClick={() => {
                    if (isHost && l.id !== socket.id) {
                      setSelectedUserForDj(selectedUserForDj === l.id ? null : l.id);
                    }
                  }}
                  className={cn(
                    "rounded-full ring-2 ring-background transition hover:scale-105",
                    isHost && l.id !== socket.id && "cursor-pointer hover:ring-primary"
                  )}
                >
                  <Avatar l={l} />
                </button>

                {selectedUserForDj === l.id && (
                  <div className="absolute right-0 top-11 z-50 w-48 rounded-xl border border-border bg-popover/95 p-2 shadow-2xl backdrop-blur-xl">
                    <p className="px-2 py-1 text-xs font-semibold text-foreground truncate">{l.name}</p>
                    <p className="px-2 text-[10px] text-muted-foreground">
                      Status: {l.canPlay ? "Co-DJ (Can Play)" : "Listener"}
                    </p>
                    <button
                      onClick={() => toggleDjPermission(l.id)}
                      className={cn(
                        "press mt-2 flex w-full items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition",
                        l.canPlay
                          ? "bg-destructive/15 text-destructive hover:bg-destructive hover:text-white"
                          : "bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500 hover:text-white"
                      )}
                    >
                      {l.canPlay ? <ShieldAlert className="size-3.5" /> : <ShieldCheck className="size-3.5" />}
                      {l.canPlay ? "Revoke DJ Rights" : "Grant DJ Rights"}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>

          <span className="flex items-center gap-1.5 rounded-full border border-live/30 bg-live/10 px-3 py-1 text-xs font-semibold text-live">
            <Headphones className="size-3.5" /> {listeners.length} Listeners
          </span>

          <button onClick={() => navigate({ to: "/" })} className="press flex items-center gap-1.5 rounded-lg bg-destructive/15 px-3 py-2 text-xs font-semibold text-destructive hover:bg-destructive hover:text-destructive-foreground">
            <LogOut className="size-3.5" /> <span className="hidden sm:inline">Leave Room</span>
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <main className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6 z-10">
          <div className="mx-auto max-w-4xl space-y-5">
            <div className="relative z-40">
              <SearchBar onAdd={addTrack} />
            </div>

            <div className="relative aspect-video overflow-hidden rounded-2xl border border-border bg-card shadow-screen z-10">
              {current ? (
                <>
                  <iframe
                    ref={frame}
                    key={current.id}
                    className="size-full"
                    src={`https://www.youtube.com/embed/${current.videoId}?enablejsapi=1&origin=${encodeURIComponent(typeof window !== "undefined" ? window.location.origin : "")}&controls=0&rel=0&modestbranding=1&autoplay=0`}
                    title={current.title}
                    allow="autoplay; encrypted-media"
                    onLoad={() => {
                      cmd("setVolume", [volume]);
                      if (muted) cmd("mute");
                      if (playing) cmd("playVideo");
                      else cmd("pauseVideo");
                    }}
                  />
                  <div className="absolute inset-0 cursor-default" />
                </>
              ) : (
                <div className="grid size-full place-items-center text-muted-foreground">Queue is empty — search for a track</div>
              )}
            </div>

            {current && (
              <PlayerCard
                track={current} playing={playing} time={time} volume={volume} muted={muted} canControl={canControl}
                skipVotes={skipVotes} hasVotedSkip={hasVotedSkip} onVoteSkip={handleVoteToSkip}
                onToggle={togglePlay} onSeek={seek} onPrev={prev} onNext={next}
                onVolume={(v) => { setVolume(v); if (v > 0) setMuted(false); }} onMute={() => setMuted((m) => !m)}
              />
            )}
          </div>
        </main>

        <aside className="flex h-[28rem] shrink-0 flex-col border-t border-border bg-surface/70 backdrop-blur-xl lg:h-auto lg:w-96 lg:border-l lg:border-t-0 z-20">
          <div className="m-3 grid grid-cols-2 gap-1 rounded-lg bg-background/60 p-1">
            {([["queue", "Queue & Votes", ListMusic], ["chat", "Live Chat", MessageSquare]] as const).map(([k, label, Icon]) => (
              <button key={k} onClick={() => setTab(k)} className={cn("press flex items-center justify-center gap-2 rounded-md py-2 text-sm font-semibold", tab === k ? "bg-card text-foreground shadow" : "text-muted-foreground hover:text-foreground")}>
                <Icon className="size-4" /> {label}
                {k === "queue" && <span className="rounded-full bg-secondary px-1.5 text-[10px]">{queue.length}</span>}
              </button>
            ))}
          </div>

          {tab === "queue" ? (
            <QueueList
              queue={queue} currentId={currentId} canControl={canControl}
              onPlay={play} onVote={voteTrack} currentSocketId={myId}
            />
          ) : (
            <Chat messages={messages} meId="me" onSend={send} />
          )}
        </aside>
      </div>
    </div>
  );
}

function PlayerCard(p: {
  track: Track; playing: boolean; time: number; volume: number; muted: boolean; canControl: boolean;
  skipVotes: { count: number; required: number }; hasVotedSkip: boolean; onVoteSkip: () => void;
  onToggle: () => void; onSeek: (t: number) => void; onPrev: () => void; onNext: () => void;
  onVolume: (v: number) => void; onMute: () => void;
}) {
  const pct = (p.time / p.track.duration) * 100;
  const long = p.track.title.length > 22;
  const iconBtn = cn("press grid size-10 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground", !p.canControl && "opacity-40 cursor-not-allowed");

  return (
    <div className="glass rounded-2xl p-5 space-y-4">
      <div className="flex flex-col gap-5 md:flex-row md:items-center">
        <div className="flex min-w-0 items-center gap-3 md:w-56">
          <img src={thumb(p.track.videoId)} alt="" className={cn("size-14 rounded-lg object-cover transition", p.playing && "shadow-glow")} />
          <div className="min-w-0 overflow-hidden">
            <div className="overflow-hidden whitespace-nowrap">
              {long ? (
                <div className="animate-marquee inline-flex gap-8 text-sm font-semibold"><span>{p.track.title}</span><span>{p.track.title}</span></div>
              ) : <p className="text-sm font-semibold">{p.track.title}</p>}
            </div>
            <p className="truncate text-xs text-muted-foreground">{p.track.artist}</p>
          </div>
        </div>

        <div className="flex-1 space-y-2">
          <div className="flex items-center justify-center gap-1 sm:gap-2">
            <button disabled={!p.canControl} title="-10s" onClick={() => p.onSeek(p.time - 10)} className={iconBtn}><Rewind className="size-4" /></button>
            <button disabled={!p.canControl} title="Previous" onClick={p.onPrev} className={iconBtn}><SkipBack className="size-5" /></button>
            <button title={p.playing ? "Pause" : "Play"} onClick={p.onToggle} className="press mx-1 grid size-14 place-items-center rounded-full bg-gradient-primary text-primary-foreground shadow-glow hover:scale-105">
              {p.playing ? <Pause className="size-6 fill-current" /> : <Play className="ml-0.5 size-6 fill-current" />}
            </button>
            <button disabled={!p.canControl} title="Next" onClick={p.onNext} className={iconBtn}><SkipForward className="size-5" /></button>
            <button disabled={!p.canControl} title="+10s" onClick={() => p.onSeek(p.time + 10)} className={iconBtn}><FastForward className="size-4" /></button>
          </div>
          <div className="flex items-center gap-3 font-display text-xs tabular-nums text-muted-foreground">
            <span>{fmt(p.time)}</span>
            <input
              type="range"
              disabled={!p.canControl}
              className={cn("range flex-1", !p.canControl && "cursor-not-allowed")}
              min={0}
              max={p.track.duration}
              value={p.time}
              style={{ "--p": `${pct}%` } as React.CSSProperties}
              onChange={(e) => p.onSeek(+e.target.value)}
            />
            <span>{fmt(p.track.duration)}</span>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 md:w-44">
          <div className="flex items-center gap-1.5 flex-1">
            <button onClick={p.onMute} className="press grid size-9 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground">
              {p.muted || p.volume === 0 ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
            </button>
            <input type="range" className="range flex-1" min={0} max={100} value={p.muted ? 0 : p.volume}
              style={{ "--p": `${p.muted ? 0 : p.volume}%` } as React.CSSProperties} onChange={(e) => p.onVolume(+e.target.value)} />
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-border/50 pt-3 text-xs">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Vote className="size-4 text-primary" />
          <span>Democratic Skip: <strong>{p.skipVotes.count}</strong> / {p.skipVotes.required} votes needed</span>
        </div>
        <button
          onClick={p.onVoteSkip}
          className={cn(
            "press flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition",
            p.hasVotedSkip
              ? "bg-primary text-primary-foreground shadow"
              : "bg-secondary text-muted-foreground hover:text-foreground"
          )}
        >
          <SkipForward className="size-3.5" />
          {p.hasVotedSkip ? "Voted to Skip ✓" : "Vote to Skip"}
        </button>
      </div>
    </div>
  );
}

function QueueList({
  queue,
  currentId,
  canControl,
  onPlay,
  onVote,
  currentSocketId,
}: {
  queue: Track[];
  currentId: string;
  canControl: boolean;
  onPlay: (id: string) => void;
  onVote: (id: string) => void;
  currentSocketId?: string;
}) {
  return (
    <ul className="flex-1 space-y-1 overflow-y-auto px-3 pb-3">
      {queue.length === 0 && <li className="p-6 text-center text-sm text-muted-foreground">Queue is empty</li>}
      {queue.map((t) => {
        const active = t.id === currentId;
        const votes = Array.isArray(t.votes) ? t.votes : [];
        const hasVoted = currentSocketId ? votes.includes(currentSocketId) : false;

        return (
          <li
            key={t.id}
            className={cn(
              "group flex items-center gap-2 rounded-lg border p-2 transition",
              active ? "border-primary/40 bg-primary/10" : "border-transparent hover:bg-card"
            )}
          >
            {canControl ? (
              <button onClick={() => onPlay(t.id)} className="relative shrink-0">
                <img src={thumb(t.videoId)} alt="" className="h-10 w-14 rounded-md object-cover" />
                <span className="absolute inset-0 grid place-items-center rounded-md bg-background/60 opacity-0 transition group-hover:opacity-100">
                  <Play className="size-4 fill-current" />
                </span>
              </button>
            ) : (
              <img src={thumb(t.videoId)} alt="" className="h-10 w-14 shrink-0 rounded-md object-cover" />
            )}

            <div className="min-w-0 flex-1">
              <p className={cn("truncate text-sm font-semibold", active && "text-primary")}>{t.title}</p>
              <div className="flex items-center gap-2">
                {active && (
                  <span className="flex items-center gap-1 rounded-full bg-live/15 px-1.5 text-[10px] font-bold uppercase text-live">
                    Now Playing
                  </span>
                )}
                <p className="truncate text-xs text-muted-foreground">{t.artist}</p>
              </div>
            </div>

            {!active && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onVote(t.id);
                }}
                className={cn(
                  "press flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition select-none cursor-pointer",
                  hasVoted
                    ? "bg-primary text-primary-foreground shadow"
                    : "bg-secondary text-muted-foreground hover:bg-secondary/80 hover:text-foreground"
                )}
                title={hasVoted ? "Remove upvote" : "Upvote track"}
              >
                <ThumbsUp className={cn("size-3.5", hasVoted && "fill-current")} />
                <span>{votes.length}</span>
              </button>
            )}

            <span className="font-display text-xs tabular-nums text-muted-foreground">{fmt(t.duration)}</span>
          </li>
        );
      })}
    </ul>
  );
}

function SearchBar({ onAdd }: { onAdd: (t: Track) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [liveResults, setLiveResults] = useState<Track[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const query = q.trim();
    if (!query) {
      setLiveResults(CATALOG);
      return;
    }

    const timer = setTimeout(() => {
      setSearching(true);
      socket.emit("search_youtube", query, (res: { success: boolean; results?: Array<{ id: string; title: string; artist: string; duration: string }> }) => {
        setSearching(false);
        if (res?.success && res.results && res.results.length > 0) {
          const formatted: Track[] = res.results.map((r) => {
            const parts = (r.duration || "3:00").split(":").map(Number);
            const dur = parts.length === 2 ? (parts[0]! * 60 + parts[1]!) : 180;
            return {
              id: r.id,
              videoId: r.id,
              title: r.title,
              artist: r.artist || "YouTube Artist",
              duration: dur,
            };
          });
          setLiveResults(formatted);
        } else {
          setLiveResults(
            CATALOG.filter((t) => `${t.title} ${t.artist}`.toLowerCase().includes(query.toLowerCase()))
          );
        }
      });
    }, 400);

    return () => clearTimeout(timer);
  }, [q]);

  return (
    <div className="relative z-50">
      <Search className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <input
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
        placeholder={searching ? "Searching YouTube..." : "Search YouTube tracks..."}
        className="glass h-12 w-full rounded-xl pl-11 pr-4 text-sm outline-none transition focus:ring-2 focus:ring-primary/40"
      />
      {open && (
        <div className="absolute top-full left-0 right-0 mt-2 max-h-96 overflow-y-auto rounded-xl border border-border bg-popover/95 p-1.5 shadow-2xl backdrop-blur-xl z-50">
          {liveResults.length === 0 && <p className="p-4 text-center text-sm text-muted-foreground">No results for “{q}”</p>}
          {liveResults.map((t) => (
            <div key={t.id} className="group flex items-center gap-3 rounded-lg p-2 transition hover:bg-secondary">
              <img src={thumb(t.videoId)} alt="" className="h-12 w-20 rounded-md object-cover" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{t.title}</p>
                <p className="truncate text-xs text-muted-foreground">{t.artist} · {fmt(t.duration)}</p>
              </div>
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { onAdd(t); setOpen(false); }}
                className="press flex shrink-0 items-center gap-1 rounded-md border border-primary/40 px-2.5 py-1.5 text-xs font-semibold text-primary hover:bg-primary hover:text-primary-foreground"
              >
                <Plus className="size-3.5" /> Add to Queue
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Chat({ messages, meId, onSend }: { messages: Message[]; meId: string; onSend: (t: string) => void }) {
  const [text, setText] = useState("");
  const [emoji, setEmoji] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = text.trim();
    if (!clean) return;

    setText("");
    setEmoji(false);
    if (inputRef.current) inputRef.current.value = "";
    onSend(clean);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto px-4 pb-3">
        {messages.length === 0 ? (
          <div className="p-8 text-center text-xs text-muted-foreground">
            No messages yet. Send a greeting to the room!
          </div>
        ) : (
          messages.map((m) => {
            const mine = m.userId === "me" || m.userId === meId;
            return (
              <div key={m.id} className={cn("flex gap-2.5", mine && "flex-row-reverse")}>
                <Avatar l={{ name: m?.name || "Guest", color: m?.color || "bg-avatar-2" }} />
                <div className={cn("max-w-[75%] space-y-1", mine && "items-end text-right")}>
                  <div className={cn("flex items-center gap-2 text-[11px]", mine && "justify-end")}>
                    <span className="rounded-full bg-secondary px-2 py-0.5 font-semibold">{m.name}</span>
                    <span className="text-muted-foreground">{m.time}</span>
                  </div>
                  <p className={cn("inline-block rounded-2xl px-3 py-2 text-left text-sm", mine ? "rounded-tr-sm bg-primary text-primary-foreground" : "rounded-tl-sm bg-card")}>
                    {m.text}
                  </p>
                </div>
              </div>
            );
          })
        )}
        <div ref={end} />
      </div>

      <form onSubmit={handleSubmit} className="relative border-t border-border bg-surface p-3">
        {emoji && (
          <div className="absolute bottom-full left-3 mb-2 grid grid-cols-6 gap-1 rounded-xl border border-border bg-popover p-2 shadow-2xl">
            {EMOJIS.map((e) => (
              <button
                type="button"
                key={e}
                onClick={() => setText((prev) => prev + e)}
                className="press size-8 rounded-md text-lg hover:bg-secondary"
              >
                {e}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setEmoji((v) => !v)}
            className={cn("press grid size-10 shrink-0 place-items-center rounded-lg hover:bg-secondary", emoji ? "text-primary" : "text-muted-foreground")}
          >
            <Smile className="size-5" />
          </button>
          <input
            ref={inputRef}
            type="text"
            autoComplete="off"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Say something..."
            className="h-10 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary"
          />
          <button
            type="submit"
            disabled={!text.trim()}
            className="press flex h-10 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground hover:brightness-110 disabled:opacity-40"
          >
            <Send className="size-4" /> Send
          </button>
        </div>
      </form>
    </div>
  );
}