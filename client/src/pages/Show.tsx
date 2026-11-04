import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import type { PublicState, TeamPublic } from '../../../shared/types';
import { useCountdown, useGameSocket } from '../socket';
import { Avatar, Ring, Vinyl, Wordmark, YearCard } from '../components/common';
import Intro from '../components/Intro';

/** Fixed 1920x1080 stage, scaled to whatever screen it's on. */
function Stage({ children }: { children: React.ReactNode }) {
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const fit = () => setScale(Math.min(window.innerWidth / 1920, window.innerHeight / 1080));
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);
  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'hidden', background: 'var(--navy)', display: 'grid', placeItems: 'center' }}>
      <div
        style={{
          width: 1920, height: 1080, transform: `scale(${scale})`, flex: 'none', position: 'relative', overflow: 'hidden',
          background: 'radial-gradient(1200px 700px at 85% -10%, rgba(255,92,138,0.22), transparent 60%), radial-gradient(900px 600px at -10% 110%, rgba(92,200,255,0.18), transparent 60%), var(--navy)',
        }}
      >
        {children}
      </div>
    </div>
  );
}

export default function Show() {
  const auth = useMemo(() => ({ role: 'show' }), []);
  const g = useGameSocket<PublicState>(auth);
  const s = g.state;
  return (
    <Stage>
      {!g.connected && <div style={{ position: 'absolute', top: 16, right: 16, zIndex: 9 }} className="pill bad">offline</div>}
      {s && <Screen s={s} serverNow={g.serverNow} />}
    </Stage>
  );
}

function TopBar({ s, title }: { s: PublicState; title?: React.ReactNode }) {
  return (
    <div className="row" style={{ position: 'absolute', top: 40, left: 64, right: 64, justifyContent: 'space-between' }}>
      <Wordmark size={34} />
      <div style={{ fontSize: 30, fontWeight: 800 }}>{title}</div>
      <div className="pill" style={{ fontSize: 22, padding: '8px 18px' }}>
        {s.round ? (s.round.kind === 'bonus' ? '⭐ Bonus round' : `Round ${s.round.index}`) : 'Hitster Night'}
      </div>
    </div>
  );
}

function Screen({ s, serverNow }: { s: PublicState; serverNow: () => number }) {
  switch (s.phase) {
    case 'lobby': return <Lobby s={s} />;
    case 'intro': return <Intro target={s.settings.targetCards} seconds={s.settings.roundSeconds} />;
    case 'ready':
    case 'playing': return <Playing s={s} serverNow={serverNow} />;
    case 'answers': return <Answers s={s} />;
    case 'reveal': return <Reveal s={s} />;
    case 'scoreboard': return <Scoreboard s={s} />;
    case 'finished': return <Finished s={s} />;
  }
}

function Lobby({ s }: { s: PublicState }) {
  const [qr, setQr] = useState('');
  const url = `${window.location.origin}/`;
  useEffect(() => {
    QRCode.toDataURL(url, { margin: 1, width: 520, color: { dark: '#000749', light: '#ffffff' } }).then(setQr);
  }, [url]);
  return (
    <>
      <TopBar s={s} />
      <div style={{ position: 'absolute', top: 170, left: 64, width: 760 }}>
        <div style={{ fontSize: 120, fontWeight: 800, lineHeight: 0.95, letterSpacing: '-0.03em' }}>
          Hitster<br /><span className="accent">Night</span>
        </div>
        <p style={{ fontSize: 32, color: 'var(--muted)', marginTop: 28 }}>Scan the code with one phone per team, pick a name and take a team photo.</p>
        <div className="row" style={{ gap: 32, marginTop: 30 }}>
          {qr && <img src={qr} alt="QR" style={{ width: 300, height: 300, borderRadius: 24, background: '#fff', padding: 14 }} />}
          <div style={{ fontSize: 28, fontWeight: 700 }}>
            or go to<br />
            <span style={{ color: 'var(--yellow)' }}>{window.location.host}</span>
          </div>
        </div>
      </div>
      <div style={{ position: 'absolute', top: 170, left: 900, right: 64, bottom: 64 }}>
        <div style={{ fontSize: 30, fontWeight: 800, marginBottom: 20 }}>
          {s.teams.length} team{s.teams.length === 1 ? '' : 's'} ready
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${s.teams.length > 12 ? 5 : 4}, 1fr)`, gap: s.teams.length > 12 ? 18 : 22 }}>
          {s.teams.map((t) => (
            <div key={t.id} className="center pop" style={{ gap: 10 }}>
              <Avatar team={t} size={s.teams.length > 12 ? 112 : 130} />
              <div style={{ fontWeight: 800, fontSize: 22, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function Playing({ s, serverNow }: { s: PublicState; serverNow: () => number }) {
  const r = s.round!;
  const left = useCountdown(r.endsAt, serverNow);
  const playing = s.phase === 'playing';
  const players = s.teams.filter((t) => r.participants.includes(t.id));
  return (
    <>
      <TopBar s={s} />
      <div style={{ position: 'absolute', top: 150, left: 0, right: 0, display: 'grid', placeItems: 'center' }}>
        <div style={{ position: 'relative' }}>
          <Vinyl size={600} spinning={playing} label={playing ? '♪' : '?'} />
          {playing && left !== null && (
            <div style={{ position: 'absolute', right: -220, top: 200 }}>
              <Ring seconds={left} total={s.settings.roundSeconds} size={200} />
            </div>
          )}
        </div>
        <div style={{ fontSize: 44, fontWeight: 800, marginTop: 34 }}>
          {playing ? (r.kind === 'bonus' ? 'Guess the exact year!' : 'Where does it fit in your timeline?') : 'Get ready…'}
        </div>
      </div>
      <div className="row wrap" style={{ position: 'absolute', bottom: 40, left: 64, right: 64, justifyContent: 'center', gap: 18 }}>
        {players.map((t) => {
          const locked = r.confirmedTeamIds.includes(t.id);
          const typing = !locked && r.answeredTeamIds.includes(t.id);
          return (
            <div key={t.id} style={{ position: 'relative', opacity: locked ? 1 : 0.55, transition: 'opacity 0.3s' }} title={t.name}>
              <Avatar team={t} size={72} ring={locked ? 'var(--mint)' : typing ? 'var(--yellow)' : 'rgba(255,255,255,0.25)'} />
              {locked && <div style={{ position: 'absolute', right: -4, bottom: -4, fontSize: 24 }}>🔒</div>}
            </div>
          );
        })}
      </div>
    </>
  );
}

function placement(years: number[] | undefined, p: number | null | undefined) {
  if (!years || p === null || p === undefined) return '–';
  if (p === 0) return `before ${years[0]}`;
  if (p >= years.length) return `after ${years[years.length - 1]}`;
  return `${years[p - 1]} – ${years[p]}`;
}

function TeamAnswerCard({ s, t, showResult, compact }: { s: PublicState; t: TeamPublic; showResult: boolean; compact: boolean }) {
  const r = s.round!;
  const a = r.answers?.[t.id];
  const j = r.judgments?.[t.id];
  const ok = r.placementCorrect?.[t.id];
  const mark = (v: boolean | null | undefined) =>
    !showResult ? null : v === true ? <span className="pill ok" style={{ fontSize: 14, flex: 'none' }}>+100</span> : v === false ? <span className="pill bad" style={{ fontSize: 14, flex: 'none' }}>✗</span> : null;
  const border = showResult && r.kind === 'normal' ? (ok ? 'var(--mint)' : 'var(--red)') : 'var(--line)';
  const ell: React.CSSProperties = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 };
  const line = (icon: string, text: string | undefined, v: boolean | null | undefined) => (
    <div className="row" style={{ gap: 6, fontSize: compact ? 16 : 18, minWidth: 0, flex: compact ? 1 : undefined, justifyContent: 'space-between' }}>
      <span style={ell}>{icon} {text || '–'}</span>{mark(v)}
    </div>
  );
  return (
    <div className="panel fadeup" style={{ padding: compact ? 10 : 14, border: `2px solid ${border}`, display: 'grid', gap: compact ? 4 : 8, minWidth: 0 }}>
      <div className="row" style={{ gap: 10, minWidth: 0 }}>
        <Avatar team={t} size={compact ? 36 : 54} />
        <div style={{ fontWeight: 800, fontSize: compact ? 18 : 21, ...ell }}>{t.name}</div>
      </div>
      <div style={{ fontSize: compact ? 22 : 26, fontWeight: 800, color: showResult && r.kind === 'normal' ? (ok ? 'var(--mint)' : 'var(--red)') : 'var(--yellow)' }}>
        {r.kind === 'bonus' ? (a?.yearGuess ?? '–') : placement(r.timelineYears?.[t.id], a?.position)}
        {showResult && r.kind === 'normal' && (ok ? ' ✓' : ' ✗')}
      </div>
      {compact ? (
        <div className="row" style={{ gap: 10, minWidth: 0 }}>{line('🎤', a?.artist, j?.artist)}{line('🎵', a?.title, j?.title)}</div>
      ) : (
        <>{line('🎤', a?.artist, j?.artist)}{line('🎵', a?.title, j?.title)}</>
      )}
    </div>
  );
}

function AnswerGrid({ s, showResult, top }: { s: PublicState; showResult: boolean; top: number }) {
  const r = s.round!;
  const players = s.teams.filter((t) => r.participants.includes(t.id));
  const cols = players.length <= 4 ? players.length || 1 : players.length <= 8 ? 4 : 5;
  return (
    <div style={{ position: 'absolute', top, left: 64, right: 64, bottom: 40, display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: 16, alignContent: 'start' }}>
      {players.map((t) => <TeamAnswerCard key={t.id} s={s} t={t} showResult={showResult} compact={showResult ? players.length > 10 : players.length > 15} />)}
    </div>
  );
}

function Answers({ s }: { s: PublicState }) {
  return (
    <>
      <TopBar s={s} title="Here are your answers…" />
      <AnswerGrid s={s} showResult={false} top={140} />
    </>
  );
}

function Reveal({ s }: { s: PublicState }) {
  const song = s.round!.song!;
  return (
    <>
      <TopBar s={s} />
      <div className="row pop" style={{ position: 'absolute', top: 110, left: 64, right: 64, gap: 40, height: 260 }}>
        {song.coverUrl ? (
          <img src={song.coverUrl} alt="" style={{ width: 260, height: 260, borderRadius: 24, boxShadow: '0 30px 80px rgba(0,0,0,0.5)' }} />
        ) : (
          <Vinyl size={260} />
        )}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 130, fontWeight: 800, lineHeight: 1, color: 'var(--yellow)' }}>{song.year}</div>
          <div style={{ fontSize: 56, fontWeight: 800, marginTop: 10, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{song.title}</div>
          <div style={{ fontSize: 40, color: 'var(--muted)', fontWeight: 600 }}>{song.artist}</div>
        </div>
      </div>
      <AnswerGrid s={s} showResult top={410} />
    </>
  );
}

function Scoreboard({ s }: { s: PublicState }) {
  const ranked = [...s.teams].sort((a, b) => b.timeline.length - a.timeline.length || b.points - a.points);
  const half = Math.ceil(ranked.length / 2);
  const cols = ranked.length > 8 ? [ranked.slice(0, half), ranked.slice(half)] : [ranked];
  const rowH = Math.min(150, Math.floor(860 / Math.max(1, cols[0].length)) - 12);
  const target = s.settings.targetCards;
  return (
    <>
      <TopBar s={s} title={s.pendingBonus.length ? <span style={{ color: 'var(--yellow)' }}>{s.outcome?.message}</span> : 'Scoreboard'} />
      <div style={{ position: 'absolute', top: 130, left: 64, right: 64, bottom: 40, display: 'grid', gridTemplateColumns: `repeat(${cols.length}, 1fr)`, gap: 30 }}>
        {cols.map((col, ci) => (
          <div key={ci} style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
            {col.map((t, i) => {
              const rank = ci * half + i + 1;
              const tied = s.pendingBonus.includes(t.id);
              const small = rowH < 90;
              return (
                <div key={t.id} className="panel row fadeup" style={{ height: rowH, padding: '0 18px', gap: 16, animationDelay: `${rank * 40}ms`, border: tied ? '2px solid var(--yellow)' : undefined }}>
                  <div style={{ width: 40, fontSize: 28, fontWeight: 800, color: rank === 1 ? 'var(--yellow)' : 'var(--muted)' }}>{rank}</div>
                  <Avatar team={t} size={small ? rowH - 22 : 76} />
                  <div style={{ width: 230, minWidth: 0 }}>
                    <div style={{ fontWeight: 800, fontSize: small ? 20 : 26, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.name}</div>
                    <div className="muted" style={{ fontSize: small ? 15 : 19, fontWeight: 700 }}>{t.points} pts · {t.timeline.length}/{target}</div>
                  </div>
                  <div className="row grow" style={{ gap: 6, minWidth: 0 }}>
                    {Array.from({ length: target }).map((_, k) => {
                      const c = t.timeline[k];
                      return (
                        <div
                          key={k}
                          style={{
                            flex: 1, minWidth: 0, height: small ? rowH - 26 : 64, borderRadius: 10, display: 'grid', placeItems: 'center',
                            fontWeight: 800, fontSize: cols.length > 1 ? 15 : 22,
                            background: c ? (c.songId === null ? 'var(--yellow)' : '#fff') : 'rgba(255,255,255,0.06)',
                            color: 'var(--navy)', border: c ? 'none' : '1.5px dashed rgba(255,255,255,0.18)',
                          }}
                          title={c?.title ?? ''}
                        >
                          {c?.year ?? ''}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </>
  );
}

function Confetti() {
  const pieces = useMemo(
    () => Array.from({ length: 90 }, (_, i) => ({
      left: Math.random() * 100, delay: Math.random() * 4, dur: 3 + Math.random() * 3,
      color: ['#ff5c8a', '#ffd23f', '#3ee0a1', '#5cc8ff', '#fff'][i % 5], rot: Math.random() * 360, w: 10 + Math.random() * 12,
    })),
    [],
  );
  return (
    <>
      <style>{`@keyframes fall { from { transform: translateY(-60px) rotate(0) } to { transform: translateY(1150px) rotate(720deg) } }`}</style>
      {pieces.map((p, i) => (
        <div key={i} style={{ position: 'absolute', top: 0, left: `${p.left}%`, width: p.w, height: p.w * 0.45, background: p.color, transform: `rotate(${p.rot}deg)`, animation: `fall ${p.dur}s linear ${p.delay}s infinite` }} />
      ))}
    </>
  );
}

function Finished({ s }: { s: PublicState }) {
  const w = s.teams.find((t) => t.id === s.outcome?.winnerId);
  return (
    <>
      <Confetti />
      <TopBar s={s} />
      <div className="center" style={{ position: 'absolute', inset: 0, gap: 20, alignContent: 'center' }}>
        <div style={{ fontSize: 60, fontWeight: 800 }} className="accent">And the winner is…</div>
        {w && (
          <>
            <div className="pop"><Avatar team={w} size={340} ring="var(--yellow)" /></div>
            <div className="pop" style={{ fontSize: 110, fontWeight: 800, lineHeight: 1 }}>{w.name}</div>
            <div style={{ fontSize: 32, color: 'var(--muted)' }}>{s.outcome?.message} · {w.points} pts</div>
            <div className="row" style={{ gap: 8, marginTop: 10 }}>
              {w.timeline.map((c, i) => <YearCard key={i} card={c} compact />)}
            </div>
          </>
        )}
      </div>
    </>
  );
}
