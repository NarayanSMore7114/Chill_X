import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check, Copy, GripVertical, Headphones, ListMusic, LogOut, MessageSquare, Pause, Play, Plus,
  Rewind, FastForward, Search, Send, Share2, SkipBack, SkipForward, Smile, Volume2, VolumeX, X,
} from "lucide-react";
import { toast } from "sonner";
import { CATALOG, INITIAL_QUEUE, fmt, thumb, type Listener, type Message, type Track } from "@/lib/mock";
import { cn } from "@/lib/utils";
import { socket } from "@/socket";

export const Route = createFileRoute("/room/$code")({
  head: ({ params }) => ({
    meta: [
      { title: `Room ${params.code} — Chill_X` },
      { name: "description", content: "Listen together in a live Chill_X room with a shared queue and chat." },
      { property: "og:title", content: `Room ${params.code} — Chill_X` },
      { property: "og:description", content: "Join this live listening room on Chill_X." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Room,
});

const EMOJIS = ["🔥", "😍", "🎵", "🎧", "💜", "😂", "🙌", "👏", "🥹", "✨", "🕺", "💯"];
const now = () => new Date().toTimeString().slice(0, 5);

function Avatar({ l, size = "size-8" }: { l?: { name?: string; color?: string }; size?: string }) {
  const initial = (l?.name?.trim()?.[0] || "?").toUpperCase();
  const colorClass = l?.color || "bg-primary";

  return (
    <div className={cn("grid shrink-0 place-items-center rounded-full font-display text-xs font-bold text-primary-foreground", colorClass, size)}>
      {initial}
    </div>
  );
}

function Room() {
  const { code } = Route.useParams();
  const cleanCode = useMemo(() => String(code || "").trim().toUpperCase(), [code]);
  const navigate = useNavigate();

  // Load identity directly from storage so it never defaults to "User-Guest"
  const [me, setMe] = useState<Listener>(() => {
    try {
      const s = typeof window !== "undefined" ? sessionStorage.getItem("chillx-user") : null;
      if (s) {
        const u = JSON.parse(s);
        return { id: "me", name: u.name?.trim() || "You", color: u.color || "bg-avatar-6" };
      }
    } catch {
      // fallback
    }
    return { id: "me", name: "You", color: "bg-avatar-6" };
  });

  const [queue, setQueue] = useState<Track[]>(INITIAL_QUEUE);
  const [currentId, setCurrentId] = useState<string>(INITIAL_QUEUE[0]?.id || "");
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [volume, setVolume] = useState(70);
  const [muted, setMuted] = useState(false);
  const [tab, setTab] = useState<"queue" | "chat">("queue");
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeUsers, setActiveUsers] = useState<Listener[]>([]);
  const [copied, setCopied] = useState(false);

  const frame = useRef<HTMLIFrameElement>(null);
  const isBroadcastingRef = useRef(false);

  const idx = Math.max(0, queue.findIndex((t) => t.id === currentId));
  const current = queue[idx];

  const cmd = (func: string, args: unknown[] = []) => {
    frame.current?.contentWindow?.postMessage(
      JSON.stringify({ event: "command", func, args }),
      "*"
    );
  };

  // 1. Room mount & Socket Listeners
  useEffect(() => {
    if (!cleanCode) return;

    const username = me.name !== "You" ? me.name : `User-${socket.id ? socket.id.slice(0, 4) : "Guest"}`;
    socket.emit("join_room", { roomcode: cleanCode, username });

    const handleMusicPlayed = ({ currentTime }: { currentTime: number }) => {
      isBroadcastingRef.current = true;
      setPlaying(true);
      setTime(currentTime);
      cmd("seekTo", [currentTime, true]);
      cmd("playVideo");
      setTimeout(() => { isBroadcastingRef.current = false; }, 200);
    };

    const handleMusicPaused = ({ currentTime }: { currentTime: number }) => {
      isBroadcastingRef.current = true;
      setPlaying(false);
      if (currentTime !== undefined) {
        setTime(currentTime);
        cmd("seekTo", [currentTime, true]);
      }
      cmd("pauseVideo");
      setTimeout(() => { isBroadcastingRef.current = false; }, 200);
    };

    const handleMusicSeeked = ({ currentTime }: { currentTime: number }) => {
      isBroadcastingRef.current = true;
      setTime(currentTime);
      cmd("seekTo", [currentTime, true]);
      setTimeout(() => { isBroadcastingRef.current = false; }, 200);
    };

    const handleTrackChanged = ({ trackIndex }: { trackIndex: number }) => {
      if (queue[trackIndex]) {
        setCurrentId(queue[trackIndex]!.id);
        setTime(0);
        setPlaying(true);
      }
    };

    const handleQueueAdded = ({ song }: { song: Track }) => {
      setQueue((prev) => [...prev, song]);
      toast.info(`Added "${song.title}" to shared queue`);
    };

    // Chat listener: discard own broadcasts and map incoming messages to other users
    const handleReceiveMessage = (msg: { senderId?: string; user: string; message: string; time?: string }) => {
      if (msg.senderId && msg.senderId === socket.id) return;

      setMessages((prev) => [
        ...prev,
        {
          id: String(Date.now() + Math.random()),
          userId: msg.senderId || "peer",
          name: msg.user,
          color: "bg-avatar-2",
          text: msg.message,
          time: msg.time || now(),
        },
      ]);
    };

    const handleRoomUsers = (usersList: Array<{ id: string; username: string }>) => {
      const mapped = usersList.map((u, i) => ({
        id: u.id,
        name: u.username,
        color: `bg-avatar-${(i % 6) + 1}`,
      }));
      setActiveUsers(mapped);
    };

    socket.on("music_played", handleMusicPlayed);
    socket.on("music_paused", handleMusicPaused);
    socket.on("music_seeked", handleMusicSeeked);
    socket.on("track_changed", handleTrackChanged);
    socket.on("song_added_to_queue", handleQueueAdded);
    socket.on("receive_message", handleReceiveMessage);
    socket.on("room_users_update", handleRoomUsers);

    return () => {
      socket.off("music_played", handleMusicPlayed);
      socket.off("music_paused", handleMusicPaused);
      socket.off("music_seeked", handleMusicSeeked);
      socket.off("track_changed", handleTrackChanged);
      socket.off("song_added_to_queue", handleQueueAdded);
      socket.off("receive_message", handleReceiveMessage);
      socket.off("room_users_update", handleRoomUsers);
    };
  }, [cleanCode, me.name, queue]);

  // 2. Playback progress tracking
  useEffect(() => {
    if (!playing) return;
    const interval = setInterval(() => {
      setTime((t) => {
        if (current && t + 1 >= current.duration) {
          next();
          return 0;
        }
        return t + 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [playing, current?.id]);

  useEffect(() => {
    cmd("setVolume", [volume]);
    cmd(muted ? "mute" : "unMute");
  }, [volume, muted]);

  const togglePlay = () => {
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
    const validTime = Math.min(Math.max(0, targetTime), current?.duration ?? 0);
    setTime(validTime);
    cmd("seekTo", [validTime, true]);
    socket.emit("seek_music", { roomcode: cleanCode, currentTime: validTime });
  };

  const play = (id: string) => {
    const selectedIdx = queue.findIndex((t) => t.id === id);
    if (selectedIdx === -1) return;

    setCurrentId(id);
    setTime(0);
    setPlaying(true);
    socket.emit("change_track", { roomcode: cleanCode, trackIndex: selectedIdx });
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
    const newTrack = { ...t, id: `${t.id}-${Date.now()}` };
    setQueue((q) => [...q, newTrack]);
    socket.emit("add_to_queue", { roomcode: cleanCode, song: newTrack });
    toast.success(`Added "${t.title}" to queue`);
  };

  const remove = (id: string) => {
    if (id === currentId) {
      if (queue.length > 1) next();
      else setPlaying(false);
    }
    setQueue((q) => q.filter((t) => t.id !== id));
  };

  const copy = (text: string, label: string) => {
    navigator.clipboard?.writeText(text);
    toast.success(label);
  };

  const send = (text: string) => {
    const currentName = me.name && me.name !== "You" ? me.name : "You";

    // 1. Immediately place sender bubble into local state
    const localMsg: Message = {
      id: String(Date.now()),
      userId: "me",
      name: currentName,
      color: me.color,
      text,
      time: now(),
    };
    setMessages((m) => [...m, localMsg]);

    // 2. Transmit to backend
    socket.emit("send_message", {
      roomcode: cleanCode,
      message: text,
      username: currentName,
    });
  };

  const listeners = useMemo(() => {
    return activeUsers.length > 0 ? activeUsers : [me];
  }, [activeUsers, me]);

  return (
    <div className="bg-ambient flex h-screen flex-col overflow-hidden">
      {/* Header */}
      <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-border bg-background/60 px-4 backdrop-blur-xl md:px-6">
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
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden -space-x-2 sm:flex">
            {listeners.map((l) => (
              <div key={l.id} className="group relative">
                <div className="rounded-full ring-2 ring-background transition group-hover:-translate-y-0.5"><Avatar l={l} /></div>
                <span className="absolute bottom-0 right-0 size-2.5 rounded-full bg-live ring-2 ring-background">
                  <span className="animate-live absolute inset-0 rounded-full bg-live" />
                </span>
                <span className="pointer-events-none absolute left-1/2 top-10 z-50 -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-xs opacity-0 transition group-hover:opacity-100">
                  {l.name}{l.id === "me" ? " (you)" : ""}
                </span>
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
        {/* Main stage */}
        <main className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
          <div className="mx-auto max-w-4xl space-y-5">
            <SearchBar onAdd={addTrack} />

            <div className="relative aspect-video overflow-hidden rounded-2xl border border-border bg-card shadow-screen">
              {current ? (
                <>
                  <iframe
                    ref={frame}
                    key={current.id}
                    className="size-full"
                    src={`https://www.youtube.com/embed/${current.videoId}?enablejsapi=1&controls=0&rel=0&modestbranding=1&autoplay=${playing ? 1 : 0}`}
                    title={current.title}
                    allow="autoplay; encrypted-media"
                    onLoad={() => {
                      cmd("setVolume", [volume]);
                      if (muted) cmd("mute");
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
                track={current} playing={playing} time={time} volume={volume} muted={muted}
                onToggle={togglePlay} onSeek={seek} onPrev={prev} onNext={next}
                onVolume={(v) => { setVolume(v); if (v > 0) setMuted(false); }} onMute={() => setMuted((m) => !m)}
              />
            )}
          </div>
        </main>

        {/* Sidebar */}
        <aside className="flex h-[28rem] shrink-0 flex-col border-t border-border bg-surface/70 backdrop-blur-xl lg:h-auto lg:w-96 lg:border-l lg:border-t-0">
          <div className="m-3 grid grid-cols-2 gap-1 rounded-lg bg-background/60 p-1">
            {([["queue", "Up Next", ListMusic], ["chat", "Live Chat", MessageSquare]] as const).map(([k, label, Icon]) => (
              <button key={k} onClick={() => setTab(k)} className={cn("press flex items-center justify-center gap-2 rounded-md py-2 text-sm font-semibold", tab === k ? "bg-card text-foreground shadow" : "text-muted-foreground hover:text-foreground")}>
                <Icon className="size-4" /> {label}
                {k === "queue" && <span className="rounded-full bg-secondary px-1.5 text-[10px]">{queue.length}</span>}
              </button>
            ))}
          </div>

          {tab === "queue" ? (
            <QueueList queue={queue} setQueue={setQueue} currentId={currentId} playing={playing} onPlay={play} onRemove={remove} />
          ) : (
            <Chat messages={messages} meId="me" onSend={send} />
          )}
        </aside>
      </div>
    </div>
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
    <div className="relative z-30">
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
        <div className="absolute mt-2 max-h-96 w-full overflow-y-auto rounded-xl border border-border bg-popover/95 p-1.5 shadow-2xl backdrop-blur-xl">
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

function PlayerCard(p: {
  track: Track; playing: boolean; time: number; volume: number; muted: boolean;
  onToggle: () => void; onSeek: (t: number) => void; onPrev: () => void; onNext: () => void;
  onVolume: (v: number) => void; onMute: () => void;
}) {
  const pct = (p.time / p.track.duration) * 100;
  const long = p.track.title.length > 22;
  const iconBtn = "press grid size-10 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground";

  return (
    <div className="glass rounded-2xl p-5">
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
            <button title="-10s" onClick={() => p.onSeek(p.time - 10)} className={iconBtn}><Rewind className="size-4" /></button>
            <button title="Previous" onClick={p.onPrev} className={iconBtn}><SkipBack className="size-5" /></button>
            <button title={p.playing ? "Pause" : "Play"} onClick={p.onToggle} className="press mx-1 grid size-14 place-items-center rounded-full bg-gradient-primary text-primary-foreground shadow-glow hover:scale-105">
              {p.playing ? <Pause className="size-6 fill-current" /> : <Play className="ml-0.5 size-6 fill-current" />}
            </button>
            <button title="Next" onClick={p.onNext} className={iconBtn}><SkipForward className="size-5" /></button>
            <button title="+10s" onClick={() => p.onSeek(p.time + 10)} className={iconBtn}><FastForward className="size-4" /></button>
          </div>
          <div className="flex items-center gap-3 font-display text-xs tabular-nums text-muted-foreground">
            <span>{fmt(p.time)}</span>
            <input type="range" className="range flex-1" min={0} max={p.track.duration} value={p.time}
              style={{ "--p": `${pct}%` } as React.CSSProperties} onChange={(e) => p.onSeek(+e.target.value)} />
            <span>{fmt(p.track.duration)}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 md:w-36">
          <button onClick={p.onMute} className={iconBtn} title={p.muted ? "Unmute" : "Mute"}>
            {p.muted || p.volume === 0 ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
          </button>
          <input type="range" className="range flex-1" min={0} max={100} value={p.muted ? 0 : p.volume}
            style={{ "--p": `${p.muted ? 0 : p.volume}%` } as React.CSSProperties} onChange={(e) => p.onVolume(+e.target.value)} />
        </div>
      </div>
    </div>
  );
}

function QueueList({ queue, setQueue, currentId, playing, onPlay, onRemove }: {
  queue: Track[]; setQueue: React.Dispatch<React.SetStateAction<Track[]>>; currentId: string; playing: boolean;
  onPlay: (id: string) => void; onRemove: (id: string) => void;
}) {
  const [drag, setDrag] = useState<number | null>(null);
  return (
    <ul className="flex-1 space-y-1 overflow-y-auto px-3 pb-3">
      {queue.length === 0 && <li className="p-6 text-center text-sm text-muted-foreground">Queue is empty</li>}
      {queue.map((t, i) => {
        const active = t.id === currentId;
        return (
          <li
            key={t.id}
            draggable
            onDragStart={() => setDrag(i)}
            onDragOver={(e) => {
              e.preventDefault();
              if (drag === null || drag === i) return;
              setQueue((q) => { const n = [...q]; const [m] = n.splice(drag, 1); n.splice(i, 0, m!); return n; });
              setDrag(i);
            }}
            onDragEnd={() => setDrag(null)}
            className={cn("group flex items-center gap-2 rounded-lg border p-2 transition",
              active ? "border-primary/40 bg-primary/10" : "border-transparent hover:bg-card", drag === i && "opacity-50")}
          >
            <GripVertical className="size-4 shrink-0 cursor-grab text-muted-foreground" />
            <button onClick={() => onPlay(t.id)} className="relative shrink-0">
              <img src={thumb(t.videoId)} alt="" className="h-10 w-14 rounded-md object-cover" />
              <span className="absolute inset-0 grid place-items-center rounded-md bg-background/60 opacity-0 transition group-hover:opacity-100">
                <Play className="size-4 fill-current" />
              </span>
            </button>
            <div className="min-w-0 flex-1">
              <p className={cn("truncate text-sm font-semibold", active && "text-primary")}>{t.title}</p>
              <div className="flex items-center gap-2">
                {active && (
                  <span className="flex items-center gap-1 rounded-full bg-live/15 px-1.5 text-[10px] font-bold uppercase text-live">
                    <span className={cn("size-1.5 rounded-full bg-live", playing && "animate-pulse")} /> Now Playing
                  </span>
                )}
                <p className="truncate text-xs text-muted-foreground">{t.artist}</p>
              </div>
            </div>
            <span className="font-display text-xs tabular-nums text-muted-foreground">{fmt(t.duration)}</span>
            <button title="Remove" onClick={() => onRemove(t.id)} className="press grid size-7 place-items-center rounded-md text-muted-foreground opacity-0 hover:bg-destructive/15 hover:text-destructive group-hover:opacity-100">
              <X className="size-4" />
            </button>
          </li>
        );
      })}
    </ul>
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