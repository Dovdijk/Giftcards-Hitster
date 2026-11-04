import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';

/**
 * The standard Spotify embed player, controlled through Spotify's iFrame API.
 * No Spotify developer app needed. Full songs play when this browser is logged in to Spotify Premium.
 */

interface Controller {
  loadUri(uri: string, preferVideo?: boolean, startAt?: number): void;
  play(): void;
  resume(): void;
  pause(): void;
  seek(seconds: number): void;
  togglePlay(): void;
  addListener(ev: string, cb: (e: any) => void): void;
  destroy(): void;
}

declare global {
  interface Window {
    onSpotifyIframeApiReady?: (api: any) => void;
    __spotifyIframeApi?: Promise<any>;
  }
}

function loadApi(): Promise<any> {
  if (!window.__spotifyIframeApi) {
    window.__spotifyIframeApi = new Promise((resolve) => {
      window.onSpotifyIframeApiReady = (api) => resolve(api);
      const s = document.createElement('script');
      s.src = 'https://open.spotify.com/embed/iframe-api/v1';
      s.async = true;
      document.body.appendChild(s);
    });
  }
  return window.__spotifyIframeApi;
}

// ---- diagnostics: what happened between the app and the Spotify player (shown in "Spotify check") ----
const logLines: string[] = [];
const logSubs = new Set<() => void>();
export function spLog(msg: string) {
  const ua = (navigator as any).userActivation;
  const act = ua ? ` [clicked:${ua.hasBeenActive ? 'y' : 'n'}${ua.isActive ? ',now' : ''}]` : '';
  logLines.push(`${new Date().toLocaleTimeString('nl-NL')} ${msg}${act}`);
  if (logLines.length > 80) logLines.shift();
  logSubs.forEach((f) => f());
}
export const spLogLines = () => logLines;
export function useSpLog() {
  const [, set] = useState(0);
  useEffect(() => {
    const f = () => set((n) => n + 1);
    logSubs.add(f);
    return () => void logSubs.delete(f);
  }, []);
  return logLines;
}
export const spIframeAllow = () => document.querySelector('iframe[src*="open.spotify.com"]')?.getAttribute('allow') ?? '(no player)';

export interface PlayerHandle {
  play(): void;
  resume(): void;
  pause(): void;
}

export interface PlaybackInfo {
  playing: boolean;
  position: number;
  duration: number;
  trackId: string | null;
  playingId: string | null; // what Spotify itself says is playing
}

interface Props {
  trackId: string | null;
  startAt?: number; // seconds
  autoplay?: boolean; // start right after loading (scoreboard music)
  autostart?: boolean; // autopilot: start the song once Spotify says it is ready, and check that it plays
  onPlayback?: (p: PlaybackInfo) => void;
}

export const SpotifyPlayer = forwardRef<PlayerHandle, Props>(function SpotifyPlayer({ trackId, startAt = 0, autoplay, autostart, onPlayback }, ref) {
  const autostartRef = useRef(autostart);
  autostartRef.current = autostart;
  // what Spotify last reported for the loaded song (only counts reports that came after the load)
  const live = useRef<{ uri: string; playing: boolean; since: number }>({ uri: '', playing: false, since: 0 });
  const isReady = useRef<string | null>(null); // uri for which Spotify fired "ready"
  const tries = useRef<{ uri: string; n: number; timer: ReturnType<typeof setTimeout> | null }>({ uri: '', n: 0, timer: null });
  const stopTries = () => {
    if (tries.current.timer) clearTimeout(tries.current.timer);
    tries.current = { uri: '', n: 0, timer: null };
  };
  const playingNow = (uri: string) => live.current.uri === uri && live.current.playing;
  const attempt = (uri: string) => {
    const tr = tries.current;
    if (tr.uri !== uri) return;
    if (!autostartRef.current || loaded.current?.uri !== uri) return stopTries();
    if (playingNow(uri)) {
      spLog(`autostart: playing ✓`);
      return stopTries();
    }
    if (tr.n >= 5) {
      spLog('autostart: gave up after 5 tries');
      return stopTries();
    }
    tr.n++;
    spLog(`autostart: play() try ${tr.n}`);
    ctrl.current?.play();
    tr.timer = setTimeout(() => attempt(uri), 2500);
  };
  const startTries = (uri: string, delay: number) => {
    if (!autostartRef.current || playingNow(uri)) return;
    if (tries.current.uri === uri && tries.current.n > 0) return;
    stopTries();
    tries.current = { uri, n: 0, timer: setTimeout(() => attempt(uri), delay) };
  };

  const holder = useRef<HTMLDivElement>(null);
  const ctrl = useRef<Controller | null>(null);
  const loaded = useRef<{ uri: string; startAt: number; seeked: boolean } | null>(null);
  const lastPos = useRef<number | null>(null);
  const lastSig = useRef('');
  const cb = useRef(onPlayback);
  cb.current = onPlayback;
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useImperativeHandle(ref, () => ({
    play: () => {
      spLog(ctrl.current ? 'app: play()' : 'app: play() but player not ready');
      ctrl.current?.play();
    },
    resume: () => {
      spLog('app: resume()');
      ctrl.current?.resume();
    },
    pause: () => ctrl.current?.pause(),
  }));

  const load = (c: Controller, uri: string) => {
    loaded.current = { uri, startAt, seeked: startAt === 0 };
    spLog(`load ${uri.split(':').pop()}${startAt ? ' from ' + startAt + 's' : ''}`);
    live.current = { uri, playing: false, since: Date.now() };
    isReady.current = null;
    stopTries();
    c.loadUri(uri, false, startAt);
    // normally Spotify says "ready" within ~2 sec; if it doesn't, try anyway
    startTries(uri, 5000);
    if (autoplay) setTimeout(() => ctrl.current?.play(), 700);
  };

  useEffect(() => {
    if (!trackId) {
      ctrl.current?.pause();
      return;
    }
    const uri = `spotify:track:${trackId}`;
    if (ctrl.current) {
      if (loaded.current?.uri !== uri) load(ctrl.current, uri);
      else if (autoplay) ctrl.current.play();
      return;
    }
    let cancelled = false;
    const timeout = setTimeout(() => !ctrl.current && setFailed(true), 8000);
    loadApi().then((api) => {
      if (cancelled || !holder.current) return;
      const el = document.createElement('div');
      holder.current.innerHTML = '';
      holder.current.appendChild(el);
      // Browsers only let a cross-site iframe start audio by itself when the page delegates it
      // with allow="autoplay". Spotify creates the iframe itself, so add the permission the moment
      // it is created (setting it later has no effect until the iframe reloads).
      const origCreate = document.createElement.bind(document);
      (document as any).createElement = (tag: string, opts?: ElementCreationOptions) => {
        const node = origCreate(tag, opts);
        if (String(tag).toLowerCase() === 'iframe') node.setAttribute('allow', 'autoplay; encrypted-media; clipboard-write; fullscreen; picture-in-picture');
        return node;
      };
      setTimeout(() => ((document as any).createElement = origCreate), 0);
      api.createController(el, { uri, width: '100%', height: 152 }, (c: Controller) => {
        (document as any).createElement = origCreate;
        ctrl.current = c;
        spLog(`player created, allow="${spIframeAllow()}"`);
        c.addListener('ready', () => {
          const u = loaded.current?.uri ?? '';
          spLog('spotify: ready');
          isReady.current = u;
          if (autostartRef.current && !playingNow(u)) {
            stopTries();
            startTries(u, 600);
          }
        });
        setReady(true);
        setFailed(false);
        loaded.current = { uri, startAt, seeked: startAt === 0 };
        if (startAt || autoplay) load(c, uri);
        c.addListener('playback_update', (e: any) => {
          const d = e?.data ?? {};
          const l = loaded.current;
          // older embed versions ignore startAt: jump to the chorus once playback starts
          if (l && !l.seeked && !d.isPaused && (d.position ?? 0) < l.startAt * 1000 - 3000) {
            l.seeked = true;
            c.seek(l.startAt);
          } else if (l && !d.isPaused) {
            l.seeked = true;
          }
          // some embed versions keep isBuffering on while playing; a moving position also means playing
          const sig = `${d.isPaused ? 'paused' : 'playing'}${d.isBuffering ? '+buffering' : ''} dur ${Math.round((d.duration ?? 0) / 1000)}s${typeof d.playingURI === 'string' ? ' ' + d.playingURI.split(':').pop() : ''}`;
          if (sig !== lastSig.current) {
            lastSig.current = sig;
            spLog(`spotify: ${sig} at ${Math.round((d.position ?? 0) / 1000)}s`);
          }
          const pid = typeof d.playingURI === 'string' ? d.playingURI : null;
          if (l && (pid ? pid === l.uri : Date.now() - live.current.since > 1500)) live.current = { uri: l.uri, playing: !d.isPaused, since: live.current.since };
          const last = lastPos.current;
          const moving = last !== null && (d.position ?? 0) > last;
          lastPos.current = d.position ?? 0;
          cb.current?.({
            // right after loading, a report without track id may still be about the previous song
            playing: d.isPaused === false && (!d.isBuffering || moving) && !(pid ? pid !== l?.uri : Date.now() - live.current.since < 1500),
            playingId: typeof d.playingURI === 'string' ? d.playingURI.split(':').pop() ?? null : null,
            position: d.position ?? 0,
            duration: d.duration ?? 0,
            trackId: l?.uri.split(':').pop() ?? null,
          });
        });
      });
    });
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackId, startAt, autoplay]);

  useEffect(() => {
    const u = loaded.current?.uri;
    if (!autostart) return stopTries();
    if (u && isReady.current === u) startTries(u, 600);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autostart, trackId]);
  useEffect(() => () => stopTries(), []);

  return (
    <div>
      <div ref={holder} style={{ minHeight: 152, borderRadius: 12, overflow: 'hidden', background: 'rgba(255,255,255,0.05)' }} />
      {!ready && failed && <div className="pill warn" style={{ marginTop: 6 }}>Spotify player did not load. Check the internet connection or play the song in the Spotify app.</div>}
    </div>
  );
});
