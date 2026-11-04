import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import QRCode from 'qrcode';
import type { PublicState, TeamPublic, TimelineCard } from '../../../shared/types';
import { useCountdown, useGameSocket } from '../socket';
import { Avatar, Ring, Vinyl, Wordmark } from '../components/common';
import { GiftCard, Medals, Shapes, TeamCard, songCardIndexes } from '../components/giftcard';
import Intro from '../components/Intro';
import { CardRain, CountUp, FloatingCards, Sparkles, useSweep } from '../components/fx';

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
      {s && <Transition phase={s.phase} />}
    </Stage>
  );
}

function Transition({ phase }: { phase: string }) {
  // ready and playing share one screen: no sweep when the music starts
  return useSweep(phase === 'playing' ? 'ready' : phase);
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

const lobbyCols = (n: number) => (n <= 2 ? 2 : n <= 6 ? 3 : n <= 12 ? 4 : 5);
const lobbyCardW = (n: number) => (n <= 2 ? 420 : n <= 6 ? 290 : n <= 12 ? 214 : 172);

function Lobby({ s }: { s: PublicState }) {
  const [qr, setQr] = useState('');
  const url = `${window.location.origin}/join/${s.game.code}`;
  useEffect(() => {
    QRCode.toDataURL(url, { margin: 1, width: 520, color: { dark: '#000749', light: '#ffffff' } }).then(setQr);
  }, [url]);
  return (
    <>
      <FloatingCards count={10} seed={8} />
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
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${lobbyCols(s.teams.length)}, 1fr)`, gap: 18 }}>
          {s.teams.map((t, i) => (
            <div key={t.id} className="pop" style={{ animationDelay: `${(i % 5) * 60}ms`, transform: `rotate(${((i * 37) % 7) - 3}deg)` }}>
              <TeamCard team={t} width={lobbyCardW(s.teams.length)} />
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
          {playing && left !== null && left > 3 && (
            <div style={{ position: 'absolute', right: -220, top: 200 }} className={left <= 10 ? 'anim-bump' : undefined} key={left <= 10 ? left : 'ring'}>
              <Ring seconds={left} total={s.settings.roundSeconds} size={200} />
            </div>
          )}
          {playing && left !== null && left <= 3 && left > 0 && (
            <div key={left} className="count-num" style={{ position: 'absolute', left: '50%', top: '50%', marginLeft: -300, marginTop: -190, zIndex: 5 }}>
              <GiftCard year={left} color={3 - left} width={600} style={{ fontSize: 40, boxShadow: '0 40px 100px rgba(0,0,0,0.6)' }} />
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
            <div key={t.id + (locked ? '-locked' : '')} className={locked ? 'anim-bump' : undefined} style={{ position: 'relative', opacity: locked ? 1 : 0.55, transition: 'opacity 0.3s' }} title={t.name}>
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

function TeamAnswerCard({ s, t, showResult, compact, i }: { s: PublicState; t: TeamPublic; showResult: boolean; compact: boolean; i: number }) {
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
    <div
      className={`panel ${showResult && r.kind === 'normal' ? (ok ? 'anim-bump' : 'anim-shake') : 'fadeup'}`}
      style={{ padding: compact ? 10 : 14, border: `2px solid ${border}`, display: 'grid', gap: compact ? 4 : 8, minWidth: 0, animationDelay: showResult ? `${1.5 + i * 0.07}s` : `${i * 0.05}s`, boxShadow: showResult && ok && r.kind === 'normal' ? '0 0 30px rgba(62,224,161,0.25)' : undefined }}
    >
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
  const n = players.length;
  const cols = n <= 2 ? Math.max(n, 1) : n <= 4 ? 2 : n <= 6 ? 3 : n <= 8 ? 4 : 5;
  // few teams: blow the cards up so they fill the screen
  const zoom = n <= 2 ? 1.9 : n <= 4 ? 1.45 : n <= 6 ? 1.3 : 1;
  return (
    <div style={{ position: 'absolute', top, left: 64, right: 64, bottom: 40 }}>
      <div style={{ zoom, width: STAGE_W / zoom, display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: 16, alignContent: 'start' }}>
        {players.map((t, i) => <TeamAnswerCard key={t.id} i={i} s={s} t={t} showResult={showResult} compact={showResult ? n > 10 : n > 15} />)}
      </div>
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
      <div className="row" style={{ position: 'absolute', top: 110, left: 64, right: 64, gap: 40, height: 260 }}>
        <div className="flip" style={{ position: 'relative', transform: 'rotate(-4deg)', flex: 'none' }}>
          <div className="flip-inner">
            <div className="face back"><GiftCard mystery width={410} style={{ fontSize: 22 }} /></div>
            <div className="face"><GiftCard year={song.year} cover={song.coverUrl} color={4} width={410} style={{ fontSize: 22 }} /></div>
          </div>
          <Sparkles radius={300} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="fadeup" style={{ fontSize: 34, fontWeight: 700, color: 'var(--rose)' }}>The answer is…</div>
          <div className="fadeup" style={{ animationDelay: '1.1s', fontSize: 76, fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1.05, marginTop: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{song.title}</div>
          <div className="fadeup" style={{ animationDelay: '1.3s', fontSize: 44, fontWeight: 600 }}>{song.artist} <span style={{ color: 'var(--yellow)' }}>· {song.year}</span></div>
        </div>
      </div>
      <AnswerGrid s={s} showResult top={410} />
    </>
  );
}

function Track({ team, target, cardW, highlight, captions, delay = 0 }: { team: TeamPublic; target: number; cardW: number; highlight?: (c: TimelineCard) => boolean; captions?: boolean; delay?: number }) {
  const colors = songCardIndexes(team.timeline);
  const cardH = cardW / 1.586;
  const capH = captions ? Math.round(cardW * 0.34) : 0;
  const hlIndex = highlight ? team.timeline.findIndex((c) => highlight(c)) : -1;
  const grid = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = grid.current;
    if (!el || hlIndex < 0) return;
    const slots = [...el.children] as HTMLElement[];
    const card = slots[hlIndex]?.firstElementChild as HTMLElement | null;
    if (!card || !card.animate) return;
    const rect = card.getBoundingClientRect();
    const scale = rect.width / card.offsetWidth || 1; // the stage is scaled to the screen
    const dx = (window.innerWidth / 2 - (rect.left + rect.width / 2)) / scale;
    const dy = (window.innerHeight / 2 - (rect.top + rect.height / 2)) / scale;
    const start = 500 + delay;
    card.animate(
      [
        { transform: `translate(${dx}px, ${dy}px) scale(${Math.min(4, 520 / cardW)}) rotate(-8deg)`, opacity: 0 },
        { transform: `translate(${dx}px, ${dy}px) scale(${Math.min(4, 520 / cardW)}) rotate(-4deg)`, opacity: 1, offset: 0.25 },
        { transform: 'translate(0, 0) scale(1) rotate(0)', opacity: 1 },
      ],
      { duration: 1300, delay: start, easing: 'cubic-bezier(.5,0,.3,1)', fill: 'backwards' },
    );
    const slotW = el.offsetWidth / target;
    for (let k = hlIndex + 1; k < slots.length; k++) {
      const node = slots[k].firstElementChild as HTMLElement | null;
      if (!node || k >= team.timeline.length + 1) break;
      node.animate([{ transform: `translateX(${-slotW}px)` }, { transform: 'translateX(0)' }], { duration: 500, delay: start + 750, easing: 'ease-out', fill: 'backwards' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="grow" style={{ position: 'relative', height: cardH + 10 + capH, minWidth: 0 }}>
      <div style={{ position: 'absolute', left: 0, right: 0, top: cardH / 2 + 5, height: Math.max(5, cardW / 30), transform: 'translateY(-50%)', borderRadius: 5, background: 'linear-gradient(90deg, var(--pink), var(--rose), var(--sky))', opacity: 0.85 }} />
      <div ref={grid} style={{ position: 'absolute', inset: 0, display: 'grid', gridTemplateColumns: `repeat(${target}, 1fr)`, alignItems: 'start', justifyItems: 'center' }}>
        {Array.from({ length: target }).map((_, k) => {
          const c = team.timeline[k];
          if (!c) {
            const d = Math.max(16, cardW / 9);
            return <div key={k}><div style={{ marginTop: cardH / 2 + 5 - d / 2, width: d, height: d, borderRadius: '50%', background: 'var(--navy-2)', border: '3px solid rgba(255,255,255,0.35)' }} /></div>;
          }
          const hl = k === hlIndex;
          return (
            <div key={k} style={{ display: 'grid', justifyItems: 'center', paddingTop: 5, width: cardW, position: 'relative', zIndex: hl ? 5 : undefined }}>
              <div style={{ display: 'grid', justifyItems: 'center' }}>
                <GiftCard year={c.year} start={c.songId === null} color={colors[k]} width={cardW} glow={hl} style={{ fontSize: cardW / 8 }} />
                {captions && (
                  <div style={{ marginTop: 6, width: cardW + 8, textAlign: 'center', fontSize: Math.max(12, cardW * 0.1), lineHeight: 1.2, fontWeight: 700 }}>
                    <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.songId === null ? 'Start' : c.title}</div>
                    <div className="muted" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 500 }}>{c.artist ?? ''}</div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const STAGE_W = 1920 - 128; // usable width on the 1920 stage
const LIST_H = 880; // usable height below the top bar

/** Ranking and points of the previous scoreboard, to animate what changed. */
let lastBoard: Record<string, { rank: number; points: number }> | null = null;

function Scoreboard({ s }: { s: PublicState }) {
  const ranked = [...s.teams].sort((a, b) => b.timeline.length - a.timeline.length || b.points - a.points);
  const [prev] = useState(() => lastBoard);
  const [fresh, setFresh] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setFresh(false), 6000);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    const snap: Record<string, { rank: number; points: number }> = {};
    ranked.forEach((t, i) => (snap[t.id] = { rank: i + 1, points: t.points }));
    lastBoard = snap;
  });
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
  const song = s.round?.song;
  const isNew = (c: TimelineCard) => !!song && c.songId !== null && c.title === song.title && c.year === song.year;
  const n = Math.max(rows.length, 1);
  const gap = n <= 3 ? 24 : n <= 6 ? 16 : 10;
  const rowH = Math.floor((LIST_H - (n - 1) * gap) / n);
  const title = s.pendingBonus.length ? <span style={{ color: 'var(--yellow)' }}>{s.outcome?.message}</span> : <>Score<span className="accent">board</span>{pages > 1 && <span className="muted" style={{ fontSize: 22 }}>  {p + 1}/{pages}</span>}</>;

  const move = (t: TeamPublic, rank: number) => {
    const before = fresh && prev?.[t.id];
    if (!before) return { from: 0, delta: 0, points: t.points };
    const samePage = Math.floor((before.rank - 1) / perPage) === p;
    return { from: samePage ? (before.rank - rank) * (rowH + gap) : 0, delta: before.rank - rank, points: before.points };
  };
  const RankMove = ({ delta, size }: { delta: number; size: number }) =>
    delta ? <span className={`rank-move ${delta > 0 ? 'up' : 'down'}`} style={{ fontSize: size, marginLeft: size * 0.5 }}>{delta > 0 ? `▲${delta}` : `▼${-delta}`}</span> : null;
  const box = (t: TeamPublic, rank: number, i: number, extra: React.CSSProperties) => ({
    key: t.id,
    className: prev && fresh ? 'rank-slide' : 'fadeup',
    style: {
      ['--from' as any]: `${move(t, rank).from}px`,
      position: 'relative',
      zIndex: move(t, rank).delta > 0 ? 2 : 1,
      borderRadius: 26,
      animationDelay: prev && fresh ? undefined : `${i * 60}ms`,
      background: rank === 1 ? 'rgba(255,214,107,0.12)' : 'rgba(255,255,255,0.06)',
      border: s.pendingBonus.includes(t.id) ? '3px solid var(--yellow)' : '1px solid var(--line)',
      ...extra,
    } as React.CSSProperties,
  });
  const rankColor = (rank: number) => (rank === 1 ? 'var(--yellow)' : rank <= 3 ? '#fff' : 'var(--muted)');

  // Few teams: a big block per team, header on top and a full-width timeline with song titles.
  if (n <= 3) {
    const pad = 28;
    const headerH = Math.min(150, Math.round(rowH * 0.32));
    const cardW = Math.floor(Math.min((STAGE_W - pad * 2) / target - 18, ((rowH - headerH - pad * 2 - 20) / (1 / 1.586 + 0.34))));
    return (
      <>
        <FloatingCards />
        <TopBar s={s} title={title} />
        <div style={{ position: 'absolute', top: 140, left: 64, right: 64, height: LIST_H, display: 'grid', gridTemplateRows: `repeat(${n}, 1fr)`, gap }}>
          {rows.map((t, i) => {
            const rank = p * perPage + i + 1;
            const b = box(t, rank, i, { padding: pad, display: 'grid', alignContent: 'center', gap: 16 });
            return (
              <div key={b.key} className={b.className} style={b.style}>
                <div className="row" style={{ gap: 26, height: headerH }}>
                  <div style={{ fontSize: headerH * 0.6, fontWeight: 800, color: rankColor(rank), width: headerH * 0.55 }}>{rank}</div>
                  <Avatar team={t} size={headerH} />
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="row" style={{ gap: 0, minWidth: 0 }}>
                      <span style={{ fontWeight: 800, fontSize: headerH * 0.4, letterSpacing: '-0.02em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{t.name}</span>
                      <Medals wins={t.wins} size={headerH * 0.32} />
                      <RankMove delta={move(t, rank).delta} size={headerH * 0.18} />
                    </div>
                    <div style={{ fontSize: headerH * 0.2, fontWeight: 700 }} className="muted">{t.timeline.length}/{target} cards</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: headerH * 0.48, fontWeight: 800, color: 'var(--yellow)', lineHeight: 1 }}><CountUp from={move(t, rank).points} to={t.points} delay={1900} /></div>
                    <div className="muted" style={{ fontSize: headerH * 0.16, fontWeight: 700 }}>points</div>
                  </div>
                </div>
                <Track team={t} target={target} cardW={cardW} highlight={fresh ? isNew : undefined} captions delay={i * 150} />
              </div>
            );
          })}
        </div>
      </>
    );
  }

  // More teams: one row per team, everything grows with the row height.
  const avatar = Math.min(150, rowH - 18);
  const nameW = rowH > 130 ? 400 : 330;
  const rankW = Math.min(80, rowH * 0.5);
  const trackW = STAGE_W - 44 - rankW - avatar - nameW - 3 * 22;
  const cardW = Math.floor(Math.min((rowH - 14) * 1.586, trackW / target - 12));
  return (
    <>
      <FloatingCards />
      <TopBar s={s} title={title} />
      <div key={p} style={{ position: 'absolute', top: 140, left: 64, right: 64, height: LIST_H, display: 'grid', gap, alignContent: 'start' }}>
        {rows.map((t, i) => {
          const rank = p * perPage + i + 1;
          const b = box(t, rank, i, { height: rowH, padding: '0 22px', display: 'flex', alignItems: 'center', gap: 22 });
          return (
            <div key={b.key} className={b.className} style={b.style}>
              <div style={{ width: rankW, fontSize: Math.min(64, rowH * 0.4), fontWeight: 800, color: rankColor(rank) }}>{rank}</div>
              <Avatar team={t} size={avatar} />
              <div style={{ width: nameW, minWidth: 0 }}>
                <div className="row" style={{ gap: 0, minWidth: 0 }}>
                  <span style={{ fontWeight: 800, fontSize: Math.min(46, rowH * 0.32), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{t.name}</span>
                  <Medals wins={t.wins} size={Math.min(40, rowH * 0.3)} />
                  <RankMove delta={move(t, rank).delta} size={Math.min(24, rowH * 0.18)} />
                </div>
                <div style={{ fontSize: Math.min(32, rowH * 0.24), fontWeight: 700 }}>
                  <span style={{ color: 'var(--yellow)' }}><CountUp from={move(t, rank).points} to={t.points} delay={1900} /> pts</span> <span className="muted">· {t.timeline.length}/{target} cards</span>
                </div>
              </div>
              <Track team={t} target={target} cardW={cardW} highlight={fresh ? isNew : undefined} delay={i * 110} />
            </div>
          );
        })}
      </div>
    </>
  );
}

function Confetti() {
  const pieces = useMemo(
    () => Array.from({ length: 50 }, (_, i) => ({
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
      <CardRain />
      <Confetti />
      <TopBar s={s} />
      <div style={{ position: 'absolute', top: 150, left: 64, right: 64, bottom: 60, display: 'grid', gridTemplateColumns: '1.15fr 1fr', gap: 60, alignItems: 'center' }}>
        <div className="center" style={{ gap: 18 }}>
          <div style={{ fontSize: 44, fontWeight: 800 }}>{s.stage.name} <span className="accent">winner</span></div>
          {w && (
            <>
              <div className="pop" style={{ position: 'relative', transform: 'rotate(-3deg)' }}>
                <TeamCard team={w} width={560} highlight />
                <div className="medal-drop" style={{ position: 'absolute', right: -40, top: -40, zIndex: 3 }}><Medals wins={[s.stage.index + 1]} size={120} /></div>
              </div>
              <div style={{ fontSize: 84, fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1 }}>{w.name}</div>
              <div className="pill ok pop" style={{ fontSize: 34, padding: '10px 26px', animationDelay: '0.8s', background: 'rgba(255,214,107,0.2)', color: 'var(--yellow)' }}>+{s.settings.winBonus} points</div>
            </>
          )}
        </div>
        <div className="panel stack" style={{ padding: 26, gap: 10, background: 'rgba(12,8,80,0.88)', backdropFilter: 'blur(6px)' }}>
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
      <CardRain />
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
        <div className="panel stack" style={{ position: 'absolute', right: 64, top: 280, width: 480, padding: 22, gap: 10, background: 'rgba(12,8,80,0.88)', backdropFilter: 'blur(6px)' }}>
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
