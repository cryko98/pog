export type Dir = 'up' | 'down' | 'left' | 'right';

export interface NetPlayer {
  id: number;
  name: string;
  color: string;
  wallet: string;
  x: number;
  y: number;
  dir: Dir;
  moving: boolean;
  pog: number;
}

export type StateTuple = [number, number, number, Dir, number];

export interface NetHandlers {
  onWelcome?: (msg: { id: number; you: NetPlayer; players: NetPlayer[]; takenCoins: number[] }) => void;
  onSpawn?: (player: NetPlayer) => void;
  onDespawn?: (id: number) => void;
  onState?: (players: StateTuple[]) => void;
  onProfile?: (msg: { id: number; name: string; color: string }) => void;
  onChat?: (msg: { id: number; name: string; color: string; text: string }) => void;
  onSystem?: (message: string) => void;
  onCoin?: (id: number, taken: boolean) => void;
  onPog?: (pog: number, coin: number) => void;
  onError?: (code: string, message: string) => void;
  onStatus?: (status: 'connecting' | 'open' | 'closed') => void;
}

const socketUrl = () => {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws`;
};

export class PogSocket {
  private ws: WebSocket | null = null;
  private retry = 0;
  private closedByUs = false;
  private reconnectTimer = 0;

  constructor(private token: string, private handlers: NetHandlers) {}

  connect() {
    this.closedByUs = false;
    this.handlers.onStatus?.('connecting');

    const ws = new WebSocket(socketUrl());
    this.ws = ws;

    ws.onopen = () => {
      this.retry = 0;
      this.handlers.onStatus?.('open');
      this.send({ t: 'join', token: this.token });
    };

    ws.onmessage = (event) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      const h = this.handlers;
      switch (msg.t) {
        case 'welcome':
          h.onWelcome?.(msg as never);
          break;
        case 'spawn':
          h.onSpawn?.((msg as { player: NetPlayer }).player);
          break;
        case 'despawn':
          h.onDespawn?.(msg.id as number);
          break;
        case 'state':
          h.onState?.(msg.players as StateTuple[]);
          break;
        case 'profile':
          h.onProfile?.(msg as never);
          break;
        case 'chat':
          h.onChat?.(msg as never);
          break;
        case 'system':
          h.onSystem?.(msg.message as string);
          break;
        case 'coin':
          h.onCoin?.(msg.id as number, msg.taken as boolean);
          break;
        case 'pog':
          h.onPog?.(msg.pog as number, msg.coin as number);
          break;
        case 'error':
          h.onError?.(msg.code as string, msg.message as string);
          break;
      }
    };

    ws.onclose = () => {
      this.handlers.onStatus?.('closed');
      if (this.closedByUs) return;
      // exponential backoff, capped so a server restart reconnects quickly
      const delay = Math.min(8000, 600 * 2 ** this.retry++);
      this.reconnectTimer = window.setTimeout(() => this.connect(), delay);
    };

    ws.onerror = () => ws.close();
  }

  send(msg: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  move(x: number, y: number, dir: Dir, moving: boolean) {
    this.send({ t: 'move', x: Math.round(x), y: Math.round(y), dir, moving });
  }

  pickup(id: number) {
    this.send({ t: 'pickup', id });
  }

  chat(text: string) {
    this.send({ t: 'chat', text });
  }

  close() {
    this.closedByUs = true;
    clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }
}
