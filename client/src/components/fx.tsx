import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { GiftCard } from './giftcard';

/** Deterministic pseudo random, so re-renders don't reshuffle the decoration. */
function rng(seed: number) {
  let s = seed * 9301 + 49297;
  return () => ((s = (s * 9301 + 49297) % 233280) / 233280);
}

/** Gift cards slowly drifting up behind the content. */
export function FloatingCards({ count = 14, seed = 3 }: { count?: number; seed?: number }) {
  const items = useMemo(() => {
    const r = rng(seed);
    return Array.from({ length: count }, (_, i) => ({
      left: r() * 100,
      top: 100 + r() * 30,
      w: 90 + r() * 120,
      dur: 22 + r() * 22,
      delay: -r() * 40,
      dx: (r() - 0.5) * 300,
      r0: (r() - 0.5) * 50,
      r1: (r() - 0.5) * 140,
      color: i,
    }));
  }, [count, seed]);
  return (
    <div className="float-cards" aria-hidden>
      {items.map((it, i) => (
        <div
          key={i}
          style={{
            left: `${it.left}%`, top: `${it.top}%`, animationDuration: `${it.dur}s`, animationDelay: `${it.delay}s`,
            ['--dx' as any]: `${it.dx}px`, ['--r0' as any]: `${it.r0}deg`, ['--r1' as any]: `${it.r1}deg`,
          }}
        >
          <GiftCard width={it.w} color={it.color} year="" />
        </div>
      ))}
    </div>
  );
}

/** A fan of gift cards sweeping across the screen: the transition between screens. */
export function Sweep() {
  const cards = useMemo(() => {
    const r = rng(Date.now() % 1000);
    return Array.from({ length: 9 }, (_, i) => ({ y: (i - 4) * 120 + (r() - 0.5) * 60, r: (r() - 0.5) * 40, delay: Math.abs(i - 4) * 0.035 + r() * 0.05, color: i }));
  }, []);
  return (
    <div className="sweep" aria-hidden>
      {cards.map((c, i) => (
        <div key={i} style={{ ['--y' as any]: `${c.y}px`, ['--r' as any]: `${c.r}deg`, animationDelay: `${c.delay}s` }}>
          <GiftCard width={420} color={c.color} year="" style={{ boxShadow: '0 30px 60px rgba(0,0,0,0.45)' }} />
        </div>
      ))}
    </div>
  );
}

/** Plays <Sweep/> once every time `trigger` changes (skipping the first render). */
export function useSweep(trigger: string) {
  const [n, setN] = useState(0);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setN((x) => x + 1);
    const t = setTimeout(() => setN(0), 1500);
    return () => clearTimeout(t);
  }, [trigger]);
  return n ? <Sweep key={n} /> : null;
}

/** Gift cards raining down: round and night winners. */
export function CardRain({ count = 16 }: { count?: number }) {
  const items = useMemo(() => {
    const r = rng(11);
    return Array.from({ length: count }, (_, i) => ({ left: r() * 100, w: 70 + r() * 110, dur: 4.5 + r() * 4, delay: -r() * 8, r0: (r() - 0.5) * 60, r1: (r() - 0.5) * 720, color: i }));
  }, [count]);
  return (
    <div className="rain float-cards" aria-hidden style={{ zIndex: 0 }}>
      {items.map((it, i) => (
        <div key={i} style={{ left: `${it.left}%`, animationDuration: `${it.dur}s`, animationDelay: `${it.delay}s`, opacity: 0.55, ['--r0' as any]: `${it.r0}deg`, ['--r1' as any]: `${it.r1}deg` }}>
          <GiftCard width={it.w} color={it.color} year="" />
        </div>
      ))}
    </div>
  );
}

/** Number that counts from `from` to `to`. */
export function CountUp({ from, to, delay = 0, duration = 1200 }: { from: number; to: number; delay?: number; duration?: number }) {
  const [v, setV] = useState(from);
  useEffect(() => {
    if (from === to) return setV(to);
    let raf = 0;
    const start = performance.now() + delay;
    const tick = (now: number) => {
      const t = Math.min(1, Math.max(0, (now - start) / duration));
      const eased = 1 - Math.pow(1 - t, 3);
      setV(Math.round(from + (to - from) * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [from, to, delay, duration]);
  return <>{v}</>;
}

/** Sparkles bursting out of the middle of the parent. */
export function Sparkles({ count = 18, radius = 320, delay = 1.1 }: { count?: number; radius?: number; delay?: number }) {
  const items = useMemo(() => {
    const r = rng(5);
    return Array.from({ length: count }, (_, i) => {
      const a = (i / count) * Math.PI * 2 + r() * 0.4;
      const d = radius * (0.6 + r() * 0.5);
      return { sx: Math.cos(a) * d, sy: Math.sin(a) * d * 0.7, delay: delay + r() * 0.25, size: 10 + r() * 14 };
    });
  }, [count, radius, delay]);
  return (
    <div aria-hidden style={{ position: 'absolute', left: '50%', top: '50%', pointerEvents: 'none' }}>
      {items.map((s, i) => (
        <span key={i} className="sparkle" style={{ width: s.size, height: s.size, ['--sx' as any]: `${s.sx}px`, ['--sy' as any]: `${s.sy}px`, animationDelay: `${s.delay}s` }} />
      ))}
    </div>
  );
}

/** Confetti burst for the phone. */
export function Burst() {
  const items = useMemo(() => {
    const r = rng(Date.now() % 997);
    const colors = ['#ff6a4d', '#ffd66b', '#6fe3b4', '#7fd0ea', '#f7a1c4', '#b18cff'];
    return Array.from({ length: 46 }, (_, i) => ({ bx: (r() - 0.5) * 520, by: -200 + r() * 700, br: r() * 900, color: colors[i % colors.length], delay: r() * 0.15 }));
  }, []);
  // portal: animated parents would otherwise clip the full-screen burst
  return createPortal(
    <div className="burst" aria-hidden>
      {items.map((b, i) => (
        <i key={i} style={{ background: b.color, animationDelay: `${b.delay}s`, ['--bx' as any]: `${b.bx}px`, ['--by' as any]: `${b.by}px`, ['--br' as any]: `${b.br}deg` }} />
      ))}
    </div>,
    document.body,
  );
}

/** Vibration on Android phones (iPhones ignore it). */
export function vibrate(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* not supported */
  }
}
