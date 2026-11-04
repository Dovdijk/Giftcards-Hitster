import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { GameSummary } from '../../../shared/types';
import { api } from '../socket';
import { Wordmark, useToast } from '../components/common';
import { Shapes, colorAt } from '../components/giftcard';

interface Me {
  id: string;
  email: string;
  name: string;
  superAdmin: boolean;
}
type Summary = GameSummary & { ownerName: string };

export default function Host() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  useEffect(() => {
    api<{ user: Me | null }>('GET', '/api/me').then((r) => setMe(r.user), () => setMe(null));
  }, []);
  return (
    <div style={{ minHeight: '100%', position: 'relative' }}>
      <div style={{ position: 'fixed', inset: 0, zIndex: -1 }}><Shapes count={16} seed={5} opacity={0.3} /></div>
      {me === undefined ? null : me ? <Games me={me} onLogout={() => setMe(null)} /> : <AuthForm onAuth={setMe} />}
    </div>
  );
}

function AuthForm({ onAuth }: { onAuth: (u: Me) => void }) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [f, setF] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ user: Me }>('POST', mode === 'login' ? '/api/login' : '/api/signup', f);
      onAuth(r.user);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center" style={{ minHeight: '100vh', padding: 20 }}>
      <form className="panel stack" style={{ width: '100%', maxWidth: 400, padding: 26, textAlign: 'left' }} onSubmit={submit}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <Wordmark />
          <Link to="/" className="muted" style={{ fontSize: 14 }}>Join a game →</Link>
        </div>
        <h2 style={{ margin: '6px 0 0', fontSize: 30 }}>{mode === 'login' ? <>Welcome <span className="accent">back</span></> : <>Host your own <span className="accent">night</span></>}</h2>
        <div className="row" style={{ background: 'rgba(255,255,255,0.08)', borderRadius: 999, padding: 4 }}>
          {(['login', 'signup'] as const).map((m) => (
            <button type="button" key={m} className={`btn small grow ${mode === m ? '' : 'secondary'}`} style={mode === m ? {} : { background: 'transparent' }} onClick={() => { setMode(m); setError(null); }}>
              {m === 'login' ? 'Log in' : 'Create account'}
            </button>
          ))}
        </div>
        {mode === 'signup' && (
          <label className="field">Your name<input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="name" /></label>
        )}
        <label className="field">Email<input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} autoComplete="email" /></label>
        <label className="field">
          Password
          <input className="input" type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
          {mode === 'signup' && <span style={{ fontWeight: 400 }}>At least 8 characters.</span>}
        </label>
        {error && <div className="pill bad" style={{ whiteSpace: 'normal' }}>{error}</div>}
        <button className="btn big" disabled={busy}>{mode === 'login' ? 'Log in' : 'Create account'}</button>
        {mode === 'login' && <div className="muted" style={{ fontSize: 13 }}>Forgot your password? Ask the organiser to reset it.</div>}
      </form>
    </div>
  );
}

const phaseText: Record<string, [string, string]> = {
  lobby: ['Preparing', ''],
  intro: ['Live', 'ok'],
  ready: ['Live', 'ok'],
  playing: ['Live', 'ok'],
  answers: ['Live', 'ok'],
  reveal: ['Live', 'ok'],
  scoreboard: ['Live', 'ok'],
  finished: ['Finished', 'warn'],
};

function Games({ me, onLogout }: { me: Me; onLogout: () => void }) {
  const [games, setGames] = useState<Summary[] | null>(null);
  const [all, setAll] = useState(false);
  const [name, setName] = useState('');
  const [showAccount, setShowAccount] = useState(false);
  const { toast, show } = useToast();

  const load = useCallback(() => {
    api<{ games: Summary[] }>('GET', `/api/games${all ? '?all=1' : ''}`).then((r) => setGames(r.games), (e) => show(e.message));
  }, [all, show]);
  useEffect(load, [load]);

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      if (ok) show(ok);
      load();
    } catch (e) {
      show((e as Error).message);
    }
  };

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: 20 }} className="stack">
      <div className="row wrap" style={{ justifyContent: 'space-between' }}>
        <div className="row" style={{ gap: 14 }}>
          <Wordmark />
          <span className="pill">Hitster host</span>
        </div>
        <div className="row">
          <span className="muted" style={{ fontSize: 14 }}>{me.name}</span>
          <button className="btn small secondary" onClick={() => setShowAccount((v) => !v)}>Account</button>
          <button className="btn small ghost" onClick={() => api('POST', '/api/logout').then(onLogout)}>Log out</button>
        </div>
      </div>

      {showAccount && <Account me={me} show={show} />}

      <div className="row wrap" style={{ justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 10 }}>
        <h1 style={{ margin: 0, fontSize: 40 }}>My <span className="accent">games</span></h1>
        <form className="row" onSubmit={(e) => { e.preventDefault(); run(() => api('POST', '/api/games', { name }), 'Game created').then(() => setName('')); }}>
          <input className="input" style={{ width: 280 }} placeholder="Name, e.g. Christmas party 2026" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn">+ New game</button>
        </form>
      </div>
      {me.superAdmin && (
        <label className="row muted" style={{ fontSize: 14, cursor: 'pointer' }}>
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Show games of all accounts (super admin)
        </label>
      )}

      {games && games.length === 0 && (
        <div className="panel center" style={{ padding: 40 }}>
          <div style={{ fontWeight: 800, fontSize: 20 }}>No games yet</div>
          <div className="muted">Create your first game above. You can prepare songs and settings long before the night.</div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 18 }}>
        {games?.map((g, i) => <GameCard key={g.id} g={g} i={i} mine={g.ownerId === me.id} run={run} />)}
      </div>

      {me.superAdmin && <Users show={show} />}
      {toast}
    </div>
  );
}

function GameCard({ g, i, mine, run }: { g: Summary; i: number; mine: boolean; run: (fn: () => Promise<unknown>, ok?: string) => void }) {
  const [c1, c2] = colorAt(i);
  const [label, tone] = phaseText[g.phase];
  return (
    <div className="panel stack fadeup" style={{ padding: 0, overflow: 'hidden', animationDelay: `${i * 40}ms` }}>
      <div style={{ position: 'relative', padding: '18px 18px 16px', background: `linear-gradient(135deg, ${c1}, ${c2})`, minHeight: 120 }}>
        <div className="gc-ribbon-v" style={{ left: '78%', width: '7%' }} />
        <div className="gc-ribbon-h" style={{ top: '30%', height: '14%' }} />
        <div style={{ position: 'relative' }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className={`pill ${tone}`} style={{ background: 'rgba(0,7,73,0.55)' }}>{label}</span>
            <span style={{ fontWeight: 800, letterSpacing: '0.12em', fontSize: 18, background: 'rgba(0,7,73,0.55)', padding: '2px 10px', borderRadius: 10 }}>{g.code}</span>
          </div>
          <div style={{ fontWeight: 800, fontSize: 24, marginTop: 26, textShadow: '0 2px 8px rgba(0,0,0,0.25)' }}>{g.name}</div>
          {!mine && <div style={{ fontSize: 13, fontWeight: 600 }}>by {g.ownerName}</div>}
        </div>
      </div>
      <div style={{ padding: '0 18px 18px' }} className="stack">
        <div className="row wrap muted" style={{ fontSize: 14, gap: 14 }}>
          <span>🔁 {g.stages} round{g.stages === 1 ? '' : 's'}</span><span>🎵 {g.songs} songs{g.bonusSongs ? ` (${g.bonusSongs} ⭐)` : ''}</span>
          {g.songsToCheck > 0 && <span style={{ color: 'var(--yellow)' }}>⚠ {g.songsToCheck} to check</span>}
          <span>👥 {g.teams} teams</span>
        </div>
        <div className="muted" style={{ fontSize: 12 }}>Last change {new Date(g.updatedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</div>
        <div className="row wrap" style={{ gap: 8 }}>
          <Link className="btn small" to={`/host/${g.id}`}>Open host panel</Link>
          <a className="btn small secondary" href={`/show/${g.code}`} target="_blank" rel="noreferrer">Show screen ↗</a>
        </div>
        <div className="row wrap" style={{ gap: 8 }}>
          <button className="btn small ghost" onClick={() => { const n = prompt('New name', g.name); if (n) run(() => api('PATCH', `/api/games/${g.id}`, { name: n })); }}>Rename</button>
          <button className="btn small ghost" onClick={() => run(() => api('POST', `/api/games/${g.id}/duplicate`, {}), 'Copied with all songs and settings')}>Duplicate</button>
          <button className="btn small ghost" style={{ borderColor: 'var(--red)', color: 'var(--red)' }} onClick={() => confirm(`Delete "${g.name}"? Songs, teams and photos are removed for good.`) && run(() => api('DELETE', `/api/games/${g.id}`), 'Game deleted')}>Delete</button>
        </div>
      </div>
    </div>
  );
}

function Account({ me, show }: { me: Me; show: (m: string) => void }) {
  const [f, setF] = useState({ current: '', next: '' });
  return (
    <form
      className="panel stack"
      style={{ maxWidth: 420 }}
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await api('POST', '/api/me/password', f);
          show('Password changed. Please log in again.');
          setTimeout(() => location.reload(), 1500);
        } catch (err) {
          show((err as Error).message);
        }
      }}
    >
      <b>Account</b>
      <div className="muted" style={{ fontSize: 14 }}>{me.name} · {me.email}{me.superAdmin ? ' · super admin' : ''}</div>
      <input className="input" type="password" placeholder="Current password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} autoComplete="current-password" />
      <input className="input" type="password" placeholder="New password (8+ characters)" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} autoComplete="new-password" />
      <button className="btn secondary" disabled={!f.current || f.next.length < 8}>Change password</button>
    </form>
  );
}

function Users({ show }: { show: (m: string) => void }) {
  const [users, setUsers] = useState<(Me & { createdAt: number; games: number })[]>([]);
  useEffect(() => {
    api('GET', '/api/admin/users').then((r) => setUsers(r.users), () => {});
  }, []);
  return (
    <div className="panel" style={{ marginTop: 20 }}>
      <b>Accounts ({users.length})</b>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 10 }}>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} style={{ borderTop: '1px solid var(--line)' }}>
              <td style={{ padding: 8, fontWeight: 700 }}>{u.name}{u.superAdmin && <span className="pill warn" style={{ marginLeft: 6 }}>super admin</span>}</td>
              <td className="muted">{u.email}</td>
              <td className="muted">{u.games} games</td>
              <td className="muted">{new Date(u.createdAt).toLocaleDateString('en-GB')}</td>
              <td style={{ textAlign: 'right' }}>
                <button
                  className="btn small secondary"
                  onClick={async () => {
                    const pw = prompt(`New password for ${u.email} (8+ characters)`);
                    if (!pw) return;
                    try {
                      await api('POST', `/api/admin/users/${u.id}/password`, { password: pw });
                      show(`Password reset. Give the new password to ${u.name}.`);
                    } catch (e) {
                      show((e as Error).message);
                    }
                  }}
                >
                  Reset password
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
