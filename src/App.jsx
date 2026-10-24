import { useState } from "react";
import Lobby from "./Lobby";
import "./App.css";
import Room from "./Room";

import { io } from "socket.io-client";
const socket = io("http://localhost:8000");

function App() {
  const [joinCode, setJoinCode] = useState("");
  const [roomcode, setRoomCode] = useState("");

  function handleClick() {
    let code = "CHILL" + (Math.floor(Math.random() * 900) + 100);
    console.log("Generated Room Code:", code);
    setRoomCode(code);
    socket.emit("join_room", { roomcode: code, username: "Host" });
  }

  function handleJoinRoom() {
    if (joinCode.trim() === "") {
      alert("Cannot be Empty");
      return;
    }
    const cleanCode = joinCode.trim().toUpperCase();
    setRoomCode(cleanCode);
    socket.emit("join_room", { roomcode: cleanCode, username: "Guest" });
    setJoinCode("");
  }

  function Leaveroom() {
    setRoomCode("");
  }

  return (
    <div className="app-container">
      <div className="card">
        <h1>Chill_X 🎵</h1>
        <p>Listen to music together.</p>

        {roomcode ? (
          <Room
            roomcode={roomcode}
            onLeave={Leaveroom}
            socket={socket}
          />
        ) : (
          <Lobby 
            joinCode={joinCode} 
            setJoinCode={setJoinCode} 
            onCreateRoom={handleClick}
            onJoinRoom={handleJoinRoom}
          />
        )}
      </div>
    </div>
  );
}

// 👈 Make sure this exact line is at the end:
export default App;