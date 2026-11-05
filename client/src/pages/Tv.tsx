import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Wordmark } from '../components/common';
import { Shapes } from '../components/giftcard';

/** Short entry for TVs: type the 4-character game code with the remote and open the show screen. */
export default function Tv() {
  const nav = useNavigate();
  const [code, setCode] = useState(() => {
    try { return localStorage.getItem('hitster-tv-code') ?? ''; } catch { return ''; }
  });
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const go = (e?: React.FormEvent) => {
    e?.preventDefault();
    const c = code.trim().toUpperCase();
    if (c.length < 4) return;
    try { localStorage.setItem('hitster-tv-code', c); } catch { /* ignore */ }
    nav(`/show/${c}`);
  };
  return (
    <div style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', background: 'var(--bg)', overflow: 'hidden' }}>
      <Shapes count={16} seed={3} opacity={0.35} />
      <form onSubmit={go} style={{ position: 'relative', display: 'grid', justifyItems: 'center', gap: '3vh', width: 'min(90vw, 900px)' }}>
        <Wordmark size={48} />
        <div style={{ fontSize: '6vh', fontWeight: 800, textAlign: 'center', lineHeight: 1.1 }}>Show screen</div>
        <div style={{ fontSize: '3vh', color: 'var(--muted)', textAlign: 'center' }}>Type the game code from the host panel</div>
        <input
          ref={input}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/[^a-z0-9]/gi, '').slice(0, 6).toUpperCase())}
          inputMode="text"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          aria-label="Game code"
          style={{ width: '100%', maxWidth: 520, fontSize: '12vh', fontWeight: 800, letterSpacing: '0.2em', textAlign: 'center', padding: '1vh 2vw', borderRadius: 24, border: '4px solid var(--pink)', background: '#fff', color: 'var(--navy)', outline: 'none' }}
        />
        <button type="submit" className="btn" style={{ fontSize: '4vh', padding: '1.6vh 6vw' }} disabled={code.trim().length < 4}>Open show screen</button>
      </form>
    </div>
  );
}
