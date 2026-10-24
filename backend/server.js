const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const ytSearch = require("yt-search");

const app = express();

// 1. Fallback to 8000 locally, Render supplies process.env.PORT
const PORT = process.env.PORT || 8000;

// 2. Allow local dev ports and allow all origins in production
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // Allows localhost and future deployed Vercel domain
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// Health check endpoint for Render keep-alive
app.get("/", (req, res) => {
  res.send("Chill_X server is live and ready");
});

const roomUsers = {};

function broadcastRoomUsers(roomcode) {
  if (roomUsers[roomcode]) {
    io.to(roomcode).emit("room_users_update", roomUsers[roomcode]);
  }
}

io.on("connection", (socket) => {
  console.log(`[CONNECT] User connected: ${socket.id}`);

  // 1. Join Room
  socket.on("join_room", (data) => {
    let rawCode = typeof data === "object" ? data.roomcode : data;
    const roomcode = String(rawCode || "").trim().toUpperCase();
    const username = (typeof data === "object" && data.username) || `User-${socket.id.slice(0, 4)}`;

    if (!roomcode) return;

    socket.join(roomcode);
    socket.currentRoom = roomcode;

    if (!roomUsers[roomcode]) {
      roomUsers[roomcode] = [];
    }

    const userObj = { id: socket.id, username, isLive: true };
    const existingIndex = roomUsers[roomcode].findIndex((u) => u.id === socket.id);
    if (existingIndex !== -1) {
      roomUsers[roomcode][existingIndex] = userObj;
    } else {
      roomUsers[roomcode].push(userObj);
    }

    const count = io.sockets.adapter.rooms.get(roomcode)?.size || 0;
    console.log(`[JOIN] ${username} (${socket.id}) -> Room "${roomcode}" | Active: ${count}`);

    broadcastRoomUsers(roomcode);
  });

  // 2. Playback Sync
  socket.on("play_music", (data) => {
    const roomcode = String(typeof data === "object" ? data.roomcode : data || "").trim().toUpperCase();
    const currentTime = typeof data === "object" ? data.currentTime : 0;
    console.log(`[PLAY] Room "${roomcode}" from ${socket.id} at ${currentTime}s`);
    socket.to(roomcode).emit("music_played", { currentTime });
  });

  socket.on("pause_music", (data) => {
    const roomcode = String(typeof data === "object" ? data.roomcode : data || "").trim().toUpperCase();
    const currentTime = typeof data === "object" ? data.currentTime : 0;
    console.log(`[PAUSE] Room "${roomcode}" from ${socket.id} at ${currentTime}s`);
    socket.to(roomcode).emit("music_paused", { currentTime });
  });

  socket.on("seek_music", (data) => {
    const roomcode = String(data?.roomcode || "").trim().toUpperCase();
    const currentTime = data?.currentTime || 0;
    console.log(`[SEEK] Room "${roomcode}" to ${currentTime}s`);
    socket.to(roomcode).emit("music_seeked", { currentTime });
  });

  socket.on("change_track", (data) => {
    const roomcode = String(data?.roomcode || "").trim().toUpperCase();
    const trackIndex = data?.trackIndex || 0;
    console.log(`[TRACK] Room "${roomcode}" -> Index ${trackIndex}`);
    socket.to(roomcode).emit("track_changed", { trackIndex });
  });

  // 3. YouTube Search (safe callback guard)
  socket.on("search_youtube", async (query, callback) => {
    const reply = typeof callback === "function" ? callback : () => {};
    try {
      if (!query || !query.trim()) return reply({ success: false, results: [] });
      const searchResult = await ytSearch(query);
      const videos = (searchResult.videos || []).slice(0, 5).map((v) => ({
        id: v.videoId,
        title: v.title,
        artist: v.author ? v.author.name : "Unknown",
        thumbnail: v.thumbnail,
        duration: v.timestamp,
      }));
      reply({ success: true, results: videos });
    } catch (err) {
      reply({ success: false, results: [] });
    }
  });

  // 4. Queue Sync
  socket.on("add_to_queue", (data) => {
    const roomcode = String(data?.roomcode || "").trim().toUpperCase();
    io.to(roomcode).emit("song_added_to_queue", { song: data.song });
  });

  // 5. Chat Sync
  socket.on("send_message", ({ roomcode, message, username }) => {
    const normalizedRoom = String(roomcode || "").trim().toUpperCase();
    const now = new Date().toTimeString().slice(0, 5);

    socket.to(normalizedRoom).emit("receive_message", {
      senderId: socket.id,
      user: username || "Guest",
      message,
      time: now,
    });
  });

  // 6. Disconnect
  socket.on("disconnect", () => {
    const roomcode = socket.currentRoom;
    if (roomcode && roomUsers[roomcode]) {
      roomUsers[roomcode] = roomUsers[roomcode].filter((u) => u.id !== socket.id);
      broadcastRoomUsers(roomcode);
    }
    console.log(`[DISCONNECT] User disconnected: ${socket.id}`);
  });
});

server.listen(PORT, () => {
  console.log(`Chill_X listening on http://localhost:${PORT}`);
});