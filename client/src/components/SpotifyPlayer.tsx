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
}

interface Props {
  trackId: string | null;
  startAt?: number; // seconds
  autoplay?: boolean; // start right after loading (scoreboard music)
  onPlayback?: (p: PlaybackInfo) => void;
}

export const SpotifyPlayer = forwardRef<PlayerHandle, Props>(function SpotifyPlayer({ trackId, startAt = 0, autoplay, onPlayback }, ref) {
  const holder = useRef<HTMLDivElement>(null);
  const ctrl = useRef<Controller | null>(null);
  const loaded = useRef<{ uri: string; startAt: number; seeked: boolean } | null>(null);
  const cb = useRef(onPlayback);
  cb.current = onPlayback;
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useImperativeHandle(ref, () => ({
    play: () => ctrl.current?.play(),
    resume: () => ctrl.current?.resume(),
    pause: () => ctrl.current?.pause(),
  }));

  const load = (c: Controller, uri: string) => {
    loaded.current = { uri, startAt, seeked: startAt === 0 };
    c.loadUri(uri, false, startAt);
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
          cb.current?.({
            playing: !d.isPaused && !d.isBuffering,
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

  return (
    <div>
      <div ref={holder} style={{ minHeight: 152, borderRadius: 12, overflow: 'hidden', background: 'rgba(255,255,255,0.05)' }} />
      {!ready && failed && <div className="pill warn" style={{ marginTop: 6 }}>Spotify player did not load. Check the internet connection or play the song in the Spotify app.</div>}
    </div>
  );
});
