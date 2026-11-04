import { useEffect, useState } from 'react';
import { Vinyl, Wordmark } from './common';
import { GiftCard, Medals } from './giftcard';

/** Looping explanation shown on the big screen before the first song. */
export default function Intro({ target, seconds, winBonus, rounds, startYears }: { target: number; seconds: number; winBonus: number; rounds: number; startYears: number[] }) {
  const steps = [
    { title: <>Welcome to <span className="accent">Hitster Night!</span></>, text: 'Music, memories and a little bit of competition.', visual: <Vinyl size={360} spinning label="♪" /> },
    { title: <>Every team starts with <span className="accent">{startYears.length === 1 ? 'one year' : 'two years'}</span></>, text: 'That is the start of your timeline.', visual: <Cards years={startYears} start /> },
    { title: <>Listen <span className="accent">carefully</span></>, text: `A song plays. No title, no artist. You have ${seconds} seconds.`, visual: <Vinyl size={360} spinning /> },
    { title: <>Drag it to the <span className="accent">right spot</span></>, text: 'Before or after? Place the song in your timeline on your phone.', visual: <DragDemo /> },
    { title: <>Bonus <span className="accent">points</span></>, text: 'Name the artist: +100. Name the title: +100.', visual: <Points /> },
    { title: <>Right spot? <span className="accent">Card is yours</span></>, text: 'Every correct placement grows your timeline.', visual: <Cards years={[1979, 1987, 1995, 2004]} pop={2} /> },
    { title: <>First to <span className="accent">{target} cards</span> wins the round</>, text: `Round winner: +${winBonus} points and a gold medal. Tie? Bonus song: closest to the exact year!`, visual: <Medals wins={[1]} size={300} /> },
    { title: <>{rounds > 1 ? <>{rounds} rounds, </> : null}most <span className="accent">points</span> wins the night</>, text: 'Points carry over between rounds. Every round starts with a fresh timeline.', visual: <div style={{ fontSize: 260 }}>🏆</div> },
  ];
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % steps.length), 6500);
    return () => clearInterval(t);
  }, [steps.length]);
  const step = steps[i];
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <div style={{ position: 'absolute', top: 40, left: 64 }}><Wordmark size={34} /></div>
      <div key={i} style={{ position: 'absolute', inset: '140px 64px 120px', display: 'grid', gridTemplateColumns: '1fr 1fr', alignItems: 'center', gap: 60 }}>
        <div className="fadeup">
          <div style={{ fontSize: 30, fontWeight: 800, color: 'var(--pink)' }}>{i + 1} / {steps.length}</div>
          <div style={{ fontSize: 96, fontWeight: 800, lineHeight: 1.02, letterSpacing: '-0.02em', marginTop: 10 }}>{step.title}</div>
          <div style={{ fontSize: 38, color: 'var(--muted)', marginTop: 26, lineHeight: 1.3 }}>{step.text}</div>
        </div>
        <div className="center pop" style={{ animationDelay: '0.2s' }}>{step.visual}</div>
      </div>
      <div className="row" style={{ position: 'absolute', bottom: 56, left: 64, right: 64, gap: 10 }}>
        {steps.map((_, k) => (
          <div key={k} style={{ flex: 1, height: 8, borderRadius: 8, background: k <= i ? 'var(--pink)' : 'rgba(255,255,255,0.15)', transition: 'background 0.4s' }} />
        ))}
      </div>
    </div>
  );
}

function Card({ year, start, style, className, width = 250 }: { year: number | string; start?: boolean; style?: React.CSSProperties; className?: string; width?: number }) {
  return <GiftCard year={year} start={start} mystery={year === '?'} width={width} className={className} style={{ fontSize: 26, ...style }} />;
}

function Cards({ years, pop, start }: { years: number[]; pop?: number; start?: boolean }) {
  return (
    <div className="row" style={{ gap: 14, position: 'relative' }}>
      <div style={{ position: 'absolute', left: -30, right: -30, top: '50%', height: 6, borderRadius: 6, background: 'linear-gradient(90deg, var(--pink), var(--rose), var(--sky))' }} />
      {years.map((y, k) => (
        <Card key={k} width={years.length > 2 ? 190 : years.length === 2 ? 260 : 300} year={y} start={start || y === 1987} className={k === pop ? 'pop' : undefined} style={k === pop ? { outline: '6px solid var(--mint)', animationDelay: '0.9s' } : undefined} />
      ))}
    </div>
  );
}

function DragDemo() {
  return (
    <div style={{ position: 'relative', width: 620, height: 420 }}>
      <style>{`@keyframes dragIn { 0%,15% { transform: translate(185px, -10px) rotate(-6deg) } 55%,100% { transform: translate(185px, 230px) rotate(0) } }
               @keyframes makeRoom { 0%,40% { transform: translateX(0) } 60%,100% { transform: translateX(-110px) } }
               @keyframes makeRoomR { 0%,40% { transform: translateX(0) } 60%,100% { transform: translateX(110px) } }`}</style>
      <div className="row" style={{ position: 'absolute', top: 230, left: 0, right: 0, justifyContent: 'center', gap: 50 }}>
        <Card year={1987} start style={{ animation: 'makeRoom 3s ease infinite alternate' }} />
        <Card year={2004} style={{ animation: 'makeRoomR 3s ease infinite alternate' }} />
      </div>
      <Card year="?" style={{ position: 'absolute', left: 0, top: 0, animation: 'dragIn 3s ease infinite alternate' }} />
    </div>
  );
}

function Points() {
  return (
    <div className="stack" style={{ gap: 26 }}>
      {['🎤 Artist', '🎵 Title'].map((l, k) => (
        <div key={l} className="row pop" style={{ gap: 24, fontSize: 56, fontWeight: 800, animationDelay: `${0.4 + k * 0.5}s` }}>
          <span>{l}</span>
          <span className="pill ok" style={{ fontSize: 48, padding: '8px 22px' }}>+100</span>
        </div>
      ))}
    </div>
  );
}
