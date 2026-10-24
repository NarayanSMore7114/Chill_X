export type Track = { id: string; videoId: string; title: string; artist: string; duration: number };
export type Listener = { id: string; name: string; color: string; host?: boolean };
export type Message = { id: string; userId: string; name: string; color: string; text: string; time: string };

export const AVATAR_COLORS = ["bg-avatar-1", "bg-avatar-2", "bg-avatar-3", "bg-avatar-4", "bg-avatar-5", "bg-avatar-6"];

export const thumb = (videoId?: string) => {
  if (!videoId) return "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=300&q=80";
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
};

export const fmt = (s: number) => {
  const t = Math.max(0, Math.floor(s));
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
};

export const INITIAL_QUEUE: Track[] = [
  { id: "t1", videoId: "Dhk4jJCX8xo", title: "Yad Lagla - Sairat", artist: "Ajay-Atul", duration: 245 },
  { id: "t2", videoId: "fJ9rUzIMcZQ", title: "Bohemian Rhapsody", artist: "Queen", duration: 355 },
  { id: "t3", videoId: "kJQP7kiw5Fk", title: "Despacito", artist: "Luis Fonsi ft. Daddy Yankee", duration: 282 },
];

export const CATALOG: Track[] = [
  ...INITIAL_QUEUE,
  { id: "c1", videoId: "JGwWNGJdvx8", title: "Shape of You", artist: "Ed Sheeran", duration: 263 },
  { id: "c2", videoId: "4NRXx6U8ABQ", title: "Blinding Lights", artist: "The Weeknd", duration: 262 },
  { id: "c3", videoId: "hT_nvWreIhg", title: "Counting Stars", artist: "OneRepublic", duration: 283 },
  { id: "c4", videoId: "60ItHLz5WEA", title: "Faded", artist: "Alan Walker", duration: 212 },
  { id: "c5", videoId: "RgKAFK5djSk", title: "See You Again", artist: "Wiz Khalifa ft. Charlie Puth", duration: 237 },
  { id: "c6", videoId: "lTRiuFIWV54", title: "Lofi Hip Hop Radio - Beats to Relax", artist: "Lofi Girl", duration: 3600 },
];

export const MOCK_LISTENERS: Listener[] = [
  { id: "host", name: "Host", color: "bg-avatar-1", host: true },
  { id: "sarah", name: "Sarah", color: "bg-avatar-5" },
  { id: "alex", name: "Alex", color: "bg-avatar-4" },
];

export const MOCK_MESSAGES: Message[] = [
  { id: "m1", userId: "host", name: "Host", color: "bg-avatar-1", text: "Welcome to the room! Starting with some Ajay-Atul 🔥", time: "21:02" },
  { id: "m2", userId: "sarah", name: "Sarah", color: "bg-avatar-5", text: "Yesss this song is a vibe 😍", time: "21:03" },
  { id: "m3", userId: "alex", name: "Alex", color: "bg-avatar-4", text: "Queued Bohemian Rhapsody next, no skipping 🎸", time: "21:04" },
];

export const genCode = () => `CHILL-${Math.floor(100 + Math.random() * 900)}`;
