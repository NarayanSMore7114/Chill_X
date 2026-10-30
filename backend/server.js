import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";

dotenv.config();

const app = express();
const server = http.createServer(app);
const prisma = new PrismaClient();

app.use(cors({ origin: "*" }));
app.use(express.json());

// In-memory 30-minute search cache to protect YouTube quota limits
const searchCache = new Map();
const CACHE_TTL = 30 * 60 * 1000;

function getCachedResults(key) {
  const item = searchCache.get(key.toLowerCase().trim());
  if (!item) return null;
  if (Date.now() - item.timestamp > CACHE_TTL) {
    searchCache.delete(key.toLowerCase().trim());
    return null;
  }
  return item.data;
}

function setCachedResults(key, data) {
  if (searchCache.size > 200) {
    const firstKey = searchCache.keys().next().value;
    searchCache.delete(firstKey);
  }
  searchCache.set(key.toLowerCase().trim(), { data, timestamp: Date.now() });
}

// Converts ISO 8601 (PT5M55S, PT1H2M10S, PT45S) into integer seconds
function parseYouTubeDuration(duration) {
  if (!duration) return 180;
  const hoursMatch = duration.match(/(\d+)H/);
  const minutesMatch = duration.match(/(\d+)M/);
  const secondsMatch = duration.match(/(\d+)S/);

  const hours = hoursMatch ? parseInt(hoursMatch[1], 10) : 0;
  const minutes = minutesMatch ? parseInt(minutesMatch[1], 10) : 0;
  const seconds = secondsMatch ? parseInt(secondsMatch[1], 10) : 0;

  const total = hours * 3600 + minutes * 60 + seconds;
  return total > 0 ? total : 180;
}

// 2-step YouTube search fetching verified contentDetails duration
async function searchYouTube(query) {
  const cached = getCachedResults(query);
  if (cached) return cached;

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    console.warn("[YOUTUBE API] Warning: YOUTUBE_API_KEY is missing");
    return [];
  }

  // 1. Search for video IDs
  const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoEmbeddable=true&maxResults=10&q=${encodeURIComponent(query)}&key=${apiKey}`;
  const searchRes = await fetch(searchUrl);
  const searchData = await searchRes.json();

  if (!searchData.items || searchData.items.length === 0) return [];

  const videoIds = searchData.items
    .map((item) => item.id?.videoId)
    .filter(Boolean)
    .join(",");

  if (!videoIds) return [];

  // 2. Fetch contentDetails for true duration
  const detailsUrl = `https://www.googleapis.com/youtube/v3/videos?part=contentDetails,snippet&id=${videoIds}&key=${apiKey}`;
  const detailsRes = await fetch(detailsUrl);
  const detailsData = await detailsRes.json();

  const results = (detailsData.items || []).map((v) => {
    const durationSeconds = parseYouTubeDuration(v.contentDetails?.duration);
    return {
      id: v.id,
      videoId: v.id,
      url: v.id,
      title: v.snippet.title,
      artist: v.snippet.channelTitle,
      thumbnail: v.snippet.thumbnails?.high?.url || v.snippet.thumbnails?.medium?.url || v.snippet.thumbnails?.default?.url,
      duration: durationSeconds,
      votes: [],
    };
  });

  setCachedResults(query, results);
  return results;
}

app.get("/", async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.send("Chill_X server is live and database is connected");
  } catch (error) {
    res.status(200).send(`Server is live. Database status: ${error.message}`);
  }
});

app.get("/api/search", async (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).json({ error: "Missing query" });

  try {
    const tracks = await searchYouTube(query);
    res.json({ tracks });
  } catch (err) {
    console.error("[SEARCH ERROR]:", err);
    res.status(500).json({ error: err.message || "Failed to search YouTube" });
  }
});

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

const rooms = new Map();

function getOrCreateRoom(roomcode) {
  if (!rooms.has(roomcode)) {
    rooms.set(roomcode, {
      queue: [],
      currentTrackIndex: 0,
      currentTime: 0,
      isPlaying: false,
      hostUserId: null,
      users: new Map(),
      messages: [],
      skipVotes: new Set(),
    });
  }
  return rooms.get(roomcode);
}

// Resolve the participant by persistent user ID and reject stale socket connections.
function getSocketUser(room, socket) {
  if (!room || !socket.userId) return null;
  const user = room.users.get(socket.userId);
  if (!user || user.socketId !== socket.id) return null;
  return user;
}

io.on("connection", (socket) => {
  socket.on("search_youtube", async (query, callback) => {
    try {
      const tracks = await searchYouTube(query);
      if (typeof callback === "function") callback({ success: true, results: tracks });
    } catch (err) {
      if (typeof callback === "function") callback({ success: false, error: err.message });
    }
  });

  // Replace join_room, toggle_dj_permission, and disconnect in backend/server.js:

  socket.on("join_room", async ({ roomcode, username, userId }) => {
    socket.join(roomcode);
    const room = getOrCreateRoom(roomcode);

    // Use persistent userId from client sessionStorage, fallback to socket.id
    const persistentId = userId || socket.id;

    // Check if this user was already in the room (e.g., page refresh or reconnect)
    const existingUser = room.users.get(persistentId);

    // Determine host: if room has no host, or this reconnecting user was the host
    if (!room.hostUserId || room.hostUserId === persistentId) {
      room.hostUserId = persistentId;
    }

    const isHost = room.hostUserId === persistentId;
    // Preserve existing DJ rights if they already had them before reload
    const canPlay = isHost || (existingUser ? existingUser.canPlay : false);

    // Update / Rebind user to the new socket connection
    room.users.set(persistentId, {
      id: persistentId,
      socketId: socket.id,
      username: username || (existingUser ? existingUser.username : "Guest"),
      isHost,
      canPlay,
    });

    // Tag the socket instance so disconnect knows exactly who this is
    socket.userId = persistentId;
    socket.roomcode = roomcode;

    // Send initial synchronized state to reconnecting client
    socket.emit("sync_state", {
      isPlaying: room.isPlaying,
      currentTime: room.currentTime,
      isHost,
      canPlay,
      queue: room.queue,
      currentTrackId: room.queue[room.currentTrackIndex]?.id || null,
      recentMessages: room.messages.slice(-30),
      skipVotes: {
        count: room.skipVotes.size,
        required: Math.floor(room.users.size / 2) + 1,
        hasVoted: room.skipVotes.has(persistentId),
      },
    });

    // Broadcast updated user list with preserved roles
    io.to(roomcode).emit("room_users_update", Array.from(room.users.values()));
  });

  socket.on("toggle_dj_permission", ({ roomcode, targetUserId }) => {
    const room = getOrCreateRoom(roomcode);
    const callerId = socket.userId || socket.id;

    // Verify caller is the host using persistent ID
    if (room.hostUserId !== callerId) {
      return socket.emit("permission_denied", { message: "Only the Room Host can change DJ permissions." });
    }

    const targetUser = room.users.get(targetUserId);
    if (targetUser) {
      targetUser.canPlay = !targetUser.canPlay;
      io.to(roomcode).emit("room_users_update", Array.from(room.users.values()));
    }
  });

  socket.on("disconnect", () => {
    const { roomcode, userId } = socket;
    if (!roomcode || !userId) return;

    const room = rooms.get(roomcode);
    if (!room) return;

    // Give a 3-second grace period in case the user was just reloading the tab
    setTimeout(() => {
      const currentUser = room.users.get(userId);
      // If user hasn't reconnected with a newer socket within 3 seconds, remove them
      if (currentUser && currentUser.socketId === socket.id) {
        room.users.delete(userId);
        room.skipVotes.delete(userId);

        // If host permanently left, assign to next remaining user
        if (room.hostUserId === userId) {
          const nextUser = room.users.values().next().value;
          if (nextUser) {
            room.hostUserId = nextUser.id;
            nextUser.isHost = true;
            nextUser.canPlay = true;
          } else {
            room.hostUserId = null;
          }
        }

        io.to(roomcode).emit("room_users_update", Array.from(room.users.values()));
        io.to(roomcode).emit("skip_votes_update", {
          count: room.skipVotes.size,
          required: Math.floor(room.users.size / 2) + 1,
        });
      }
    }, 3000);
  });

  // Track Upvoting & Dynamic Queue Ordering
  socket.on("vote_track", ({ roomcode, trackId, defaultQueue }) => {
    const room = getOrCreateRoom(roomcode);

    if (room.queue.length === 0 && Array.isArray(defaultQueue) && defaultQueue.length > 0) {
      room.queue = [...defaultQueue];
    }

    const track = room.queue.find((t) => t.id === trackId || t.videoId === trackId);
    if (!track) return;

    if (!Array.isArray(track.votes)) track.votes = [];

    const voteIdx = track.votes.indexOf(socket.userId);
    if (voteIdx > -1) {
      track.votes.splice(voteIdx, 1);
    } else {
      track.votes.push(socket.userId);
    }

    if (room.queue.length > 1) {
      const currentTrack = room.queue[room.currentTrackIndex || 0];
      const rest = room.queue.filter((t) => t !== currentTrack);

      rest.sort((a, b) => (b.votes?.length || 0) - (a.votes?.length || 0));
      room.queue = [currentTrack, ...rest];
      room.currentTrackIndex = 0;
    }

    io.to(roomcode).emit("queue_updated", room.queue);
  });

  // Remove track from queue (Host or Co-DJ)
  socket.on("remove_from_queue", ({ roomcode, trackId }) => {
    const room = getOrCreateRoom(roomcode);
    const caller = getSocketUser(room, socket);
    if (!caller || (!caller.isHost && !caller.canPlay)) {
      return socket.emit("permission_denied", { message: "Only Host or DJs can remove songs." });
    }

    const trackIndex = room.queue.findIndex((t) => t.id === trackId || t.videoId === trackId);
    if (trackIndex === -1) return;

    const isCurrentTrack = trackIndex === room.currentTrackIndex;
    room.queue.splice(trackIndex, 1);

    if (isCurrentTrack) {
      room.currentTime = 0;
      if (room.queue.length > 0) {
        room.currentTrackIndex = room.currentTrackIndex % room.queue.length;
        io.to(roomcode).emit("track_changed", { trackIndex: room.currentTrackIndex });
      } else {
        room.isPlaying = false;
        io.to(roomcode).emit("music_paused", { currentTime: 0 });
      }
    } else if (trackIndex < room.currentTrackIndex) {
      room.currentTrackIndex = Math.max(0, room.currentTrackIndex - 1);
    }

    io.to(roomcode).emit("queue_updated", room.queue);
  });

  // Floating Emoji Reaction Broadcast
  socket.on("send_reaction", ({ roomcode, emoji }) => {
    io.to(roomcode).emit("receive_reaction", {
      id: `${Date.now()}-${Math.random()}`,
      emoji,
      senderId: socket.id,
    });
  });

  socket.on("add_to_queue", ({ roomcode, song }) => {
    const room = getOrCreateRoom(roomcode);
    if (!song.votes) song.votes = [];
    room.queue.push(song);
    io.to(roomcode).emit("queue_updated", room.queue);
  });

  socket.on("play_music", ({ roomcode, currentTime }) => {
    const room = getOrCreateRoom(roomcode);
    const user = getSocketUser(room, socket);
    if (!user?.canPlay && !user?.isHost) return;

    room.isPlaying = true;
    if (typeof currentTime === "number") room.currentTime = currentTime;
    socket.to(roomcode).emit("music_played", { currentTime: room.currentTime });
  });

  socket.on("pause_music", ({ roomcode, currentTime }) => {
    const room = getOrCreateRoom(roomcode);
    const user = getSocketUser(room, socket);
    if (!user?.canPlay && !user?.isHost) return;

    room.isPlaying = false;
    if (typeof currentTime === "number") room.currentTime = currentTime;
    socket.to(roomcode).emit("music_paused", { currentTime: room.currentTime });
  });

  socket.on("seek_music", ({ roomcode, currentTime }) => {
    const room = getOrCreateRoom(roomcode);
    const user = getSocketUser(room, socket);
    if (!user?.canPlay && !user?.isHost) return;

    room.currentTime = currentTime;
    socket.to(roomcode).emit("music_seeked", { currentTime });
  });

  socket.on("sync_time", ({ roomcode, currentTime }) => {
    const room = getOrCreateRoom(roomcode);
    room.currentTime = currentTime;
    socket.to(roomcode).emit("sync_time_update", { currentTime });
  });

  socket.on("change_track", ({ roomcode, trackIndex }) => {
    const room = getOrCreateRoom(roomcode);
    const user = getSocketUser(room, socket);
    if (!user?.canPlay && !user?.isHost) return;

    room.currentTrackIndex = trackIndex;
    room.currentTime = 0;
    room.isPlaying = true;
    room.skipVotes.clear();

    io.to(roomcode).emit("track_changed", { trackIndex });
    io.to(roomcode).emit("skip_votes_update", {
      count: 0,
      required: Math.floor(room.users.size / 2) + 1,
    });
  });

  socket.on("track_ended_auto_next", ({ roomcode }) => {
    const room = getOrCreateRoom(roomcode);
    if (room.queue.length > 0) {
      room.currentTrackIndex = (room.currentTrackIndex + 1) % room.queue.length;
      room.currentTime = 0;
      room.isPlaying = true;
      room.skipVotes.clear();

      io.to(roomcode).emit("track_changed", { trackIndex: room.currentTrackIndex });
      io.to(roomcode).emit("skip_votes_update", {
        count: 0,
        required: Math.floor(room.users.size / 2) + 1,
      });
    }
  });

  socket.on("vote_to_skip", ({ roomcode }) => {
    const room = getOrCreateRoom(roomcode);
    if (room.skipVotes.has(socket.userId)) {
      room.skipVotes.delete(socket.userId);
    } else {
      room.skipVotes.add(socket.userId);
    }

    const count = room.skipVotes.size;
    const required = Math.floor(room.users.size / 2) + 1;

    io.to(roomcode).emit("skip_votes_update", { count, required });

    if (count >= required && room.queue.length > 0) {
      room.currentTrackIndex = (room.currentTrackIndex + 1) % room.queue.length;
      room.currentTime = 0;
      room.isPlaying = true;
      room.skipVotes.clear();

      io.to(roomcode).emit("track_changed", { trackIndex: room.currentTrackIndex });
      io.to(roomcode).emit("skip_votes_update", {
        count: 0,
        required: Math.floor(room.users.size / 2) + 1,
      });
    }
  });

  socket.on("send_message", ({ roomcode, message, username }) => {
    const room = getOrCreateRoom(roomcode);
    const msg = {
      id: `${Date.now()}-${Math.random()}`,
      senderId: socket.id,
      name: username || "Guest",
      text: message,
      time: new Date().toTimeString().slice(0, 5),
    };
    room.messages.push(msg);
    if (room.messages.length > 50) room.messages.shift();
    io.to(roomcode).emit("receive_message", msg);
  });


});

const PORT = process.env.PORT || 8000;
server.listen(PORT, () => {
  console.log(`Chill_X listening on port ${PORT}`);
});