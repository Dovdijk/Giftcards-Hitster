import type { CSSProperties, ReactNode } from 'react';
import type { TeamPublic, TimelineCard } from '../../../shared/types';
import { photoUrl } from '../socket';

/** Card colours in timeline order: 1st song card magenta, 2nd blue, 3rd coral, … */
export const CARD_COLORS: [string, string][] = [
  ['#ff9ad5', '#c23cee'], // magenta
  ['#7fd0ea', '#2f8fdc'], // blue
  ['#ff8f6b', '#ff5a4a'], // coral
  ['#ffd66b', '#f5a524'], // yellow
  ['#6fe3b4', '#1fae84'], // green
  ['#b18cff', '#6a2fe6'], // purple
  ['#f7a1c4', '#e2569a'], // pink
  ['#5eead4', '#0d9488'], // teal
  ['#ffb86b', '#f97316'], // orange
  ['#c9b8ff', '#8a6cff'], // lavender
];
/**
 * Colour for song number i (0-based). The first 10 come from the brand palette; after that each
 * song gets its own hue (golden-angle steps), so no two songs in a round share a colour.
 */
export const colorAt = (i: number): [string, string] => {
  if (i >= 0 && i < CARD_COLORS.length) return CARD_COLORS[i];
  if (i < 0) return CARD_COLORS[((i % CARD_COLORS.length) + CARD_COLORS.length) % CARD_COLORS.length];
  const h = Math.round((i * 137.508 + 20) % 360);
  return [`hsl(${h} 85% 72%)`, `hsl(${(h + 25) % 360} 75% 48%)`];
};

/** Brand colour by position, repeating (decoration, team cards). */
export const paletteAt = (i: number): [string, string] => CARD_COLORS[((i % CARD_COLORS.length) + CARD_COLORS.length) % CARD_COLORS.length];

/**
 * Colour index of each card in a timeline: every song keeps the colour of its number in the
 * round, wherever it lands. Start cards get -1 (they are white).
 */
export function songCardIndexes(timeline: { songId: string | null; n?: number }[]) {
  let pos = 0;
  return timeline.map((c) => (c.songId === null ? -1 : c.n ? c.n - 1 : pos++));
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
  color?: number; // index into CARD_COLORS
  glow?: boolean;
  dashed?: boolean;
  className?: string;
  style?: CSSProperties;
}

/** 1% of the card width in px: card text scales with the card, also on older TV browsers without container units. */
const cq = (width: number | string): CSSProperties => (typeof width === 'number' ? ({ ['--cq' as any]: `${width / 100}px` } as CSSProperties) : {});

/** A gift-card shaped tile: credit card ratio, ribbon, bow and a small wordmark. */
export function GiftCard({ year, start, mystery, cover, caption, width, color, glow, dashed, className, style }: GiftCardProps) {
  if (dashed) return <div className={`gc gc-empty ${className ?? ''}`} style={{ width, ...style }} />;
  const [c1, c2] = start ? ['#ffffff', '#ece6ff'] : mystery ? ['#ff8a5c', '#ff4f5e'] : colorAt(color ?? 0);
  return (
    <div
      className={`gc${start ? ' gc-start' : ''}${glow ? ' gc-glow' : ''} ${className ?? ''}`}
      style={{ width, ...cq(width), background: `linear-gradient(135deg, ${c1}, ${c2})`, ...style }}
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
  const [c1, c2] = paletteAt([...team.id].reduce((a, c) => a + c.charCodeAt(0), 0));
  return (
    <div className={`gc gc-team${highlight ? ' gc-glow' : ''}`} style={{ width, ...cq(width), background: `linear-gradient(135deg, ${c1}, ${c2})` }}>
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
export function TimelineRow({ card, color, highlight }: { card: TimelineCard; color: number; highlight?: boolean }) {
  return (
    <div className={`tl-row${highlight ? ' pop' : ''}`}>
      <div className="tl-dot" />
      <GiftCard year={card.year} start={card.songId === null} color={color} width={104} glow={highlight} />
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

/** Gold medals with the round number for every round a team won. */
export function Medals({ wins, size = 26 }: { wins: number[]; size?: number }) {
  if (!wins.length) return null;
  return (
    <span style={{ display: 'inline-flex', gap: size * 0.18, verticalAlign: 'middle', marginLeft: size * 0.3, flex: 'none' }}>
      {wins.map((w, i) => (
        <span
          key={i}
          title={`Won round ${w}`}
          style={{
            width: size, height: size, borderRadius: '50%', display: 'inline-grid', placeItems: 'center',
            background: 'radial-gradient(circle at 35% 30%, #fff6c4, #ffd23f 45%, #d99a00 100%)',
            boxShadow: `0 0 0 ${Math.max(1.5, size / 14)}px #b07c00, 0 ${size / 8}px ${size / 3}px rgba(255,200,0,0.45)`,
            color: '#5a3d00', fontWeight: 800, fontSize: size * 0.55, lineHeight: 1,
          }}
        >
          {w}
        </span>
      ))}
    </span>
  );
}
