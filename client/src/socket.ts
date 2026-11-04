import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';

let currentGameId = '';
export const setCurrentGame = (id: string) => (currentGameId = id);

export type Ack<T = unknown> = { ok: true; result: T } | { ok: false; error: string };

export function useGameSocket<S extends { serverNow: number }>(auth: Record<string, string | undefined> | null) {
  const [state, setState] = useState<S | null>(null);
  const [connected, setConnected] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [tokenInvalid, setTokenInvalid] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const offsetRef = useRef(0);
  const key = auth ? JSON.stringify(auth) : null;

  useEffect(() => {
    if (!key) return;
    const s = io({ auth: JSON.parse(key), transports: ['websocket', 'polling'] });
    socketRef.current = s;
    s.on('connect', () => setConnected(true));
    s.on('disconnect', () => setConnected(false));
    s.on('state', (st: S) => {
      offsetRef.current = st.serverNow - Date.now();
      const gid = (st as any).game?.id;
      if (gid) setCurrentGame(gid);
      setState(st);
    });
    s.on('authError', (m: string) => setAuthError(m));
    s.on('gameDeleted', () => setAuthError('This game was deleted'));
    s.on('tokenInvalid', () => setTokenInvalid(true));
    return () => {
      s.disconnect();
      socketRef.current = null;
    };
  }, [key]);

  function emit<T = unknown>(event: string, ...args: unknown[]): Promise<Ack<T>> {
    return new Promise((resolve) => {
      const s = socketRef.current;
      if (!s || !s.connected) return resolve({ ok: false, error: 'Not connected. Check your internet connection.' });
      s.timeout(10000).emit(event, ...args, (err: unknown, res: Ack<T>) => {
        if (err) resolve({ ok: false, error: 'No response from server. Try again.' });
        else resolve(res);
      });
    });
  }

  return { state, connected, authError, tokenInvalid, emit, socket: socketRef, serverNow: () => Date.now() + offsetRef.current };
}

/** Seconds left until `endsAt` (server time), re-rendering every 200ms. */
export function useCountdown(endsAt: number | null | undefined, serverNow: () => number) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!endsAt) return;
    const i = setInterval(() => tick((n) => n + 1), 200);
    return () => clearInterval(i);
  }, [endsAt]);
  if (!endsAt) return null;
  return Math.max(0, Math.ceil((endsAt - serverNow()) / 1000));
}

export const photoUrl = (teamId: string, version: number) => (version && currentGameId ? `/api/photo/${currentGameId}/${teamId}?v=${version}` : null);

export async function api<T = any>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? 'Something went wrong');
  return data as T;
}
