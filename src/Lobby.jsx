function Lobby({ joinCode, setJoinCode, onCreateRoom, onJoinRoom }) {
  return (
    <div className="lobby-view">
      {/* 1. Ensure onClick uses onCreateRoom */}
      <button 
        onClick={onCreateRoom}
        style={{ padding: "10px 20px", fontSize: "16px", cursor: "pointer" }}
      >
        Create Room
      </button>

      <div style={{ marginTop: "20px", display: "flex", gap: "8px", justifyContent: "center" }}>
        <input
          type="text"
          placeholder="Enter Room Code"
          value={joinCode}
          onChange={(e) => setJoinCode(e.target.value)}
          style={{ padding: "8px 12px", fontSize: "14px" }}
        />
        {/* 2. Ensure onClick uses onJoinRoom */}
        <button 
          onClick={onJoinRoom}
          style={{ padding: "8px 16px", fontSize: "14px", cursor: "pointer" }}
        >
          Join Room
        </button>
      </div>
    </div>
  );
}

export default Lobby;