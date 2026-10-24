import { useState, useEffect, useRef } from "react";
import {
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  Search,
  Plus,
  Users,
  Copy,
  Check,
  LogOut,
  MessageSquare,
  ListMusic,
  Send,
  Music,
} from "lucide-react";

const INITIAL_PLAYLIST = [
  {
    id: "VmU1ZsXUbG0",
    title: "Yad Lagla - Sairat",
    artist: "Ajay Gogavale | Ajay-Atul",
    thumbnail: "https://img.youtube.com/vi/VmU1ZsXUbG0/hqdefault.jpg",
    duration: "5:19",
  },
  {
    id: "2Z0Put0teCM",
    title: "Senorita - Zindagi Na Milegi Dobara",
    artist: "Farhan Akhtar, Hrithik Roshan, Abhay Deol",
    thumbnail: "https://img.youtube.com/vi/2Z0Put0teCM/hqdefault.jpg",
    duration: "4:08",
  },
  {
    id: "kJQP7kiw5Fk",
    title: "Luis Fonsi - Despacito ft. Daddy Yankee",
    artist: "Luis Fonsi",
    thumbnail: "https://img.youtube.com/vi/kJQP7kiw5Fk/hqdefault.jpg",
    duration: "4:42",
  },
];

function Room({ roomcode, onLeave, socket }) {
  const cleanRoomCode = String(roomcode || "").trim().toUpperCase();

  const [playlist, setPlaylist] = useState(INITIAL_PLAYLIST);
  const [currentTrackIndex, setCurrentTrackIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [users, setUsers] = useState([]);

  // Search & Chat State
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [sidebarTab, setSidebarTab] = useState("queue"); // "queue" or "chat"
  const [copied, setCopied] = useState(false);

  const playerRef = useRef(null);
  const chatBottomRef = useRef(null);
  const currentTrack = playlist[currentTrackIndex] || playlist[0];

  // 1. Ensure Room Registration on Mount
  useEffect(() => {
    if (socket && cleanRoomCode) {
      socket.emit("join_room", {
        roomcode: cleanRoomCode,
        username: `User-${socket.id?.slice(0, 4)}`,
      });
    }
  }, [cleanRoomCode, socket]);

  // 2. Initialize YouTube Player
  useEffect(() => {
    function createPlayer() {
      if (!window.YT || !window.YT.Player) return;
      if (playerRef.current) return;

      playerRef.current = new window.YT.Player("youtube-player", {
        height: "100%",
        width: "100%",
        videoId: currentTrack?.id,
        playerVars: {
          autoplay: 0,
          controls: 0,
          disablekb: 1,
          modestbranding: 1,
          rel: 0,
        },
        events: {
          onReady: (e) => {
            setDuration(e.target.getDuration() || 0);
          },
          onStateChange: (e) => {
            if (e.data === 0) {
              const nextIndex = (currentTrackIndex + 1) % playlist.length;
              handleSelectTrack(nextIndex);
            }
          },
        },
      });
    }

    if (window.YT && window.YT.Player) {
      createPlayer();
    } else {
      window.onYouTubeIframeAPIReady = createPlayer;
    }

    return () => {
      if (playerRef.current && typeof playerRef.current.destroy === "function") {
        playerRef.current.destroy();
        playerRef.current = null;
      }
    };
  }, []);

  // 3. Scrubbing & Duration Tracking
  useEffect(() => {
    const interval = setInterval(() => {
      if (playerRef.current && isPlaying && typeof playerRef.current.getCurrentTime === "function") {
        setCurrentTime(playerRef.current.getCurrentTime());
        setDuration(playerRef.current.getDuration() || 0);
      }
    }, 500);
    return () => clearInterval(interval);
  }, [isPlaying]);

  // 4. Socket Listeners for Real-time Playback Sync
  useEffect(() => {
    if (!socket) return;

    socket.on("music_played", ({ currentTime }) => {
      setIsPlaying(true);
      if (playerRef.current && typeof playerRef.current.playVideo === "function") {
        if (Math.abs((playerRef.current.getCurrentTime() || 0) - currentTime) > 1.5) {
          playerRef.current.seekTo(currentTime, true);
        }
        playerRef.current.playVideo();
      }
    });

    socket.on("music_paused", ({ currentTime }) => {
      setIsPlaying(false);
      if (playerRef.current && typeof playerRef.current.pauseVideo === "function") {
        if (currentTime !== undefined) playerRef.current.seekTo(currentTime, true);
        playerRef.current.pauseVideo();
      }
    });

    socket.on("music_seeked", ({ currentTime }) => {
      setCurrentTime(currentTime);
      if (playerRef.current && typeof playerRef.current.seekTo === "function") {
        playerRef.current.seekTo(currentTime, true);
      }
    });

    socket.on("track_changed", ({ trackIndex }) => {
      setCurrentTrackIndex(trackIndex);
      setCurrentTime(0);
      setIsPlaying(true);
    });

    socket.on("song_added_to_queue", ({ song }) => {
      setPlaylist((prev) => [...prev, song]);
    });

    socket.on("receive_message", (msg) => {
      setMessages((prev) => [...prev, msg]);
    });

    socket.on("room_users_update", (updatedUsers) => {
      setUsers(updatedUsers);
    });

    return () => {
      socket.off("music_played");
      socket.off("music_paused");
      socket.off("music_seeked");
      socket.off("track_changed");
      socket.off("song_added_to_queue");
      socket.off("receive_message");
      socket.off("room_users_update");
    };
  }, [socket]);

  // Auto-scroll chat to bottom
  useEffect(() => {
    if (sidebarTab === "chat") {
      chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, sidebarTab]);

  // Video track update
  useEffect(() => {
    if (playerRef.current && currentTrack?.id && typeof playerRef.current.loadVideoById === "function") {
      playerRef.current.loadVideoById(currentTrack.id);
      if (!isPlaying) {
        playerRef.current.pauseVideo();
      }
    }
  }, [currentTrackIndex]);

  // Synchronized Control Handlers
  function handlePlay() {
    const time = playerRef.current?.getCurrentTime?.() || currentTime;
    setIsPlaying(true);
    playerRef.current?.playVideo?.();
    socket.emit("play_music", { roomcode: cleanRoomCode, currentTime: time });
  }

  function handlePause() {
    const time = playerRef.current?.getCurrentTime?.() || currentTime;
    setIsPlaying(false);
    playerRef.current?.pauseVideo?.();
    socket.emit("pause_music", { roomcode: cleanRoomCode, currentTime: time });
  }

  function handleSeek(e) {
    const target = Number(e.target.value);
    setCurrentTime(target);
    playerRef.current?.seekTo?.(target, true);
    socket.emit("seek_music", { roomcode: cleanRoomCode, currentTime: target });
  }

  function handleSkip(seconds) {
    const cur = playerRef.current?.getCurrentTime?.() || currentTime;
    const target = Math.max(0, Math.min(cur + seconds, duration));
    setCurrentTime(target);
    playerRef.current?.seekTo?.(target, true);
    socket.emit("seek_music", { roomcode: cleanRoomCode, currentTime: target });
  }

  function handleSelectTrack(idx) {
    setCurrentTrackIndex(idx);
    setCurrentTime(0);
    setIsPlaying(true);
    socket.emit("change_track", { roomcode: cleanRoomCode, trackIndex: idx });
  }

  function handleSearch(e) {
    e.preventDefault();
    if (!searchQuery.trim() || !socket) return;
    setIsSearching(true);
    socket.emit("search_youtube", searchQuery, (res) => {
      setIsSearching(false);
      setSearchResults(res?.success ? res.results : []);
    });
  }

  function handleAddToQueue(song) {
    socket.emit("add_to_queue", { roomcode: cleanRoomCode, song });
    setSearchResults([]);
    setSearchQuery("");
  }

  function handleSendMessage(e) {
    e.preventDefault();
    if (!chatInput.trim() || !socket) return;
    socket.emit("send_message", { roomcode: cleanRoomCode, message: chatInput.trim() });
    setChatInput("");
  }

  function handleCopyRoomCode() {
    navigator.clipboard.writeText(cleanRoomCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function formatTime(sec) {
    if (isNaN(sec)) return "00:00";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m < 10 ? "0" : ""}${m}:${s < 10 ? "0" : ""}${s}`;
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col font-sans selection:bg-indigo-500 selection:text-white">
      {/* 1. TOP NAVIGATION / HEADER */}
      <header className="border-b border-zinc-800/80 bg-zinc-900/60 backdrop-blur-md sticky top-0 z-40 px-6 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xl">🎵</span>
            <span className="text-lg font-bold tracking-tight bg-gradient-to-r from-indigo-400 to-violet-400 bg-clip-text text-transparent">
              Chill_X
            </span>
          </div>

          <div className="h-4 w-px bg-zinc-800 mx-1" />

          {/* Room Code Badge with Copy Action */}
          <button
            onClick={handleCopyRoomCode}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-800/80 hover:bg-zinc-800 border border-zinc-700/60 text-xs font-mono font-medium transition-colors group cursor-pointer"
            title="Click to copy room code"
          >
            <span className="text-zinc-400">ROOM:</span>
            <span className="text-indigo-300 font-bold tracking-wider">{cleanRoomCode}</span>
            {copied ? (
              <Check className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <Copy className="w-3.5 h-3.5 text-zinc-400 group-hover:text-zinc-200" />
            )}
          </button>
        </div>

        {/* Listeners Count & Leave Button */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-zinc-900 border border-zinc-800 text-xs text-zinc-300">
            <Users className="w-3.5 h-3.5 text-emerald-400" />
            <span>{users.length} Live</span>
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
          </div>

          <button
            onClick={onLeave}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-950/40 hover:bg-red-900/50 text-red-300 border border-red-900/40 text-xs font-medium transition-colors cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Leave</span>
          </button>
        </div>
      </header>

      {/* 2. MAIN DASHBOARD GRID */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* LEFT / CENTER COLUMN: Player & Controls (7 Cols on Large Screens) */}
        <section className="lg:col-span-7 xl:col-span-8 flex flex-col gap-4">
          {/* Real-time YouTube Search Bar */}
          <div className="relative">
            <form onSubmit={handleSearch} className="flex gap-2">
              <div className="relative flex-1">
                <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" />
                <input
                  type="text"
                  placeholder="Search YouTube songs, artists, or paste keywords..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 bg-zinc-900/90 border border-zinc-800 rounded-xl text-sm placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 text-zinc-100 transition-all"
                />
              </div>
              <button
                type="submit"
                disabled={isSearching}
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-medium transition-colors disabled:opacity-50 cursor-pointer shadow-lg shadow-indigo-600/20"
              >
                {isSearching ? "Searching..." : "Search"}
              </button>
            </form>

            {/* Floating Search Results Dropdown */}
            {searchResults.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-2 bg-zinc-900/95 border border-zinc-800 rounded-xl shadow-2xl p-2 z-50 backdrop-blur-md max-h-80 overflow-y-auto space-y-1">
                <div className="flex justify-between items-center px-2 py-1 text-xs font-semibold text-zinc-400">
                  <span>Search Results</span>
                  <button
                    onClick={() => setSearchResults([])}
                    className="text-zinc-500 hover:text-zinc-300"
                  >
                    Close
                  </button>
                </div>
                {searchResults.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between p-2 hover:bg-zinc-800/60 rounded-lg gap-3 transition-colors group"
                  >
                    <img
                      src={item.thumbnail}
                      alt={item.title}
                      className="w-14 h-9 rounded-md object-cover bg-zinc-800"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold truncate text-zinc-100 group-hover:text-indigo-300">
                        {item.title}
                      </p>
                      <p className="text-[11px] text-zinc-400 truncate">
                        {item.artist} • {item.duration}
                      </p>
                    </div>
                    <button
                      onClick={() => handleAddToQueue(item)}
                      className="flex items-center gap-1 px-2.5 py-1.5 bg-indigo-600/20 hover:bg-indigo-600 text-indigo-300 hover:text-white border border-indigo-500/30 rounded-md text-xs font-medium transition-all cursor-pointer"
                    >
                      <Plus className="w-3 h-3" /> Queue
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* YouTube Video Screen with Click Shield */}
          <div className="relative aspect-video w-full rounded-2xl overflow-hidden bg-black border border-zinc-800 shadow-2xl">
            <div id="youtube-player" className="w-full h-full" />
            {/* Click shield stops accidental local playback desync */}
            <div className="absolute inset-0 cursor-default" />
          </div>

          {/* Glassmorphic Playback Control Deck */}
          <div className="bg-zinc-900/80 backdrop-blur-md border border-zinc-800/80 rounded-2xl p-5 shadow-xl flex flex-col gap-4">
            {/* Current Track Header */}
            <div className="flex items-center gap-4">
              <img
                src={currentTrack?.thumbnail}
                alt={currentTrack?.title}
                className="w-14 h-14 rounded-xl object-cover border border-zinc-700/60 shadow-md"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-bold text-zinc-100 truncate">
                    {currentTrack?.title || "No Track Selected"}
                  </h3>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                    {isPlaying ? "Playing" : "Paused"}
                  </span>
                </div>
                <p className="text-xs text-zinc-400 truncate mt-0.5">
                  {currentTrack?.artist || "Unknown Artist"}
                </p>
              </div>
            </div>

            {/* Synced Scrubber Timeline */}
            <div className="space-y-1.5">
              <input
                type="range"
                min="0"
                max={duration || 0}
                step="1"
                value={currentTime}
                onChange={handleSeek}
                className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-indigo-500 focus:outline-none"
              />
              <div className="flex justify-between text-[11px] font-mono text-zinc-500">
                <span>{formatTime(currentTime)}</span>
                <span>{formatTime(duration)}</span>
              </div>
            </div>

            {/* Playback Button Controls Row */}
            <div className="flex items-center justify-center gap-4 pt-1">
              <button
                onClick={() => handleSkip(-10)}
                className="p-2.5 rounded-xl bg-zinc-800/60 hover:bg-zinc-800 text-zinc-300 hover:text-white border border-zinc-700/40 transition-colors cursor-pointer"
                title="Rewind 10 seconds"
              >
                <RotateCcw className="w-4 h-4" />
              </button>

              <button
                onClick={isPlaying ? handlePause : handlePlay}
                className="p-4 rounded-full bg-gradient-to-tr from-indigo-600 to-violet-500 hover:from-indigo-500 hover:to-violet-400 text-white shadow-lg shadow-indigo-500/25 transition-all transform hover:scale-105 active:scale-95 cursor-pointer"
              >
                {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
              </button>

              <button
                onClick={() => handleSkip(10)}
                className="p-2.5 rounded-xl bg-zinc-800/60 hover:bg-zinc-800 text-zinc-300 hover:text-white border border-zinc-700/40 transition-colors cursor-pointer"
                title="Forward 10 seconds"
              >
                <RotateCw className="w-4 h-4" />
              </button>
            </div>
          </div>
        </section>

        {/* RIGHT COLUMN: Tabbed Sidebar for Queue & Chat (5 Cols on Large Screens) */}
        <aside className="lg:col-span-5 xl:col-span-4 flex flex-col bg-zinc-900/60 backdrop-blur-md border border-zinc-800/80 rounded-2xl overflow-hidden h-[620px] shadow-xl">
          {/* Sidebar Tab Header */}
          <div className="flex border-b border-zinc-800/80 bg-zinc-900/80 p-1.5 gap-1.5">
            <button
              onClick={() => setSidebarTab("queue")}
              className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                sidebarTab === "queue"
                  ? "bg-zinc-800 text-indigo-300 shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <ListMusic className="w-4 h-4" />
              <span>Queue ({playlist.length})</span>
            </button>
            <button
              onClick={() => setSidebarTab("chat")}
              className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                sidebarTab === "chat"
                  ? "bg-zinc-800 text-indigo-300 shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <MessageSquare className="w-4 h-4" />
              <span>Chat {messages.length > 0 && `(${messages.length})`}</span>
            </button>
          </div>

          {/* TAB 1: SHARED QUEUE */}
          {sidebarTab === "queue" && (
            <div className="flex-1 p-3 overflow-y-auto space-y-2">
              {playlist.map((track, idx) => {
                const isSelected = idx === currentTrackIndex;
                return (
                  <div
                    key={track.id + idx}
                    onClick={() => handleSelectTrack(idx)}
                    className={`flex items-center gap-3 p-2.5 rounded-xl border transition-all cursor-pointer ${
                      isSelected
                        ? "bg-indigo-950/40 border-indigo-500/40 text-white"
                        : "bg-zinc-900/40 border-zinc-800/60 hover:bg-zinc-800/40 text-zinc-300"
                    }`}
                  >
                    <div className="relative w-12 h-10 rounded-lg overflow-hidden shrink-0 bg-zinc-800">
                      <img
                        src={track.thumbnail}
                        alt={track.title}
                        className="w-full h-full object-cover"
                      />
                      {isSelected && (
                        <div className="absolute inset-0 bg-indigo-950/60 flex items-center justify-center">
                          <Music className="w-4 h-4 text-indigo-300 animate-pulse" />
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs font-medium truncate ${isSelected ? "text-indigo-200 font-bold" : "text-zinc-200"}`}>
                        {track.title}
                      </p>
                      <p className="text-[11px] text-zinc-500 truncate mt-0.5">
                        {track.artist}
                      </p>
                    </div>
                    <span className="text-[10px] font-mono text-zinc-500 shrink-0">
                      {track.duration}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {/* TAB 2: LIVE CHAT */}
          {sidebarTab === "chat" && (
            <div className="flex-1 flex flex-col h-full min-h-0">
              <div className="flex-1 p-3 overflow-y-auto space-y-2.5">
                {messages.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-zinc-500 text-xs">
                    <MessageSquare className="w-8 h-8 stroke-1 text-zinc-600 mb-2" />
                    <span>No messages yet. Say hello!</span>
                  </div>
                ) : (
                  messages.map((m, idx) => (
                    <div key={idx} className="flex flex-col gap-0.5 text-xs">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-indigo-400">{m.user}</span>
                        <span className="text-[10px] text-zinc-600">{m.time}</span>
                      </div>
                      <p className="bg-zinc-800/60 rounded-lg px-2.5 py-1.5 text-zinc-200 break-words border border-zinc-800">
                        {m.message}
                      </p>
                    </div>
                  ))
                )}
                <div ref={chatBottomRef} />
              </div>

              {/* Chat Input Bar */}
              <form onSubmit={handleSendMessage} className="p-3 border-t border-zinc-800/80 bg-zinc-900/60 flex gap-2">
                <input
                  type="text"
                  placeholder="Send a message..."
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  className="flex-1 px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-xl text-xs placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 text-zinc-100"
                />
                <button
                  type="submit"
                  className="p-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl transition-colors cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              </form>
            </div>
          )}
        </aside>
      </main>
    </div>
  );
}

export default Room;