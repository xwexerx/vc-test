const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// Static file serving — single page app, only index.html
// ---------------------------------------------------------------------------
function serveIndex(res) {
  const filePath = path.join(__dirname, "index.html");
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Internal Server Error");
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  if (req.method === "GET") {
    // Serve index.html for any GET request (handles ?room= params and any path)
    serveIndex(res);
  } else {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
  }
});

// ---------------------------------------------------------------------------
// WebSocket signaling server
//
// Protocol (strict initiator / non-initiator):
//
//   1. First peer joins  →  server sends { type: "waiting" }
//      (peer does nothing WebRTC-wise, just waits)
//
//   2. Second peer joins →  server sends to BOTH:
//        - first peer:  { type: "start", initiator: true  }
//        - second peer: { type: "start", initiator: false }
//
//   3. Only the initiator creates an offer.
//      The non-initiator only ever answers — never creates an offer.
//
//   Signal relay (both directions):
//     { type: "signal", signal: { type, sdp } }
//     { type: "signal", candidate: { candidate, sdpMid, sdpMLineIndex } }
//
//   Other:
//     { type: "room-full" }   — room already has 2 peers
//     { type: "peer-left" }   — other peer disconnected
//     { type: "error", message }
// ---------------------------------------------------------------------------
const wss = new WebSocketServer({ server });

// rooms:   roomCode → Set<WebSocket>
// clients: WebSocket → { room, side? }  (side assigned on "start")
const rooms = new Map();
const clients = new Map();

function send(ws, msg) {
  if (ws.readyState === 1) {
    // 1 = OPEN
    ws.send(JSON.stringify(msg));
  }
}

// Remove any CLOSED (3) or CLOSING (2) sockets from a room's peer set.
// A dead socket left behind (e.g. from a mid-reconnect race) would
// otherwise block new joiners with a false "room-full" rejection.
function pruneDeadSockets(peers) {
  for (const peer of peers) {
    if (peer.readyState === 2 || peer.readyState === 3) {
      peers.delete(peer);
      clients.delete(peer);
    }
  }
}

// Relay to every OTHER peer in the room
function relayToPeers(senderWs, room, msg) {
  const peers = rooms.get(room);
  if (!peers) return;
  for (const peer of peers) {
    if (peer !== senderWs) {
      send(peer, msg);
    }
  }
}

// Remove a client from its room and notify remaining peers
function leaveRoom(ws) {
  const info = clients.get(ws);
  if (!info) return;
  const { room } = info;
  clients.delete(ws);

  const peers = rooms.get(room);
  if (!peers) return;

  peers.delete(ws);
  console.log(`[leave] room=${room}  livePeers=${peers.size}/2`);

  if (peers.size === 0) {
    rooms.delete(room);
    console.log(`[leave] room=${room} deleted (empty)`);
  } else {
    // Promote the remaining peer to initiator so they send an offer when
    // the next person joins
    if (peers.size === 1) {
      const remaining = [...peers][0];
      const remainingInfo = clients.get(remaining);
      if (remainingInfo) remainingInfo.side = "initiator";
    }
    for (const peer of peers) {
      send(peer, { type: "peer-left" });
    }
  }
}

wss.on("connection", (ws) => {
  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      send(ws, { type: "error", message: "Invalid JSON" });
      return;
    }

    switch (msg.type) {
      case "join": {
        const room = msg.room;
        if (!room || typeof room !== "string" || room.length > 32) {
          send(ws, { type: "error", message: "Invalid room code" });
          return;
        }

        let peers = rooms.get(room);
        if (!peers) {
          peers = new Set();
          rooms.set(room, peers);
        }

        // Clean up stale connections before checking occupancy so a
        // dead socket from a reconnect race doesn't trigger a false
        // "room-full" rejection.
        pruneDeadSockets(peers);

        console.log(
          `[join] room=${room}  livePeers=${peers.size}/2  newPeer=${ws._socket?.remoteAddress || "?"}`
        );

        if (peers.size >= 2) {
          send(ws, { type: "room-full" });
          return;
        }

        peers.add(ws);
        clients.set(ws, { room });

        if (peers.size === 1) {
          // First peer — make them wait.  No WebRTC negotiation yet.
          send(ws, { type: "waiting" });
        } else {
          // Second peer just joined — both peers are ready.
          // Assign strict initiator / non-initiator roles.
          const first = [...peers].find((p) => p !== ws);
          clients.get(first).side = "initiator";
          clients.get(ws).side = "joiner";

          send(first, { type: "start", initiator: true });
          send(ws, { type: "start", initiator: false });
        }
        break;
      }

      case "signal": {
        const info = clients.get(ws);
        if (!info) {
          send(ws, { type: "error", message: "Not in a room" });
          return;
        }
        // Relay the payload (offer, answer, or ICE candidate) to other peers
        relayToPeers(ws, info.room, {
          type: "signal",
          signal: msg.signal,
          candidate: msg.candidate,
        });
        break;
      }

      default:
        send(ws, { type: "error", message: `Unknown message type: ${msg.type}` });
    }
  });

  ws.on("close", () => {
    leaveRoom(ws);
  });

  ws.on("error", () => {
    leaveRoom(ws);
  });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
server.listen(PORT, () => {
  console.log(`Signaling server listening on port ${PORT}`);
});
