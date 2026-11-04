import type { CSSProperties, ReactNode } from 'react';
import type { TeamPublic, TimelineCard } from '../../../shared/types';
import { photoUrl } from '../socket';

/** Colour per decade, so a timeline reads like a stack of different gift cards. */
const decade: [number, string, string][] = [
  [1960, '#c9b8ff', '#8a6cff'],
  [1970, '#f7a1c4', '#e2569a'],
  [1980, '#ffd66b', '#f5a524'],
  [1990, '#ff8f6b', '#ff5a4a'],
  [2000, '#7fd0ea', '#2f8fdc'],
  [2010, '#b18cff', '#6a2fe6'],
  [2020, '#6fe3b4', '#1fae84'],
  [9999, '#ff9ad5', '#c23cee'],
];
export function cardColors(year: number | null | undefined): [string, string] {
  if (!year) return ['#ff8a5c', '#ff5a4a'];
  const d = decade.find(([y]) => year < y) ?? decade[decade.length - 1];
  return [d[1], d[2]];
}

function Bow() {
  return (
    <svg className="gc-bow" viewBox="0 0 40 28" aria-hidden>
      <ellipse cx="11" cy="12" rx="10" ry="7" transform="rotate(-25 11 12)" fill="rgba(255,255,255,0.85)" />
      <ellipse cx="29" cy="12" rx="10" ry="7" transform="rotate(25 29 12)" fill="rgba(255,255,255,0.85)" />
      <path d="M17 15 L11 27 M23 15 L29 27" stroke="rgba(255,255,255,0.85)" strokeWidth="3.5" strokeLinecap="round" />
      <circle cx="20" cy="14" r="5" fill="#fff" />
    </svg>
  );
}

export interface GiftCardProps {
  year?: number | string | null;
  start?: boolean;
  mystery?: boolean;
  cover?: string | null;
  caption?: ReactNode;
  width: number | string;
  glow?: boolean;
  dashed?: boolean;
  className?: string;
  style?: CSSProperties;
}

/** A gift-card shaped tile: credit card ratio, ribbon, bow and a small wordmark. */
export function GiftCard({ year, start, mystery, cover, caption, width, glow, dashed, className, style }: GiftCardProps) {
  if (dashed) return <div className={`gc gc-empty ${className ?? ''}`} style={{ width, ...style }} />;
  const [c1, c2] = start ? ['#ffffff', '#ece6ff'] : mystery ? ['#ff8a5c', '#ff4f5e'] : cardColors(typeof year === 'number' ? year : null);
  return (
    <div
      className={`gc${start ? ' gc-start' : ''}${glow ? ' gc-glow' : ''} ${className ?? ''}`}
      style={{ width, background: `linear-gradient(135deg, ${c1}, ${c2})`, ...style }}
    >
      <div className="gc-ribbon-v" />
      <div className="gc-ribbon-h" />
      <Bow />
      <div className="gc-mark">giftcards<span>.</span></div>
      {cover && <img className="gc-cover" src={cover} alt="" />}
      <div className="gc-year">{mystery ? '?' : year}</div>
      {start && <div className="gc-tag">START</div>}
      {caption && <div className="gc-caption">{caption}</div>}
    </div>
  );
}

/** Team photo as a personal gift card. */
export function TeamCard({ team, width, rank, highlight }: { team: Pick<TeamPublic, 'id' | 'name' | 'photoVersion'>; width: number; rank?: number; highlight?: boolean }) {
  const url = photoUrl(team.id, team.photoVersion);
  const [c1, c2] = cardColors(1960 + ([...team.id].reduce((a, c) => a + c.charCodeAt(0), 0) % 7) * 10);
  return (
    <div className={`gc gc-team${highlight ? ' gc-glow' : ''}`} style={{ width, background: `linear-gradient(135deg, ${c1}, ${c2})` }}>
      {url ? <img className="gc-photo" src={url} alt="" /> : <div className="gc-initial">{team.name.slice(0, 1).toUpperCase()}</div>}
      <div className="gc-team-name">{team.name}</div>
      <div className="gc-mark" style={{ color: '#fff' }}>giftcards<span>.</span></div>
      {rank !== undefined && <div className="gc-rank">#{rank}</div>}
    </div>
  );
}

/** Floating confetti shapes like on giftcardsgroup.com. */
export function Shapes({ count = 18, seed = 1, opacity = 0.5 }: { count?: number; seed?: number; opacity?: number }) {
  let s = seed * 9301;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  const colors = ['#ff6a4d', '#f7a1c4', '#7fd0ea', '#ffd66b', '#8a6cff', '#6fe3b4'];
  const items = Array.from({ length: count }, (_, i) => ({
    x: rnd() * 100, y: rnd() * 100, size: 10 + rnd() * 26, rot: rnd() * 360, kind: i % 4, color: colors[i % colors.length], dur: 6 + rnd() * 8,
  }));
  return (
    <div className="shapes" aria-hidden style={{ opacity }}>
      {items.map((it, i) => (
        <svg key={i} viewBox="0 0 20 20" style={{ left: `${it.x}%`, top: `${it.y}%`, width: it.size, height: it.size, animationDuration: `${it.dur}s`, ['--r' as any]: `${it.rot}deg` }}>
          {it.kind === 0 && <rect x="4" y="4" width="12" height="12" transform="rotate(45 10 10)" fill={it.color} />}
          {it.kind === 1 && <polygon points="10,2 19,18 1,18" fill={it.color} />}
          {it.kind === 2 && <circle cx="10" cy="10" r="7" fill={it.color} />}
          {it.kind === 3 && <path d="M2 18 A16 16 0 0 1 18 2 L18 18 Z" fill={it.color} />}
        </svg>
      ))}
    </div>
  );
}

/** Vertical timeline row for the phone: dot on the line, gift card, song info. */
export function TimelineRow({ card, highlight }: { card: TimelineCard; highlight?: boolean }) {
  return (
    <div className={`tl-row${highlight ? ' pop' : ''}`}>
      <div className="tl-dot" />
      <GiftCard year={card.year} start={card.songId === null} width={104} glow={highlight} />
      <div className="tl-info">
        {card.songId === null ? (
          <><b>Start year</b><span>Your first card</span></>
        ) : (
          <><b>{card.title}</b><span>{card.artist}</span></>
        )}
      </div>
    </div>
  );
}
