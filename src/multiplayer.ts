/**
 * Triple-Transport Real-Time Multiplayer Room Client.
 *
 * Synchronizes live 2-player chess matches over:
 *   1. Server-authoritative WebSockets (`/ws` on port 3000)
 *   2. PeerJS WebRTC DataChannel (for serverless / GitHub Pages cross-device play)
 *   3. BroadcastChannel (for instant multi-tab synchronization)
 *
 * All state updates are strictly idempotent (keyed by roomId, move ply, and chat id).
 */

import Peer from 'peerjs';
import type { DataConnection } from 'peerjs';
import { START_FEN } from './engine/engine';

export interface MultiplayerChatMsg {
  id: string;
  sender: string;
  text: string;
  ts: number;
}

export interface MultiplayerRoomSnapshot {
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
  chat: MultiplayerChatMsg[];
  connectedCount: number;
}

export type RoomStateListener = (snapshot: MultiplayerRoomSnapshot) => void;

export function getOrCreatePlayerId(): string {
  try {
    const existing = sessionStorage.getItem('chess0-player-id');
    if (existing) return existing;
    const created = `p_${Math.random().toString(36).slice(2, 10)}`;
    sessionStorage.setItem('chess0-player-id', created);
    return created;
  } catch {
    return `p_${Math.random().toString(36).slice(2, 10)}`;
  }
}

export function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export class MultiplayerSession {
  readonly roomId: string;
  readonly playerId: string;
  playerName: string;
  private state: MultiplayerRoomSnapshot;
  private onState: RoomStateListener;
  private ws: WebSocket | null = null;
  private bc: BroadcastChannel | null = null;
  private peer: Peer | null = null;
  private peerConns: DataConnection[] = [];
  private destroyed = false;
  private reconnectTimer: number | null = null;

  constructor(opts: {
    roomId: string;
    playerId: string;
    playerName: string;
    isHost: boolean;
    preferredSide?: 'white' | 'black';
    onState: RoomStateListener;
  }) {
    this.roomId = opts.roomId.trim().toUpperCase();
    this.playerId = opts.playerId;
    this.playerName = opts.playerName.trim() || 'Player';
    this.onState = opts.onState;

    this.state = {
      roomId: this.roomId,
      hostId: opts.isHost ? this.playerId : '',
      hostSide: opts.preferredSide ?? 'white',
      hostName: opts.isHost ? this.playerName : 'Host',
      guestId: opts.isHost ? null : this.playerId,
      guestName: opts.isHost ? null : this.playerName,
      movesUci: [],
      startFen: START_FEN,
      resignedBy: null,
      drawAgreed: false,
      chat: [],
      connectedCount: 1,
    };

    this.initBroadcastChannel();
    this.initWebSocket();
    this.initPeerJs(opts.isHost);
  }

  getSnapshot(): MultiplayerRoomSnapshot {
    return this.state;
  }

  myAssignedSide(): 'white' | 'black' {
    if (this.state.hostId === this.playerId) {
      return this.state.hostSide;
    }
    return this.state.hostSide === 'white' ? 'black' : 'white';
  }

  private mergeIncomingState(incoming: Partial<MultiplayerRoomSnapshot>) {
    if (this.destroyed || !incoming || incoming.roomId !== this.roomId) return;

    const cur = this.state;
    const hostId = incoming.hostId || cur.hostId;
    const hostSide = incoming.hostSide ?? cur.hostSide;
    const hostName = incoming.hostName || cur.hostName;
    const guestId =
      incoming.guestId ??
      (this.playerId !== hostId ? this.playerId : cur.guestId);
    const guestName =
      incoming.guestName ??
      (this.playerId !== hostId ? this.playerName : cur.guestName);

    // Rematch reset detection (incoming has 0 moves while we had >0 and resigned/draw cleared)
    let movesUci = cur.movesUci;
    if (Array.isArray(incoming.movesUci)) {
      if (
        incoming.movesUci.length === 0 &&
        incoming.resignedBy === null &&
        incoming.drawAgreed === false &&
        (cur.resignedBy !== null || cur.drawAgreed || cur.hostSide !== incoming.hostSide)
      ) {
        movesUci = [];
      } else if (incoming.movesUci.length >= cur.movesUci.length) {
        movesUci = [...incoming.movesUci];
      }
    }

    // Merge chat messages idempotently
    const chatMap = new Map<string, MultiplayerChatMsg>();
    for (const c of cur.chat) chatMap.set(c.id, c);
    if (Array.isArray(incoming.chat)) {
      for (const c of incoming.chat) {
        if (c && c.id) chatMap.set(c.id, c);
      }
    }
    const mergedChat = [...chatMap.values()].sort((a, b) => a.ts - b.ts).slice(-50);

    const hasBothPlayers = Boolean(hostId && guestId && hostId !== guestId);
    const connectedCount = Math.max(
      incoming.connectedCount ?? 1,
      hasBothPlayers ? 2 : 1,
    );

    this.state = {
      roomId: this.roomId,
      hostId,
      hostSide,
      hostName,
      guestId,
      guestName,
      movesUci,
      startFen: incoming.startFen || cur.startFen,
      resignedBy:
        incoming.resignedBy !== undefined ? incoming.resignedBy : cur.resignedBy,
      drawAgreed:
        incoming.drawAgreed !== undefined ? incoming.drawAgreed : cur.drawAgreed,
      chat: mergedChat,
      connectedCount,
    };

    this.onState(this.state);
  }

  private emitP2PState() {
    const packet = { type: 'p2p:sync', room: this.state };
    try {
      this.bc?.postMessage(packet);
    } catch {}
    for (const conn of this.peerConns) {
      try {
        if (conn.open) conn.send(packet);
      } catch {}
    }
  }

  private initBroadcastChannel() {
    if (typeof BroadcastChannel === 'undefined') return;
    try {
      this.bc = new BroadcastChannel(`chess0_room_${this.roomId}`);
      this.bc.onmessage = (ev) => {
        const data = ev.data;
        if (!data) return;
        if (data.type === 'p2p:hello') {
          if (this.state.hostId && this.state.hostId !== data.playerId) {
            this.state = {
              ...this.state,
              guestId: data.playerId,
              guestName: data.playerName || 'Challenger',
              connectedCount: 2,
            };
            this.onState(this.state);
          }
          this.emitP2PState();
        } else if (data.type === 'p2p:sync' && data.room) {
          this.mergeIncomingState(data.room);
        }
      };
      this.bc.postMessage({
        type: 'p2p:hello',
        playerId: this.playerId,
        playerName: this.playerName,
      });
    } catch {}
  }

  private initWebSocket() {
    if (typeof window === 'undefined') return;
    try {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${proto}//${window.location.host}/ws`;
      const ws = new WebSocket(wsUrl);
      this.ws = ws;

      ws.onopen = () => {
        if (this.destroyed) return;
        ws.send(
          JSON.stringify({
            type: 'room:join',
            roomId: this.roomId,
            playerId: this.playerId,
            playerName: this.playerName,
            preferredSide: this.state.hostSide,
            startFen: this.state.startFen,
          }),
        );
      };

      ws.onmessage = (ev) => {
        if (this.destroyed) return;
        try {
          const msg = JSON.parse(String(ev.data));
          if (msg?.type === 'room:state' && msg.room) {
            this.mergeIncomingState(msg.room);
          }
        } catch {}
      };

      ws.onclose = () => {
        if (this.destroyed) return;
        this.reconnectTimer = window.setTimeout(() => this.initWebSocket(), 3500);
      };
    } catch {}
  }

  private initPeerJs(isHost: boolean) {
    if (typeof window === 'undefined') return;
    try {
      const hostPeerId = `chess0-room-${this.roomId.toLowerCase()}`;
      const peer = isHost ? new Peer(hostPeerId) : new Peer();
      this.peer = peer;

      const setupConn = (conn: DataConnection) => {
        this.peerConns.push(conn);
        conn.on('open', () => {
          conn.send({
            type: 'p2p:hello',
            playerId: this.playerId,
            playerName: this.playerName,
          });
          this.emitP2PState();
        });
        conn.on('data', (raw: unknown) => {
          const data = raw as {
            type?: string;
            playerId?: string;
            playerName?: string;
            room?: Partial<MultiplayerRoomSnapshot>;
          };
          if (!data) return;
          if (data.type === 'p2p:hello' && data.playerId) {
            if (this.state.hostId && this.state.hostId !== data.playerId) {
              this.state = {
                ...this.state,
                guestId: data.playerId,
                guestName: data.playerName || 'Challenger',
                connectedCount: 2,
              };
              this.onState(this.state);
            }
            this.emitP2PState();
          } else if (data.type === 'p2p:sync' && data.room) {
            this.mergeIncomingState(data.room);
          }
        });
      };

      peer.on('open', () => {
        if (this.destroyed) return;
        if (!isHost) {
          const conn = peer.connect(hostPeerId, { reliable: true });
          setupConn(conn);
        }
      });

      peer.on('connection', (conn) => {
        if (this.destroyed) return;
        setupConn(conn);
      });

      peer.on('error', () => {
        // If hostPeerId is already taken in this browser or we joined via link, connect as guest
        if (isHost && !this.destroyed) {
          try {
            const guestPeer = new Peer();
            this.peer = guestPeer;
            guestPeer.on('open', () => {
              const conn = guestPeer.connect(hostPeerId, { reliable: true });
              setupConn(conn);
            });
          } catch {}
        }
      });
    } catch {}
  }

  sendMove(uci: string) {
    const nextPly = this.state.movesUci.length + 1;
    this.state = {
      ...this.state,
      movesUci: [...this.state.movesUci, uci],
    };
    this.onState(this.state);
    this.emitP2PState();
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'room:move', uci, ply: nextPly }));
    }
  }

  sendResign(side: 'white' | 'black') {
    this.state = { ...this.state, resignedBy: side };
    this.onState(this.state);
    this.emitP2PState();
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'room:resign', side }));
    }
  }

  sendDrawAgree() {
    this.state = { ...this.state, drawAgreed: true };
    this.onState(this.state);
    this.emitP2PState();
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'room:draw' }));
    }
  }

  sendRematch() {
    const nextHostSide: 'white' | 'black' =
      this.state.hostSide === 'white' ? 'black' : 'white';
    this.state = {
      ...this.state,
      hostSide: nextHostSide,
      movesUci: [],
      resignedBy: null,
      drawAgreed: false,
    };
    this.onState(this.state);
    this.emitP2PState();
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'room:rematch' }));
    }
  }

  sendChat(text: string) {
    const trimmed = text.trim().slice(0, 180);
    if (!trimmed) return;
    const msg: MultiplayerChatMsg = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      sender: this.playerName,
      text: trimmed,
      ts: Date.now(),
    };
    this.state = {
      ...this.state,
      chat: [...this.state.chat, msg].slice(-50),
    };
    this.onState(this.state);
    this.emitP2PState();
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'room:chat', ...msg }));
    }
  }

  destroy() {
    this.destroyed = true;
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
    try {
      this.ws?.close();
    } catch {}
    try {
      this.bc?.close();
    } catch {}
    for (const c of this.peerConns) {
      try {
        c.close();
      } catch {}
    }
    try {
      this.peer?.destroy();
    } catch {}
  }
}
