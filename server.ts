import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3000;

interface RoomState {
  roomId: string;
  hostId: string;
  hostSide: 'white' | 'black';
  hostName: string;
  guestId: string | null;
  guestName: string | null;
  movesUci: string[];
  startFen: string;
  resignedBy: 'white' | 'black' | null;
  drawAgreed: boolean;
  chat: { id: string; sender: string; text: string; ts: number }[];
  clients: Map<string, WebSocket>;
}

const rooms = new Map<string, RoomState>();

function serializeRoom(room: RoomState) {
  return {
    roomId: room.roomId,
    hostId: room.hostId,
    hostSide: room.hostSide,
    hostName: room.hostName,
    guestId: room.guestId,
    guestName: room.guestName,
    movesUci: room.movesUci,
    startFen: room.startFen,
    resignedBy: room.resignedBy,
    drawAgreed: room.drawAgreed,
    chat: room.chat,
    connectedCount: room.clients.size,
  };
}

function broadcastRoom(room: RoomState, type = 'room:state') {
  const payload = JSON.stringify({
    type,
    room: serializeRoom(room),
  });
  for (const [, ws] of room.clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  }
}

async function startServer() {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', rooms: rooms.size });
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    let joinedRoomId: string | null = null;
    let clientId: string | null = null;

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(String(raw));
        if (!msg || typeof msg.type !== 'string') return;

        if (msg.type === 'room:join') {
          const roomId = String(msg.roomId || '').trim().toUpperCase();
          const pid = String(msg.playerId || '').trim();
          const pName = String(msg.playerName || 'Player').trim().slice(0, 24);
          const preferredSide: 'white' | 'black' =
            msg.preferredSide === 'black' ? 'black' : 'white';
          const startFen = String(
            msg.startFen || 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
          );

          if (!roomId || !pid) return;
          joinedRoomId = roomId;
          clientId = pid;

          let room = rooms.get(roomId);
          if (!room) {
            room = {
              roomId,
              hostId: pid,
              hostSide: preferredSide,
              hostName: pName,
              guestId: null,
              guestName: null,
              movesUci: [],
              startFen,
              resignedBy: null,
              drawAgreed: false,
              chat: [],
              clients: new Map(),
            };
            rooms.set(roomId, room);
          } else {
            if (room.hostId === pid) {
              room.hostName = pName;
            } else if (!room.guestId || room.guestId === pid) {
              room.guestId = pid;
              room.guestName = pName;
            }
          }

          room.clients.set(pid, ws);
          broadcastRoom(room, 'room:state');
          return;
        }

        if (!joinedRoomId) return;
        const room = rooms.get(joinedRoomId);
        if (!room) return;

        if (msg.type === 'room:move') {
          const uci = String(msg.uci || '').trim();
          const ply = Number(msg.ply);
          // Idempotent guard: only append if ply matches next expected move
          if (uci && (Number.isNaN(ply) || ply === room.movesUci.length + 1)) {
            room.movesUci.push(uci);
            broadcastRoom(room, 'room:state');
          }
        } else if (msg.type === 'room:resign') {
          const side = msg.side === 'black' ? 'black' : 'white';
          room.resignedBy = side;
          broadcastRoom(room, 'room:state');
        } else if (msg.type === 'room:draw') {
          room.drawAgreed = true;
          broadcastRoom(room, 'room:state');
        } else if (msg.type === 'room:rematch') {
          room.hostSide = room.hostSide === 'white' ? 'black' : 'white';
          room.movesUci = [];
          room.resignedBy = null;
          room.drawAgreed = false;
          broadcastRoom(room, 'room:state');
        } else if (msg.type === 'room:chat') {
          const text = String(msg.text || '').trim().slice(0, 180);
          const sender = String(msg.sender || 'Player').trim().slice(0, 24);
          const id = String(msg.id || `${Date.now()}-${Math.random()}`);
          if (text && !room.chat.some((c) => c.id === id)) {
            room.chat.push({ id, sender, text, ts: Date.now() });
            if (room.chat.length > 50) room.chat.shift();
            broadcastRoom(room, 'room:state');
          }
        }
      } catch {
        // Ignore malformed payloads
      }
    });

    ws.on('close', () => {
      if (joinedRoomId && clientId) {
        const room = rooms.get(joinedRoomId);
        if (room) {
          room.clients.delete(clientId);
          broadcastRoom(room, 'room:state');
        }
      }
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*all', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Chess0 server + multiplayer WebSocket listening on http://localhost:${PORT}`);
  });
}

void startServer();
