import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import QRCode from 'qrcode';
import type { PublicState, TeamPublic, TimelineCard } from '../../../shared/types';
import { useCountdown, useGameSocket } from '../socket';
import { Avatar, Ring, Vinyl, Wordmark } from '../components/common';
import { GiftCard, Medals, Shapes, TeamCard } from '../components/giftcard';
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
          background: 'var(--bg)',
        }}
      >
        <Shapes count={22} seed={7} opacity={0.45} />
        <div style={{ position: 'absolute', inset: 0, zIndex: 1 }}>{children}</div>
      </div>
    </div>
  );
}

export default function Show() {
  const code = (useParams().code ?? '').toUpperCase();
  const auth = useMemo(() => ({ role: 'show', code }), [code]);
  const g = useGameSocket<PublicState>(auth);
  const s = g.state;
  return (
    <Stage>
      {g.authError && (
        <div className="center" style={{ position: 'absolute', inset: 0, fontSize: 48, fontWeight: 800 }}>{g.authError}</div>
      )}
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
        {s.phase === 'lobby' || s.phase === 'intro' || s.phase === 'finished'
          ? s.game.name
          : <>{s.stage.name}{s.round && s.phase !== 'stageEnd' ? (s.round.kind === 'bonus' ? ' · ⭐ Bonus song' : ` · Song ${s.round.index}`) : ''}</>}
      </div>
    </div>
  );
}

function Screen({ s, serverNow }: { s: PublicState; serverNow: () => number }) {
  switch (s.phase) {
    case 'lobby': return <Lobby s={s} />;
    case 'intro': return <Intro target={s.settings.targetCards} seconds={s.settings.roundSeconds} winBonus={s.settings.winBonus} rounds={s.stage.count} startYears={s.stage.startYears} />;
    case 'stageIntro': return <StageIntro s={s} />;
    case 'stageEnd': return <StageEnd s={s} />;
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
  const url = `${window.location.origin}/join/${s.game.code}`;
  useEffect(() => {
    QRCode.toDataURL(url, { margin: 1, width: 520, color: { dark: '#000749', light: '#ffffff' } }).then(setQr);
  }, [url]);
  return (
    <>
      <TopBar s={s} />
      <div style={{ position: 'absolute', top: 170, left: 64, width: 760 }}>
        <div style={{ fontSize: 120, fontWeight: 800, lineHeight: 0.95, letterSpacing: '-0.03em' }}>
          Hitster<br /><span className="accent">Night!</span>
        </div>
        <p style={{ fontSize: 32, color: 'var(--muted)', marginTop: 28 }}>Scan the code with one phone per team, pick a name and take a team photo.</p>
        <div className="row" style={{ gap: 32, marginTop: 30 }}>
          {qr && <img src={qr} alt="QR" style={{ width: 300, height: 300, borderRadius: 24, background: '#fff', padding: 14 }} />}
          <div style={{ fontSize: 28, fontWeight: 700 }}>
            or go to<br />
            <span style={{ color: 'var(--yellow)' }}>{window.location.host}</span>
            <br />and enter code
            <div style={{ fontSize: 84, fontWeight: 800, letterSpacing: '0.12em', color: '#fff', lineHeight: 1.1 }}>{s.game.code}</div>
          </div>
        </div>
      </div>
      <div style={{ position: 'absolute', top: 170, left: 900, right: 64, bottom: 64 }}>
        <div style={{ fontSize: 30, fontWeight: 800, marginBottom: 20 }}>
          {s.teams.length} team{s.teams.length === 1 ? '' : 's'} ready
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${s.teams.length > 12 ? 5 : 4}, 1fr)`, gap: 18 }}>
          {s.teams.map((t, i) => (
            <div key={t.id} className="pop" style={{ animationDelay: `${(i % 5) * 60}ms`, transform: `rotate(${((i * 37) % 7) - 3}deg)` }}>
              <TeamCard team={t} width={s.teams.length > 12 ? 172 : 214} />
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
        <GiftCard year={song.year} cover={song.coverUrl} width={410} style={{ transform: 'rotate(-4deg)', fontSize: 22 }} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 34, fontWeight: 700, color: 'var(--rose)' }}>The answer is…</div>
          <div style={{ fontSize: 76, fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1.05, marginTop: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{song.title}</div>
          <div style={{ fontSize: 44, fontWeight: 600 }}>{song.artist} <span style={{ color: 'var(--yellow)' }}>· {song.year}</span></div>
        </div>
      </div>
      <AnswerGrid s={s} showResult top={410} />
    </>
  );
}

function Track({ team, target, cardW, highlight }: { team: TeamPublic; target: number; cardW: number; highlight?: (c: TimelineCard) => boolean }) {
  return (
    <div className="grow" style={{ position: 'relative', height: cardW / 1.586 + 10, minWidth: 0 }}>
      <div style={{ position: 'absolute', left: 0, right: 0, top: '50%', height: 5, marginTop: -2.5, borderRadius: 5, background: 'linear-gradient(90deg, var(--pink), var(--rose), var(--sky))', opacity: 0.85 }} />
      <div style={{ position: 'absolute', inset: 0, display: 'grid', gridTemplateColumns: `repeat(${target}, 1fr)`, alignItems: 'center', justifyItems: 'center' }}>
        {Array.from({ length: target }).map((_, k) => {
          const c = team.timeline[k];
          if (!c) return <div key={k} style={{ width: 16, height: 16, borderRadius: '50%', background: 'var(--navy-2)', border: '3px solid rgba(255,255,255,0.35)' }} />;
          const hl = highlight?.(c);
          return <GiftCard key={k} year={c.year} start={c.songId === null} width={cardW} glow={hl} className={hl ? 'pop' : undefined} style={{ fontSize: cardW / 8, animationDelay: '0.6s' }} />;
        })}
      </div>
    </div>
  );
}

function Scoreboard({ s }: { s: PublicState }) {
  const ranked = [...s.teams].sort((a, b) => b.timeline.length - a.timeline.length || b.points - a.points);
  const perPage = 10;
  const pages = Math.max(1, Math.ceil(ranked.length / perPage));
  const [page, setPage] = useState(0);
  useEffect(() => {
    if (pages < 2) return;
    const t = setInterval(() => setPage((p) => (p + 1) % pages), 9000);
    return () => clearInterval(t);
  }, [pages]);
  const p = Math.min(page, pages - 1);
  const rows = ranked.slice(p * perPage, p * perPage + perPage);
  const target = s.settings.targetCards;
  const rowH = Math.min(150, Math.floor((870 - (rows.length - 1) * 10) / Math.max(rows.length, 1)));
  const cardW = Math.min(Math.round((rowH - 12) * 1.586), Math.floor(1260 / target) - 14);
  const song = s.round?.song;
  const isNew = (c: TimelineCard) => !!song && c.songId !== null && c.title === song.title && c.year === song.year;
  return (
    <>
      <TopBar s={s} title={s.pendingBonus.length ? <span style={{ color: 'var(--yellow)' }}>{s.outcome?.message}</span> : <>Score<span className="accent">board</span>{pages > 1 && <span className="muted" style={{ fontSize: 22 }}>  {p + 1}/{pages}</span>}</>} />
      <div key={p} style={{ position: 'absolute', top: 140, left: 64, right: 64, bottom: 50, display: 'grid', gap: 10, alignContent: 'start' }}>
        {rows.map((t, i) => {
          const rank = p * perPage + i + 1;
          const tied = s.pendingBonus.includes(t.id);
          return (
            <div key={t.id} className="row fadeup" style={{ height: rowH, gap: 22, padding: '0 22px', borderRadius: 22, animationDelay: `${i * 50}ms`, background: rank === 1 ? 'rgba(255,214,107,0.12)' : 'rgba(255,255,255,0.06)', border: tied ? '2px solid var(--yellow)' : '1px solid var(--line)' }}>
              <div style={{ width: 54, fontSize: Math.min(40, rowH * 0.4), fontWeight: 800, color: rank === 1 ? 'var(--yellow)' : rank <= 3 ? '#fff' : 'var(--muted)' }}>{rank}</div>
              <Avatar team={t} size={rowH - 18} />
              <div style={{ width: 330, minWidth: 0 }}>
                <div className="row" style={{ gap: 0, minWidth: 0 }}>
                  <span style={{ fontWeight: 800, fontSize: Math.min(30, rowH * 0.32), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{t.name}</span>
                  <Medals wins={t.wins} size={Math.min(30, rowH * 0.3)} />
                </div>
                <div style={{ fontSize: Math.min(22, rowH * 0.24), fontWeight: 700 }}>
                  <span style={{ color: 'var(--yellow)' }}>{t.points} pts</span> <span className="muted">· {t.timeline.length}/{target} cards</span>
                </div>
              </div>
              <Track team={t} target={target} cardW={cardW} highlight={isNew} />
            </div>
          );
        })}
      </div>
    </>
  );
}

function Confetti() {
  const pieces = useMemo(
    () => Array.from({ length: 90 }, (_, i) => ({
      left: Math.random() * 100, delay: Math.random() * 4, dur: 3 + Math.random() * 3,
      color: ['#ff6a4d', '#ffd66b', '#6fe3b4', '#7fd0ea', '#f7a1c4', '#fff'][i % 6], rot: Math.random() * 360, w: 10 + Math.random() * 12,
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

function StageIntro({ s }: { s: PublicState }) {
  const ys = s.stage.startYears;
  return (
    <>
      <TopBar s={s} />
      <div className="center" style={{ position: 'absolute', inset: 0, alignContent: 'center', gap: 26 }}>
        <div className="pop" style={{ fontSize: 40, fontWeight: 700, color: 'var(--rose)' }}>Round {s.stage.index + 1} of {s.stage.count}</div>
        <div className="pop" style={{ fontSize: 150, fontWeight: 800, letterSpacing: '-0.04em', lineHeight: 1 }}>{s.stage.name}</div>
        <div className="row" style={{ gap: 30, marginTop: 10 }}>
          {ys.map((y, i) => <GiftCard key={i} year={y} start width={300} className="pop" style={{ fontSize: 24, animationDelay: `${0.3 + i * 0.2}s`, transform: `rotate(${i ? 4 : -4}deg)` }} />)}
        </div>
        <div style={{ fontSize: 36, color: 'var(--muted)', maxWidth: 1200 }}>
          Fresh timelines for everyone, starting with {ys.join(' and ')}. First to {s.settings.targetCards} cards wins <span style={{ color: 'var(--yellow)', fontWeight: 800 }}>+{s.settings.winBonus}</span> points.
        </div>
      </div>
    </>
  );
}

function StageEnd({ s }: { s: PublicState }) {
  const w = s.teams.find((t) => t.id === s.outcome?.winnerId);
  const ranked = [...s.teams].sort((a, b) => b.points - a.points);
  return (
    <>
      <Confetti />
      <TopBar s={s} />
      <div style={{ position: 'absolute', top: 150, left: 64, right: 64, bottom: 60, display: 'grid', gridTemplateColumns: '1.15fr 1fr', gap: 60, alignItems: 'center' }}>
        <div className="center" style={{ gap: 18 }}>
          <div style={{ fontSize: 44, fontWeight: 800 }}>{s.stage.name} <span className="accent">winner</span></div>
          {w && (
            <>
              <div className="pop" style={{ position: 'relative', transform: 'rotate(-3deg)' }}>
                <TeamCard team={w} width={560} highlight />
                <div className="pop" style={{ position: 'absolute', right: -40, top: -40, animationDelay: '0.5s' }}><Medals wins={[s.stage.index + 1]} size={120} /></div>
              </div>
              <div style={{ fontSize: 84, fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1 }}>{w.name}</div>
              <div className="pill ok pop" style={{ fontSize: 34, padding: '10px 26px', animationDelay: '0.8s', background: 'rgba(255,214,107,0.2)', color: 'var(--yellow)' }}>+{s.settings.winBonus} points</div>
            </>
          )}
        </div>
        <div className="panel stack" style={{ padding: 26, gap: 10 }}>
          <div style={{ fontSize: 30, fontWeight: 800, marginBottom: 6 }}>Total <span className="accent">points</span></div>
          {ranked.slice(0, 10).map((t, i) => (
            <div key={t.id} className="row fadeup" style={{ gap: 16, animationDelay: `${0.4 + i * 0.06}s`, fontSize: 26 }}>
              <b style={{ width: 36, color: i === 0 ? 'var(--yellow)' : 'var(--muted)' }}>{i + 1}</b>
              <Avatar team={t} size={48} />
              <span className="grow" style={{ fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.name}<Medals wins={t.wins} size={26} /></span>
              <b style={{ color: 'var(--yellow)' }}>{t.points}</b>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function Finished({ s }: { s: PublicState }) {
  const ranked = [...s.teams].sort((a, b) => b.points - a.points || b.wins.length - a.wins.length);
  const podium = [ranked[1], ranked[0], ranked[2]];
  const heights = [300, 400, 230];
  const place = [2, 1, 3];
  const rest = ranked.slice(3, 12);
  return (
    <>
      <Confetti />
      <TopBar s={s} />
      <div className="center" style={{ position: 'absolute', top: 110, left: 0, right: 0 }}>
        <div style={{ fontSize: 60, fontWeight: 800, letterSpacing: '-0.03em' }}>The winner of the <span className="accent">night</span></div>
        <div style={{ fontSize: 28, color: 'var(--muted)', marginTop: 4 }}>{s.outcome?.message}</div>
      </div>
      <div className="row" style={{ position: 'absolute', left: 0, right: rest.length ? 560 : 0, bottom: 60, justifyContent: 'center', alignItems: 'flex-end', gap: 26 }}>
        {podium.map((t, i) =>
          t ? (
            <div key={t.id} className="center pop" style={{ gap: 12, animationDelay: `${[0.6, 1.2, 0.2][i]}s` }}>
              <TeamCard team={t} width={i === 1 ? 360 : 280} highlight={i === 1} />
              <div style={{ fontWeight: 800, fontSize: i === 1 ? 40 : 30, maxWidth: 380, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.name}</div>
              <div><Medals wins={t.wins} size={30} /></div>
              <div style={{ width: i === 1 ? 360 : 280, height: heights[i], borderRadius: '24px 24px 0 0', background: i === 1 ? 'linear-gradient(#ffd66b, #f5a524)' : i === 0 ? 'linear-gradient(#e9ecf5, #aab0c8)' : 'linear-gradient(#ffb48a, #d9783f)', color: 'var(--navy)', display: 'grid', placeItems: 'start center', paddingTop: 20 }}>
                <div style={{ fontSize: 80, fontWeight: 800, lineHeight: 1 }}>{place[i]}</div>
                <div style={{ fontSize: 30, fontWeight: 800 }}>{t.points} pts</div>
              </div>
            </div>
          ) : (
            <div key={i} style={{ width: 280 }} />
          ),
        )}
      </div>
      {rest.length > 0 && (
        <div className="panel stack" style={{ position: 'absolute', right: 64, top: 280, width: 480, padding: 22, gap: 10 }}>
          {rest.map((t, i) => (
            <div key={t.id} className="row" style={{ gap: 12, fontSize: 22 }}>
              <b style={{ width: 30, color: 'var(--muted)' }}>{i + 4}</b>
              <Avatar team={t} size={40} />
              <span className="grow" style={{ fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.name}<Medals wins={t.wins} size={22} /></span>
              <b style={{ color: 'var(--yellow)' }}>{t.points}</b>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
