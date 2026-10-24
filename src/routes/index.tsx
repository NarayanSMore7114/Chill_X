import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowRight, Check, Copy, Plus, Sparkles } from "lucide-react";
import { AVATAR_COLORS, genCode } from "@/lib/mock";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Chill_X — Sync music & vibe together" },
      { name: "description", content: "Create or join a room and listen to YouTube music in real time with friends." },
      { property: "og:title", content: "Chill_X — Sync music & vibe together" },
      { property: "og:description", content: "Real-time collaborative music listening rooms with live chat and a shared queue." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Lobby,
});

function Lobby() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [color, setColor] = useState(AVATAR_COLORS[0]);
  const [created, setCreated] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const saved = sessionStorage.getItem("chillx-user");
    if (saved) {
      const u = JSON.parse(saved);
      setName(u.name ?? "");
      if (u.color) setColor(u.color);
    }
  }, []);

  const enter = (code: string) => {
    sessionStorage.setItem("chillx-user", JSON.stringify({ name: name.trim() || "Guest", color }));
    navigate({ to: "/room/$code", params: { code } });
  };

  const validJoin = /^CHILL-\d{3}$/.test(joinCode);

  return (
    <main className="bg-ambient flex min-h-screen items-center justify-center p-4">
      <div className="glass w-full max-w-md rounded-2xl p-8 shadow-2xl">
        <div className="text-center">
          <h1 className="font-display text-4xl font-bold tracking-tight">
            Chill<span className="text-primary">_X</span> 🎵
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">Sync music & vibe together</p>
        </div>

        <div className="mt-8 space-y-3">
          <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Your identity</label>
          <div className="flex items-center gap-3">
            <div className={cn("grid size-11 shrink-0 place-items-center rounded-full font-display font-bold text-primary-foreground", color)}>
              {(name.trim()[0] ?? "?").toUpperCase()}
            </div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 20))}
              placeholder="Display name"
              className="h-11 w-full rounded-lg border border-input bg-surface px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <div className="flex gap-2">
            {AVATAR_COLORS.map((c) => (
              <button
                key={c}
                aria-label="Avatar color"
                onClick={() => setColor(c)}
                className={cn("press size-7 rounded-full ring-offset-2 ring-offset-card hover:scale-110", c, color === c && "ring-2 ring-foreground")}
              />
            ))}
          </div>
        </div>

        <div className="mt-8 rounded-xl border border-border bg-surface/60 p-4">
          <h2 className="text-sm font-semibold">Create a Room</h2>
          {created ? (
            <div className="mt-3 space-y-3">
              <button
                onClick={() => { navigator.clipboard?.writeText(created); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
                className="press flex w-full items-center justify-between rounded-lg border border-primary/40 bg-primary/10 px-4 py-3 font-display text-lg font-bold tracking-widest text-primary"
              >
                {created}
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              </button>
              <button onClick={() => enter(created)} className="press flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-gradient-primary font-semibold text-primary-foreground shadow-glow hover:brightness-110">
                Enter room <ArrowRight className="size-4" />
              </button>
            </div>
          ) : (
            <button onClick={() => setCreated(genCode())} className="press mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-gradient-primary font-semibold text-primary-foreground shadow-glow hover:brightness-110">
              <Sparkles className="size-4" /> Create a Room
            </button>
          )}
        </div>

        <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
          <div className="h-px flex-1 bg-border" /> OR <div className="h-px flex-1 bg-border" />
        </div>

        <div className="rounded-xl border border-border bg-surface/60 p-4">
          <h2 className="text-sm font-semibold">Join a Room</h2>
          <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (validJoin) enter(joinCode); }}>
            <input
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase().slice(0, 9))}
              placeholder="CHILL-000"
              className="h-11 w-full rounded-lg border border-input bg-background px-3 font-display text-sm uppercase tracking-widest outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/30"
            />
            <button disabled={!validJoin} className="press flex h-11 items-center gap-1 rounded-lg bg-secondary px-5 font-semibold hover:bg-accent disabled:opacity-40">
              <Plus className="size-4" /> Join
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
