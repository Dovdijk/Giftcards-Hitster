import { useEffect, useState } from 'react';
import type { TeamPublic, TimelineCard } from '../../../shared/types';
import { photoUrl } from '../socket';

export function Wordmark({ size = 22 }: { size?: number }) {
  return (
    <span className="wordmark" style={{ fontSize: size }}>
      giftcards
      <small>.GROUP</small>
    </span>
  );
}

const palette = ['#ff6a4d', '#ffd66b', '#6fe3b4', '#7fd0ea', '#b18cff', '#f7a1c4'];
export const teamColor = (id: string) => palette[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % palette.length];

export function Avatar({ team, size = 48, ring }: { team: Pick<TeamPublic, 'id' | 'name' | 'photoVersion'>; size?: number; ring?: string }) {
  const url = photoUrl(team.id, team.photoVersion);
  const style = { width: size, height: size, boxShadow: `0 0 0 ${Math.max(2, size / 22)}px ${ring ?? teamColor(team.id)}`, fontSize: size * 0.4 };
  return url ? (
    <img className="avatar" src={url} alt={team.name} style={style} />
  ) : (
    <div className="avatar" style={{ ...style, background: teamColor(team.id), color: 'var(--navy)' }}>
      {team.name.slice(0, 1).toUpperCase()}
    </div>
  );
}

export function Vinyl({ size = 300, spinning, label }: { size?: number; spinning?: boolean; label?: string }) {
  return (
    <div className={`vinyl${spinning ? ' spin' : ''}`} style={{ width: size, fontSize: size / 14, boxShadow: `0 ${size / 20}px ${size / 7}px rgba(0,0,0,0.5), inset 0 0 0 ${Math.max(2, size / 50)}px #0a0a0a` }}>
      <div className="label">{label ?? '?'}</div>
      <div className="hole" />
    </div>
  );
}

export function YearCard({ card, compact, highlight }: { card: TimelineCard; compact?: boolean; highlight?: boolean }) {
  const start = card.songId === null;
  return (
    <div className={`yearcard${start ? ' start' : ''}${highlight ? ' pop' : ''}`} style={highlight ? { outline: '3px solid var(--mint)' } : undefined}>
      <span className="year">{card.year}</span>
      {!compact && (
        <div className="meta">
          {start ? (
            <div>Start year</div>
          ) : (
            <>
              <div>{card.title}</div>
              <div style={{ opacity: 0.7 }}>{card.artist}</div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function useToast() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 3500);
    return () => clearTimeout(t);
  }, [msg]);
  return { toast: msg ? <div className="toast">{msg}</div> : null, show: setMsg };
}

export function Offline({ connected }: { connected: boolean }) {
  return connected ? null : <div className="offline">Reconnecting…</div>;
}

export function Ring({ seconds, total, size = 120 }: { seconds: number; total: number; size?: number }) {
  const r = size / 2 - 8;
  const c = 2 * Math.PI * r;
  const frac = total ? seconds / total : 0;
  const color = seconds <= 10 ? 'var(--red)' : seconds <= 20 ? 'var(--yellow)' : 'var(--mint)';
  return (
    <svg width={size} height={size} style={{ display: 'block' }}>
      <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,0.12)" strokeWidth={10} fill="none" />
      <circle
        cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={10} fill="none" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - frac)} transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dashoffset 0.25s linear, stroke 0.3s' }}
      />
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" fill="#fff" fontWeight={800} fontSize={size * 0.32}>
        {seconds}
      </text>
    </svg>
  );
}
