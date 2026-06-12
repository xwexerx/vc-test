# Peer-to-Peer Voice Chat

A minimal Discord-style voice chat app where two people can talk directly browser-to-browser over WebRTC. Share a room link and start talking — no sign-up, no install.

## How It Works

1. Open the app — you get a random 6-character room code
2. Share the URL with someone (the room code is in the URL)
3. Both people join the same room
4. The signaling server brokers the WebRTC handshake, then audio flows directly peer-to-peer
5. No audio passes through the server — it's private and low-latency

## Architecture

```
Browser A ←→ WebRTC (audio) ←→ Browser B
    ↕                              ↕
  WebSocket ←→ Signaling Server ←→ WebSocket
                (offer/answer/ICE relay only)
```

- **`server.js`** — Node.js signaling server using `ws`. Manages rooms (max 2 peers), relays WebRTC signaling messages, and serves the frontend as a static file.
- **`index.html`** — Single-file frontend with embedded CSS and JS. Discord-inspired dark theme, WebRTC client, voice activity detection via Web Audio API, responsive design.

## Run Locally

```bash
npm install
npm start
# Open http://localhost:3000
```

Open two browser tabs to test — each tab acts as a separate peer. Grant microphone permissions in both tabs.

## Deploy to Render

### One-Click Setup

1. Push this repo to GitHub
2. Go to [render.com](https://render.com) → **New +** → **Web Service**
3. Connect your GitHub repo
4. Configure:
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
   - **Environment:** Node
   - **Instance Type:** Free
5. Click **Create Web Service**

Your app will be live at `https://your-app.onrender.com`. Share a link with a room code: `https://your-app.onrender.com/?room=ABC123`.

> **Note:** Render's free tier spins down after 15 minutes of inactivity. The first request after a spin-down may take ~30 seconds to respond. Once loaded, WebRTC connections are unaffected since audio is peer-to-peer.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT`   | `3000`  | Server port (Render sets this automatically) |

## License

MIT
