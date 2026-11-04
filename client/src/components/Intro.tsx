import { useEffect, useState } from 'react';
import { Vinyl, Wordmark } from './common';

/** Looping explanation shown on the big screen before the first song. */
export default function Intro({ target, seconds }: { target: number; seconds: number }) {
  const steps = [
    { title: <>Welcome to <span className="accent">Hitster Night!</span></>, text: 'Music, memories and a little bit of competition.', visual: <Vinyl size={360} spinning label="♪" /> },
    { title: <>Every team starts with <span className="accent">one year</span></>, text: 'That card is the start of your timeline.', visual: <Cards years={[1987]} /> },
    { title: <>Listen <span className="accent">carefully</span></>, text: `A song plays. No title, no artist. You have ${seconds} seconds.`, visual: <Vinyl size={360} spinning /> },
    { title: <>Drag it to the <span className="accent">right spot</span></>, text: 'Before or after? Place the song in your timeline on your phone.', visual: <DragDemo /> },
    { title: <>Bonus <span className="accent">points</span></>, text: 'Name the artist: +100. Name the title: +100.', visual: <Points /> },
    { title: <>Right spot? <span className="accent">Card is yours</span></>, text: 'Every correct placement grows your timeline.', visual: <Cards years={[1979, 1987, 1995, 2004]} pop={2} /> },
    { title: <>First to <span className="accent">{target} cards</span> wins</>, text: 'Same round? Most points wins. Still a tie? Bonus round: closest to the exact year!', visual: <div style={{ fontSize: 260 }}>🏆</div> },
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

function Card({ year, start, style, className }: { year: number | string; start?: boolean; style?: React.CSSProperties; className?: string }) {
  return (
    <div className={className} style={{ width: 170, height: 230, borderRadius: 22, background: start ? 'var(--yellow)' : '#fff', color: 'var(--navy)', display: 'grid', placeItems: 'center', fontSize: 52, fontWeight: 800, boxShadow: '0 20px 50px rgba(0,0,0,0.4)', ...style }}>
      {year}
    </div>
  );
}

function Cards({ years, pop }: { years: number[]; pop?: number }) {
  return (
    <div className="row" style={{ gap: 18 }}>
      {years.map((y, k) => (
        <Card key={k} year={y} start={y === 1987} className={k === pop ? 'pop' : undefined} style={k === pop ? { outline: '6px solid var(--mint)', animationDelay: '0.9s' } : undefined} />
      ))}
    </div>
  );
}

function DragDemo() {
  return (
    <div style={{ position: 'relative', width: 620, height: 420 }}>
      <style>{`@keyframes dragIn { 0%,15% { transform: translate(225px, -10px) rotate(-6deg) } 55%,100% { transform: translate(225px, 190px) rotate(0) } }
               @keyframes makeRoom { 0%,40% { transform: translateX(0) } 60%,100% { transform: translateX(-110px) } }
               @keyframes makeRoomR { 0%,40% { transform: translateX(0) } 60%,100% { transform: translateX(110px) } }`}</style>
      <div className="row" style={{ position: 'absolute', top: 190, left: 0, right: 0, justifyContent: 'center', gap: 50 }}>
        <Card year={1987} start style={{ animation: 'makeRoom 3s ease infinite alternate' }} />
        <Card year={2004} style={{ animation: 'makeRoomR 3s ease infinite alternate' }} />
      </div>
      <Card year="?" style={{ position: 'absolute', left: 0, top: 0, background: 'var(--pink)', color: '#fff', animation: 'dragIn 3s ease infinite alternate' }} />
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
