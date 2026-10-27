import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import dotenv from "dotenv";
import { prisma } from "./db.js";

dotenv.config();

const app = express();
const server = http.createServer(app);

app.use(cors({ origin: "*" }));
app.use(express.json());

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
  transports: ["polling", "websocket"],
});

app.get("/", async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.send("Chill_X server is live and database is connected");
  } catch (err) {
    res.status(500).send(`Server live, DB error: ${err.message}`);
  }
});

// In-memory state:
// roomMembers: Map<code, Array<{ id: string, username: string, isHost: boolean, canPlay: boolean }>>
// roomQueues: Map<code, Array<{ id: string, videoId: string, title: string, artist: string, duration: number, votes: string[] }>>
// roomSkipVotes: Map<code, Set<string>> (Set of socket IDs voting to skip current song)
const roomMembers = new Map();
const roomQueues = new Map();
const roomSkipVotes = new Map();

function sortQueue(queue, currentId) {
  if (!queue || queue.length <= 1) return queue;
  const current = queue.find((t) => t.id === currentId);
  const remaining = queue.filter((t) => t.id !== currentId);
  remaining.sort((a, b) => (b.votes?.length || 0) - (a.votes?.length || 0));
  return current ? [current, ...remaining] : remaining;
}

io.on("connection", (socket) => {
  console.log(`[CONNECT] User connected: ${socket.id}`);

  const canControlPlayback = (code) => {
    const members = roomMembers.get(code) || [];
    const member = members.find((m) => m.id === socket.id);
    return member?.isHost || member?.canPlay || false;
  };

  // Helper function to advance to next song
  const advanceToNextSong = async (code, reason = "Song ended") => {
    const queue = roomQueues.get(code) || [];
    if (queue.length === 0) return;

    // Reset skip votes for the newly started song
    if (roomSkipVotes.has(code)) {
      roomSkipVotes.get(code).clear();
    }
    io.to(code).emit("skip_votes_update", { count: 0, required: Math.floor((roomMembers.get(code)?.length || 1) / 2) + 1 });

    // Pick next track
    const roomRecord = await prisma.room.findUnique({ where: { code } }).catch(() => null);
    const currentVideoId = roomRecord?.currentTrack;
    const currentIdx = queue.findIndex((t) => t.id === currentVideoId || t.videoId === currentVideoId);
    const nextIdx = currentIdx !== -1 ? (currentIdx + 1) % queue.length : 0;
    const nextTrack = queue[nextIdx];

    io.to(code).emit("track_changed", { trackIndex: nextIdx });

    try {
      await prisma.room.update({
        where: { code },
        data: {
          isPlaying: true,
          currentTime: 0,
          currentTrack: nextTrack?.videoId || nextTrack?.id,
        },
      });
    } catch (e) {}

    io.to(code).emit("receive_message", {
      id: String(Date.now()),
      senderId: "system",
      user: "System",
      name: "System",
      message: `⏭️ ${reason}: Now playing "${nextTrack.title}"`,
      text: `⏭️ ${reason}: Now playing "${nextTrack.title}"`,
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    });
  };

  // 1. JOIN ROOM
  socket.on("join_room", async (data) => {
    const rawCode = data?.roomcode || data?.roomCode || data?.code || "";
    const code = String(rawCode).trim().toUpperCase();
    const username = data?.username || "Guest";

    if (!code) return;

    socket.join(code);
    socket.data.roomcode = code;
    socket.data.username = username;

    if (!roomMembers.has(code)) {
      roomMembers.set(code, []);
    }
    const members = roomMembers.get(code);

    const isHost = members.length === 0;
    const canPlay = isHost;

    socket.data.isHost = isHost;
    socket.data.canPlay = canPlay;

    if (!members.some((m) => m.id === socket.id)) {
      members.push({ id: socket.id, username, isHost, canPlay });
    }

    if (!roomSkipVotes.has(code)) {
      roomSkipVotes.set(code, new Set());
    }

    io.to(code).emit("room_users_update", members);
    console.log(`[ROOM] ${username} joined ${code} (Host: ${isHost}, ${members.length} active)`);

    try {
      let room = await prisma.room.findUnique({
        where: { code },
        include: {
          messages: {
            orderBy: { createdAt: "desc" },
            take: 30,
          },
        },
      });

      if (!room) {
        try {
          room = await prisma.room.create({
            data: { code },
            include: { messages: true },
          });
        } catch (createErr) {
          if (createErr.code === "P2002") {
            room = await prisma.room.findUnique({
              where: { code },
              include: {
                messages: {
                  orderBy: { createdAt: "desc" },
                  take: 30,
                },
              },
            });
          }
        }
      }

      const formattedMessages = (room?.messages || []).reverse().map((msg) => ({
        id: msg.id,
        userId: msg.sender,
        name: msg.sender,
        sender: msg.sender,
        user: msg.sender,
        text: msg.text,
        message: msg.text,
        time: new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        color: "bg-avatar-2",
      }));

      const activeCount = members.length;
      const requiredSkips = Math.floor(activeCount / 2) + 1;
      const currentSkips = roomSkipVotes.get(code)?.size || 0;

      socket.emit("sync_state", {
        currentTrack: room?.currentTrack,
        isPlaying: room?.isPlaying,
        currentTime: room?.currentTime,
        recentMessages: formattedMessages,
        isHost,
        canPlay,
        queue: roomQueues.get(code) || null,
        skipVotes: { count: currentSkips, required: requiredSkips, hasVoted: roomSkipVotes.get(code)?.has(socket.id) || false },
      });
    } catch (err) {
      console.error(`[DB ERROR] Neon fetch failed: ${err.message}`);
    }
  });

  // 2. TOGGLE DJ PERMISSION (Host Only)
  socket.on("toggle_dj_permission", ({ roomcode, targetUserId }) => {
    const code = String(roomcode || socket.data.roomcode || "").trim().toUpperCase();
    if (!code || !roomMembers.has(code)) return;

    const members = roomMembers.get(code);
    const requester = members.find((m) => m.id === socket.id);

    if (!requester?.isHost) {
      socket.emit("permission_denied", { message: "Only the Room Host can grant or revoke DJ permissions." });
      return;
    }

    const target = members.find((m) => m.id === targetUserId);
    if (!target) return;

    target.canPlay = !target.canPlay;
    io.to(code).emit("room_users_update", members);

    const actionText = target.canPlay ? "granted DJ playback rights" : "revoked DJ playback rights";
    io.to(code).emit("receive_message", {
      id: String(Date.now()),
      senderId: "system",
      user: "System",
      name: "System",
      message: `🎧 ${requester.username} ${actionText} to ${target.username}.`,
      text: `🎧 ${requester.username} ${actionText} to ${target.username}.`,
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    });
  });

  // 3. PLAY MUSIC
  socket.on("play_music", async ({ roomcode, currentTime }) => {
    const code = String(roomcode || socket.data.roomcode || "").trim().toUpperCase();
    if (!code || !canControlPlayback(code)) {
      socket.emit("permission_denied", { message: "You don't have DJ permissions to control playback." });
      return;
    }

    socket.to(code).emit("music_played", { currentTime });

    try {
      await prisma.room.update({
        where: { code },
        data: { isPlaying: true, currentTime: Math.floor(currentTime || 0) },
      });
    } catch (e) {}
  });

  // 4. PAUSE MUSIC
  socket.on("pause_music", async ({ roomcode, currentTime }) => {
    const code = String(roomcode || socket.data.roomcode || "").trim().toUpperCase();
    if (!code || !canControlPlayback(code)) {
      socket.emit("permission_denied", { message: "You don't have DJ permissions to control playback." });
      return;
    }

    socket.to(code).emit("music_paused", { currentTime });

    try {
      await prisma.room.update({
        where: { code },
        data: { isPlaying: false, currentTime: Math.floor(currentTime || 0) },
      });
    } catch (e) {}
  });

  // 5. SEEK MUSIC
  socket.on("seek_music", async ({ roomcode, currentTime }) => {
    const code = String(roomcode || socket.data.roomcode || "").trim().toUpperCase();
    if (!code || !canControlPlayback(code)) return;

    socket.to(code).emit("music_seeked", { currentTime });

    try {
      await prisma.room.update({
        where: { code },
        data: { currentTime: Math.floor(currentTime || 0) },
      });
    } catch (e) {}
  });

  // 6. CHANGE TRACK (Direct skip or click by DJ)
  socket.on("change_track", async ({ roomcode, trackIndex }) => {
    const code = String(roomcode || socket.data.roomcode || "").trim().toUpperCase();
    if (!code || !canControlPlayback(code)) {
      socket.emit("permission_denied", { message: "You don't have DJ permissions to change tracks." });
      return;
    }

    // Reset skip votes on manual change
    if (roomSkipVotes.has(code)) {
      roomSkipVotes.get(code).clear();
    }
    const requiredSkips = Math.floor((roomMembers.get(code)?.length || 1) / 2) + 1;
    io.to(code).emit("skip_votes_update", { count: 0, required: requiredSkips });

    socket.to(code).emit("track_changed", { trackIndex });

    try {
      const queue = roomQueues.get(code);
      const newTrack = queue?.[trackIndex];
      await prisma.room.update({
        where: { code },
        data: {
          isPlaying: true,
          currentTime: 0,
          ...(newTrack && { currentTrack: newTrack.videoId || newTrack.id }),
        },
      });
    } catch (e) {}
  });

  // 7. AUTO PLAY NEXT TRACK (Fired automatically by current DJ when track ends)
  socket.on("track_ended_auto_next", async ({ roomcode }) => {
    const code = String(roomcode || socket.data.roomcode || "").trim().toUpperCase();
    if (!code || !canControlPlayback(code)) return;
    await advanceToNextSong(code, "Auto-play");
  });

  // 8. VOTE TO SKIP CURRENT SONG (Any Listener or Co-DJ)
  socket.on("vote_to_skip", async ({ roomcode }) => {
    const code = String(roomcode || socket.data.roomcode || "").trim().toUpperCase();
    if (!code) return;

    if (!roomSkipVotes.has(code)) {
      roomSkipVotes.set(code, new Set());
    }

    const voters = roomSkipVotes.get(code);
    const hasVoted = voters.has(socket.id);

    if (hasVoted) {
      voters.delete(socket.id);
    } else {
      voters.add(socket.id);
    }

    const members = roomMembers.get(code) || [];
    const activeCount = members.length;
    // Strict majority rule: > 50%
    const requiredSkips = Math.floor(activeCount / 2) + 1;
    const currentSkips = voters.size;

    io.to(code).emit("skip_votes_update", {
      count: currentSkips,
      required: requiredSkips,
    });

    // Check if majority threshold is reached
    if (currentSkips >= requiredSkips) {
      await advanceToNextSong(code, `Democratic skip threshold reached (${currentSkips}/${activeCount})`);
    }
  });

  // 9. SYNC TIME CLOCK (DJ Heartbeat)
  socket.on("sync_time", ({ roomcode, currentTime }) => {
    const code = String(roomcode || socket.data.roomcode || "").trim().toUpperCase();
    if (!code || !canControlPlayback(code)) return;
    socket.to(code).emit("sync_time_update", { currentTime });
  });

  // 10. ADD TO SHARED QUEUE
  socket.on("add_to_queue", async ({ roomcode, song }) => {
    const code = String(roomcode || socket.data.roomcode || "").trim().toUpperCase();
    if (!code || !song) return;

    if (!roomQueues.has(code)) {
      roomQueues.set(code, []);
    }
    const queue = roomQueues.get(code);
    const newSong = { ...song, votes: song.votes || [] };
    queue.push(newSong);

    io.to(code).emit("queue_updated", queue);
  });

  // 11. VOTE FOR QUEUE PRIORITY (Democratic sorting)
  socket.on("vote_track", ({ roomcode, trackId, currentTrackId, defaultQueue }) => {
    const code = String(roomcode || socket.data.roomcode || "").trim().toUpperCase();
    if (!code || !trackId) return;

    // 1. If backend memory hasn't stored the room queue yet, seed it with the client's current queue
    if (!roomQueues.has(code) || (roomQueues.get(code) || []).length === 0) {
      if (Array.isArray(defaultQueue) && defaultQueue.length > 0) {
        roomQueues.set(
          code,
          defaultQueue.map((t) => ({ ...t, votes: t.votes || [] }))
        );
      } else {
        return;
      }
    }

    let queue = roomQueues.get(code);

    // 2. Toggle voter socket ID
    let trackFound = false;
    queue = queue.map((t) => {
      if (t.id === trackId) {
        trackFound = true;
        const votes = Array.isArray(t.votes) ? [...t.votes] : [];
        const hasVoted = votes.includes(socket.id);
        const updatedVotes = hasVoted
          ? votes.filter((id) => id !== socket.id)
          : [...votes, socket.id];
        return { ...t, votes: updatedVotes };
      }
      return t;
    });

    if (!trackFound) return;

    // 3. Dynamically re-sort keeping the currently playing track pinned at index 0
    const sorted = sortQueue(queue, currentTrackId);
    roomQueues.set(code, sorted);

    // 4. Broadcast updated queue with vote counts to all listeners in room
    io.to(code).emit("queue_updated", sorted);
  });
  // 12. SEND CHAT MESSAGE
  socket.on("send_message", async (data) => {
    const code = String(data?.roomcode || socket.data.roomcode || "").trim().toUpperCase();
    const text = typeof data === "string" ? data : (data?.message || data?.text || "");
    const username = data?.username || socket.data.username || "Guest";

    if (!code || !text) return;

    try {
      const room = await prisma.room.findUnique({ where: { code } });
      if (!room) return;

      const saved = await prisma.chatMessage.create({
        data: {
          roomId: room.id,
          sender: username,
          text,
        },
      });

      const timeFormatted = new Date(saved.createdAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });

      io.to(code).emit("receive_message", {
        id: saved.id,
        senderId: socket.id,
        user: saved.sender,
        name: saved.sender,
        message: saved.text,
        text: saved.text,
        time: timeFormatted,
      });
    } catch (err) {
      console.error(`[DB ERROR] send_message failed: ${err.message}`);
    }
  });

  // 13. DISCONNECT CLEANUP
  socket.on("disconnect", () => {
    console.log(`[DISCONNECT] User disconnected: ${socket.id}`);
    const code = socket.data.roomcode;
    if (code && roomMembers.has(code)) {
      let members = roomMembers.get(code);
      const wasHost = members.find((m) => m.id === socket.id)?.isHost;
      members = members.filter((m) => m.id !== socket.id);

      // Clean up user's skip vote
      if (roomSkipVotes.has(code)) {
        roomSkipVotes.get(code).delete(socket.id);
        const requiredSkips = Math.floor(members.length / 2) + 1;
        io.to(code).emit("skip_votes_update", {
          count: roomSkipVotes.get(code).size,
          required: requiredSkips,
        });
      }

      if (wasHost && members.length > 0) {
        members[0].isHost = true;
        members[0].canPlay = true;
        console.log(`[HOST MIGRATION] Room Host transferred to ${members[0].username} in ${code}`);
      }

      roomMembers.set(code, members);
      io.to(code).emit("room_users_update", members);

      if (members.length === 0) {
        roomMembers.delete(code);
        roomQueues.delete(code);
        roomSkipVotes.delete(code);
      }
    }
  });
});

const PORT = process.env.PORT || 8000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Chill_X listening on port ${PORT}`);
});