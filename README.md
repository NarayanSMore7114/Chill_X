# Together Tune Room

Create a modern, dark-mode real-time collaborative music listening web application called "Chill_X". 

### 1. Aesthetic & Design System:

- Theme: Deep obsidian/zinc dark mode (backgrounds: #09090b, #121216, cards: #18181b with 1px subtle borders #27272a).

- Accent Colors: Electric Indigo/Violet (#6366f1) and Neon Emerald for live indicators (#10b981).

- Feel: Glassmorphic, minimalist, inspired by Spotify desktop combined with Discord rooms.

- Typography: Clean sans-serif with crisp contrast and polished micro-interactions (hover transitions, active scale states).

### 2. View 1: Lobby (Entry Screen)

- Centered glass card with the brand logo "Chill_X 🎵" and a tag: "Sync music & vibe together".

- Section A: "Create a Room" button that generates a code (e.g., CHILL-782).

- Section B: "Join a Room" with a clean uppercase code input field and a "Join" button.

- User input field to set a Display Name / Avatar color before joining.

### 3. View 2: Main Listening Room (Desktop Split Layout)

Create a responsive 3-section dashboard:

#### Header / Top Bar:

- Left: App Logo + Current Room Code pill with a "Click to Copy" button and share link icon.

- Right: "Active Listeners" horizontal avatar stack (with green pulsating live status dots, name tooltips, and a total listener count badge, e.g. "🎧 3 Listeners").

- "Leave Room" destructive button.

#### Center / Main Stage:

- Top Search Bar: Search input with magnifying glass icon for finding YouTube tracks, showing an interactive results dropdown with thumbnail, title, channel name, duration, and an "+ Add to Queue" button.

- Media Screen: 16:9 embedded video player frame with rounded corners and a sleek subtle glow effect around the borders.

- Player Controls Card (Glassmorphism):

  - Current song thumbnail, title (scrolling marquee if long), and artist label.

  - Scrubbing timeline: current timestamp (e.g. 01:24), interactive custom range slider/track progress bar, and total duration.

  - Control buttons row:

    - -10s quick-rewind button

    - Previous track

    - Primary glowing Play / Pause button (accent color)

    - Next track

    - +10s quick-forward button

    - Volume slider with mute toggle icon.

#### Right Column / Collapsible Sidebar:

- Tabbed container or stacked dual view:

  1. Tab 1 - "Up Next / Queue":

     - List of queued tracks with reorder handles, thumbnail, song title, artist, duration, and a remove button.

     - "Now Playing" badge highlighting the active song.

  2. Tab 2 - "Live Chat":

     - Scrollable message stream with user avatar, name pill, timestamp, and message bubbles.

     - Bottom sticky input bar with emoji picker toggle and "Send" button.

### 4. Interactive Mock States:

- Pre-populate mock playlist with 3 tracks (e.g., "Yad Lagla - Sairat", "Bohemian Rhapsody", "Despacito").

- Pre-fill mock active listeners (Host, Sarah, Alex) and mock chat messages to visualize a live session.

- Add functional play/pause toggle state and active tab switching between Queue and Chat.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/8ad02dde-a30f-580a-9acc-1ebd472fcbcf).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
