import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../socket';
import { Wordmark } from '../components/common';
import { GiftCard, Shapes } from '../components/giftcard';

export default function Home() {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();

  async function join(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const c = code.trim().toUpperCase();
      await api('GET', `/api/join/${encodeURIComponent(c)}`);
      nav(`/join/${c}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ minHeight: '100%', position: 'relative', overflow: 'hidden' }}>
      <Shapes count={16} seed={2} opacity={0.4} />
      <div style={{ position: 'relative', maxWidth: 460, margin: '0 auto', padding: '28px 20px 40px', gridTemplateColumns: 'minmax(0, 1fr)' }} className="stack">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <Wordmark size={22} />
          <Link to="/host" className="btn small ghost">Host login</Link>
        </div>
        <div className="row" style={{ justifyContent: 'center', margin: '28px 0 6px', gap: 0, minWidth: 0 }}>
          <GiftCard year={1987} width={118} style={{ transform: 'rotate(-10deg) translateX(18px)' }} />
          <GiftCard mystery width={140} style={{ zIndex: 1, transform: 'translateY(-10px)' }} />
          <GiftCard year={2004} width={118} style={{ transform: 'rotate(10deg) translateX(-18px)' }} />
        </div>
        <h1 style={{ fontSize: 46, margin: '10px 0 0', lineHeight: 1 }}>
          Hitster <span className="accent">Night!</span>
        </h1>
        <p className="muted" style={{ margin: 0 }}>Enter the game code from the big screen to join with your team.</p>
        <form className="panel stack" onSubmit={join}>
          <label className="field">
            Game code
            <input
              className="input"
              value={code}
              autoCapitalize="characters"
              autoComplete="off"
              maxLength={8}
              placeholder="ABCD"
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              style={{ fontSize: 32, fontWeight: 800, letterSpacing: '0.2em', textAlign: 'center' }}
            />
          </label>
          {error && <div className="pill bad" style={{ justifyContent: 'center' }}>{error}</div>}
          <button className="btn big" disabled={busy || code.length < 4}>Join game</button>
        </form>
        <p className="muted" style={{ fontSize: 14, textAlign: 'center' }}>
          Want to host your own game? <Link to="/host" style={{ color: '#fff', fontWeight: 700 }}>Create an account</Link>
        </p>
      </div>
    </div>
  );
}
