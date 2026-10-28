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

// Helper: Converts ISO 8601 (e.g. PT5M55S, PT1H2M10S, PT45S) into integer seconds
function parseYouTubeDuration(duration) {
  if (!duration) return 180;
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 180;
  const hours = parseInt(match[1] || 0, 10);
  const minutes = parseInt(match[2] || 0, 10);
  const seconds = parseInt(match[3] || 0, 10);
  return hours * 3600 + minutes * 60 + seconds;
}

// Helper: 2-step YouTube search that fetches snippets AND real durations
async function searchYouTube(query) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) throw new Error("YOUTUBE_API_KEY is not defined in environment variables");

  // 1. Search for matching videos
  const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoEmbeddable=true&maxResults=10&q=${encodeURIComponent(query)}&key=${apiKey}`;
  const searchRes = await fetch(searchUrl);
  const searchData = await searchRes.json();

  if (!searchData.items || searchData.items.length === 0) {
    return [];
  }

  const videoIds = searchData.items
    .map((item) => item.id?.videoId)
    .filter(Boolean)
    .join(",");

  if (!videoIds) return [];

  // 2. Fetch contentDetails to get the REAL ISO 8601 duration
  const detailsUrl = `https://www.googleapis.com/youtube/v3/videos?part=contentDetails,snippet&id=${videoIds}&key=${apiKey}`;
  const detailsRes = await fetch(detailsUrl);
  const detailsData = await detailsRes.json();

  return (detailsData.items || []).map((v) => {
    const durationSeconds = parseYouTubeDuration(v.contentDetails?.duration);
    return {
      id: v.id,
      videoId: v.id,
      url: v.id,
      title: v.snippet.title,
      artist: v.snippet.channelTitle,
      thumbnail: v.snippet.thumbnails?.high?.url || v.snippet.thumbnails?.default?.url,
      duration: durationSeconds, // Real duration in seconds (e.g., 355 for 5:55)
      votes: [],
    };
  });
}

// Health check endpoint
app.get("/", async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.send("Chill_X server is live and database is connected");
  } catch (error) {
    res.status(500).send(`Server live, DB error: ${error.message}`);
  }
});

// HTTP Search Route
app.get("/api/search", async (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).json({ error: "Missing search query" });

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

// In-memory room state storage
const rooms = new Map();

function getOrCreateRoom(roomcode) {
  if (!rooms.has(roomcode)) {
    rooms.set(roomcode, {
      queue: [],
      currentTrackIndex: 0,
      currentTime: 0,
      isPlaying: false,
      users: new Map(),
      messages: [],
      skipVotes: new Set(),
    });
  }
  return rooms.get(roomcode);
}

io.on("connection", (socket) => {
  // Direct Socket Search handler (also returns real duration)
  socket.on("search_youtube", async (query, callback) => {
    try {
      const tracks = await searchYouTube(query);
      if (typeof callback === "function") {
        callback({ success: true, results: tracks });
      }
    } catch (err) {
      if (typeof callback === "function") {
        callback({ success: false, error: err.message });
      }
    }
  });

  socket.on("join_room", async ({ roomcode, username }) => {
    socket.join(roomcode);
    const room = getOrCreateRoom(roomcode);
    const isFirst = room.users.size === 0;

    room.users.set(socket.id, {
      id: socket.id,
      username: username || "Guest",
      isHost: isFirst,
      canPlay: isFirst,
    });

    // Send initial sync state to the new client
    socket.emit("sync_state", {
      isPlaying: room.isPlaying,
      currentTime: room.currentTime,
      isHost: isFirst,
      canPlay: isFirst,
      queue: room.queue,
      currentTrackId: room.queue[room.currentTrackIndex]?.id || null,
      recentMessages: room.messages.slice(-30),
      skipVotes: {
        count: room.skipVotes.size,
        required: Math.floor(room.users.size / 2) + 1,
        hasVoted: room.skipVotes.has(socket.id),
      },
    });

    // Notify room of active members
    io.to(roomcode).emit("room_users_update", Array.from(room.users.values()));
  });

  socket.on("add_to_queue", ({ roomcode, song }) => {
    const room = getOrCreateRoom(roomcode);
    room.queue.push(song);
    io.to(roomcode).emit("queue_updated", room.queue);
  });

  socket.on("play_music", ({ roomcode, currentTime }) => {
    const room = getOrCreateRoom(roomcode);
    const user = room.users.get(socket.id);
    if (!user?.canPlay && !user?.isHost) return;

    room.isPlaying = true;
    if (typeof currentTime === "number") room.currentTime = currentTime;
    socket.to(roomcode).emit("music_played", { currentTime: room.currentTime });
  });

  socket.on("pause_music", ({ roomcode, currentTime }) => {
    const room = getOrCreateRoom(roomcode);
    const user = room.users.get(socket.id);
    if (!user?.canPlay && !user?.isHost) return;

    room.isPlaying = false;
    if (typeof currentTime === "number") room.currentTime = currentTime;
    socket.to(roomcode).emit("music_paused", { currentTime: room.currentTime });
  });

  socket.on("seek_music", ({ roomcode, currentTime }) => {
    const room = getOrCreateRoom(roomcode);
    const user = room.users.get(socket.id);
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
    const user = room.users.get(socket.id);
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
    if (room.skipVotes.has(socket.id)) {
      room.skipVotes.delete(socket.id);
    } else {
      room.skipVotes.add(socket.id);
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

  socket.on("disconnect", () => {
    for (const [roomcode, room] of rooms.entries()) {
      if (room.users.has(socket.id)) {
        room.users.delete(socket.id);
        room.skipVotes.delete(socket.id);
        io.to(roomcode).emit("room_users_update", Array.from(room.users.values()));
        io.to(roomcode).emit("skip_votes_update", {
          count: room.skipVotes.size,
          required: Math.floor(room.users.size / 2) + 1,
        });
      }
    }
  });
});

const PORT = process.env.PORT || 8000;
server.listen(PORT, () => {
  console.log(`Chill_X listening on port ${PORT}`);
});