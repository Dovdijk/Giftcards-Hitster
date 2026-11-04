import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import type { PlayerState, TimelineCard } from '../../../shared/types';
import { useCountdown, useGameSocket } from '../socket';
import { Avatar, Offline, Ring, Vinyl, Wordmark, useToast } from '../components/common';
import { GiftCard, Medals, Shapes, TeamCard, TimelineRow } from '../components/giftcard';

const tokenKey = (code: string) => `hitster-token-${code}`;

function readToken(code: string) {
  try {
    return localStorage.getItem(tokenKey(code)) ?? undefined;
  } catch {
    return undefined;
  }
}
function writeToken(code: string, t: string | null) {
  try {
    if (t) localStorage.setItem(tokenKey(code), t);
    else localStorage.removeItem(tokenKey(code));
  } catch {
    /* private mode */
  }
}

export default function Play() {
  const code = (useParams().code ?? '').toUpperCase();
  const [token, setToken] = useState<string | undefined>(() => readToken(code));
  const auth = useMemo(() => ({ role: 'player', token, code }), [token, code]);
  const g = useGameSocket<PlayerState>(auth);
  const { toast, show } = useToast();

  useEffect(() => {
    if (g.tokenInvalid) {
      writeToken(code, null);
      setToken(undefined);
    }
  }, [g.tokenInvalid]);

  const s = g.state;
  if (g.authError)
    return (
      <div className="center stack" style={{ height: '100%', padding: 24 }}>
        <Wordmark />
        <div style={{ fontWeight: 800, fontSize: 22 }}>{g.authError === 'No game with this code' ? `No game with code ${code}` : g.authError}</div>
        <a className="btn" href="/">Enter another code</a>
      </div>
    );
  if (!s) return <div className="center" style={{ height: '100%' }}><Wordmark /></div>;

  const me = s.me;
  let body;
  if (!me) {
    body = (
      <JoinForm
        full={!s.settings.joinOpen}
        onJoin={async (name) => {
          const r = await g.emit<{ token: string }>('join', name);
          if (!r.ok) return show(r.error);
          writeToken(code, r.result.token);
          setToken(r.result.token);
        }}
      />
    );
  } else if (s.phase === 'lobby') {
    body = <Lobby state={s} token={token!} code={code} emit={g.emit} toast={show} />;
  } else {
    body = <InGame state={s} emit={g.emit} serverNow={g.serverNow} toast={show} />;
  }

  return (
    <div style={{ minHeight: '100%', maxWidth: 520, margin: '0 auto', padding: '16px 16px 120px', position: 'relative' }}>
      <div style={{ position: 'fixed', inset: 0, zIndex: -1 }}><Shapes count={14} seed={4} opacity={0.35} /></div>
      <Offline connected={g.connected} />
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 14 }}>
        <Wordmark size={18} />
        <span className="pill" style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.game.name}</span>
      </div>
      {body}
      {toast}
    </div>
  );
}

function JoinForm({ onJoin, full }: { onJoin: (name: string) => void; full: boolean }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="stack fadeup" style={{ marginTop: 30 }}>
      <h1 style={{ fontSize: 34, margin: 0, lineHeight: 1.1 }}>
        Ready to <span className="accent">play?</span>
      </h1>
      <p className="muted" style={{ margin: 0 }}>One device per team. Pick a name, snap a team photo and you're in.</p>
      {full ? (
        <div className="panel">Joining is closed right now. Ask the host to open it.</div>
      ) : (
        <form
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            await onJoin(name);
            setBusy(false);
          }}
        >
          <label className="field">
            Team name
            <input className="input" value={name} maxLength={30} onChange={(e) => setName(e.target.value)} placeholder="The Vinyl Vandals" autoFocus />
          </label>
          <button className="btn big" disabled={busy || !name.trim()}>Join the game</button>
        </form>
      )}
    </div>
  );
}

async function resizeImage(file: File, max = 640): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    // square crop from the center so it looks good in round avatars
    const side = Math.min(img.width, img.height);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = Math.min(max, side);
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.82);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function Lobby({ state, token, code, emit, toast }: { state: PlayerState; token: string; code: string; emit: ReturnType<typeof useGameSocket>['emit']; toast: (m: string) => void }) {
  const me = state.me!;
  const [name, setName] = useState(me.name);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onPhoto(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    try {
      const dataUrl = await resizeImage(file);
      const res = await fetch(`/api/photo/${code}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-team-token': token },
        body: JSON.stringify({ dataUrl }),
      });
      if (!res.ok) toast((await res.json().catch(() => ({}))).error ?? 'Upload failed');
    } catch {
      toast('Could not read that photo. Try again.');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div className="stack fadeup">
      <div className="panel center stack" style={{ padding: 24 }}>
        <TeamCard team={me} width={260} />
        <input ref={fileRef} type="file" accept="image/*" capture="user" hidden onChange={(e) => onPhoto(e.target.files?.[0])} />
        <button className="btn yellow" onClick={() => fileRef.current?.click()} disabled={uploading}>
          {uploading ? 'Uploading…' : me.photoVersion ? 'Retake team photo' : 'Take team photo'}
        </button>
        <span className="muted" style={{ fontSize: 14 }}>{me.photoVersion ? 'This is your team card on the big screen.' : 'Squeeze the whole team in! It becomes your team card on the big screen.'}</span>
      </div>
      <form
        className="panel stack"
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await emit('rename', name);
          toast(r.ok ? 'Team name saved' : r.error);
        }}
      >
        <label className="field">
          Team name
          <input className="input" value={name} maxLength={30} onChange={(e) => setName(e.target.value)} />
        </label>
        <button className="btn secondary" disabled={!name.trim() || name.trim() === me.name}>Save name</button>
      </form>
      <div className="panel center" style={{ padding: 22 }}>
        <Vinyl size={70} spinning />
        <p style={{ margin: '12px 0 0', fontWeight: 700 }}>You're in! Waiting for the show to start…</p>
        <p className="muted" style={{ margin: '4px 0 0', fontSize: 14 }}>{state.teams.length} team{state.teams.length === 1 ? '' : 's'} joined</p>
      </div>
    </div>
  );
}

function Header({ state }: { state: PlayerState }) {
  const me = state.me!;
  return (
    <div className="panel row" style={{ padding: 12 }}>
      <Avatar team={me} size={52} />
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="row" style={{ gap: 0, minWidth: 0 }}>
          <span style={{ fontWeight: 800, fontSize: 18, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{me.name}</span>
          <Medals wins={me.wins} size={20} />
        </div>
        <div className="muted" style={{ fontSize: 13 }}>
          {me.timeline.length}/{state.settings.targetCards} cards · <b style={{ color: 'var(--yellow)' }}>{me.points} pts</b>
        </div>
      </div>
      <span className="pill" style={{ textAlign: 'center', lineHeight: 1.2 }}>
        {state.stage.name}
        {state.round ? (state.round.kind === 'bonus' ? ' · Bonus' : ` · Song ${state.round.index}`) : ''}
      </span>
    </div>
  );
}

function InGame({ state, emit, serverNow, toast }: { state: PlayerState; emit: ReturnType<typeof useGameSocket>['emit']; serverNow: () => number; toast: (m: string) => void }) {
  const me = state.me!;
  const r = state.round;
  const playing = state.phase === 'playing' && r;
  const participant = !!r && r.participants.includes(me.id);

  return (
    <div className="stack">
      <Header state={state} />
      {state.phase === 'intro' && <Notice title="Get ready!" text="Watch the big screen for how it works." vinyl />}
      {state.phase === 'ready' && (participant ? <Notice title="Next song coming up…" text="Listen carefully!" vinyl /> : <BonusWatch state={state} />)}
      {playing && participant && <AnswerForm key={r.index} state={state} emit={emit} serverNow={serverNow} toast={toast} />}
      {playing && !participant && <BonusWatch state={state} />}
      {state.phase === 'answers' && <Notice title="Time's up!" text="Look at the big screen…" />}
      {state.phase === 'reveal' && <MyResult state={state} />}
      {state.phase === 'finished' && <Finished state={state} />}
      {state.phase === 'stageIntro' && (
        <Notice title={`${state.stage.name} starts!`} text={`Fresh timeline for everyone. First to ${state.settings.targetCards} cards wins +${state.settings.winBonus} points.`} vinyl />
      )}
      {state.phase === 'stageEnd' && <StageWon state={state} />}
      {state.phase === 'scoreboard' && state.pendingBonus.length > 0 && (
        <Notice
          title={state.pendingBonus.includes(me.id) ? "It's a tie, you're in the bonus round!" : 'Bonus round coming up'}
          text={state.pendingBonus.includes(me.id) ? 'Guess the exact year. Closest wins.' : 'Cheer for your favourite.'}
        />
      )}
      {!playing && (
        <div className="panel stack">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div style={{ fontWeight: 800 }}>Your timeline</div>
            <span className="pill">{me.timeline.length}/{state.settings.targetCards}</span>
          </div>
          <div className="tl">
            {me.timeline.map((c, i) => (
              <TimelineRow key={i} card={c} highlight={!!r?.song && c.songId !== null && c.title === r.song.title && c.year === r.song.year && state.phase === 'scoreboard'} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Notice({ title, text, vinyl }: { title: string; text?: string; vinyl?: boolean }) {
  return (
    <div className="panel center fadeup" style={{ padding: 24 }}>
      {vinyl && <div style={{ marginBottom: 12 }}><Vinyl size={90} spinning /></div>}
      <div style={{ fontWeight: 800, fontSize: 20 }}>{title}</div>
      {text && <div className="muted" style={{ marginTop: 4 }}>{text}</div>}
    </div>
  );
}

function BonusWatch({ state }: { state: PlayerState }) {
  const names = state.teams.filter((t) => state.round?.participants.includes(t.id)).map((t) => t.name);
  return <Notice title="Bonus round!" text={`${names.join(' vs ')} battle it out. Sit back and enjoy.`} vinyl />;
}

// ---------------- answering ----------------

function Draggable({ children }: { children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: 'mystery' });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={{
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        touchAction: 'none',
        zIndex: isDragging ? 50 : undefined,
        position: 'relative',
        cursor: 'grab',
      }}
    >
      {children}
    </div>
  );
}

function MysteryCard() {
  return (
    <div className="tl-row" style={{ cursor: 'grab' }}>
      <div className="tl-dot" style={{ background: 'var(--pink)', boxShadow: '0 0 0 5px rgba(255,106,77,0.3)' }} />
      <GiftCard mystery width={104} style={{ boxShadow: '0 10px 26px rgba(255,90,74,0.55)' }} />
      <div className="tl-info"><b>This song</b><span>Drag me to the right spot</span></div>
    </div>
  );
}

function Slot({ index, active, filled, onTap }: { index: number; active: boolean; filled: boolean; onTap: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: `slot-${index}` });
  if (filled) {
    return (
      <div ref={setNodeRef}>
        <Draggable>
          <MysteryCard />
        </Draggable>
      </div>
    );
  }
  return (
    <div ref={setNodeRef} onClick={onTap} className={`tl-slot${active ? ' big' : ''}${isOver ? ' over' : ''}`}>
      {active ? (isOver ? 'Drop it here!' : 'drop here') : ''}
    </div>
  );
}

function AnswerForm({ state, emit, serverNow, toast }: { state: PlayerState; emit: ReturnType<typeof useGameSocket>['emit']; serverNow: () => number; toast: (m: string) => void }) {
  const r = state.round!;
  const me = state.me!;
  const bonus = r.kind === 'bonus';
  const initial = state.myAnswer;
  const [position, setPosition] = useState<number | null>(initial?.position ?? null);
  const [yearGuess, setYearGuess] = useState<string>(initial?.yearGuess ? String(initial.yearGuess) : '');
  const [artist, setArtist] = useState(initial?.artist ?? '');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [dragging, setDragging] = useState(false);
  const locked = !!state.myAnswer?.confirmed;
  const left = useCountdown(r.endsAt, serverNow) ?? 0;
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const timeline: TimelineCard[] = me.timeline;

  // send drafts so an unconfirmed answer still counts when time runs out
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sendDraft = (patch: Record<string, unknown>, delay = 350) => {
    if (locked) return;
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => emit('answer', { answer: patch }), delay);
  };
  const current = () => ({ position, artist, title, yearGuess: yearGuess ? Number(yearGuess) : null });

  function place(p: number | null) {
    setPosition(p);
    sendDraft({ ...current(), position: p }, 0);
  }

  function onDragEnd(e: DragEndEvent) {
    setDragging(false);
    const over = e.over?.id;
    if (typeof over === 'string' && over.startsWith('slot-')) place(Number(over.slice(5)));
  }

  async function confirm() {
    if (draftTimer.current) clearTimeout(draftTimer.current);
    const res = await emit('answer', { answer: current(), confirm: true });
    if (!res.ok) toast(res.error);
  }

  if (locked) {
    const a = state.myAnswer!;
    return (
      <div className="stack">
        <div className="panel center" style={{ padding: 22 }}>
          <Ring seconds={left} total={state.settings.roundSeconds} size={90} />
          <div style={{ fontWeight: 800, fontSize: 22, marginTop: 10 }}>Locked in! 🔒</div>
          <div className="muted" style={{ marginTop: 6 }}>
            {bonus ? `Year: ${a.yearGuess}` : placementText(timeline.map((c) => c.year), a.position)}
            <br />
            {a.artist || '–'} · {a.title || '–'}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="panel row" style={{ padding: 12 }}>
        <Ring seconds={left} total={state.settings.roundSeconds} size={64} />
        <div className="grow">
          <div style={{ fontWeight: 800 }}>{bonus ? 'Bonus: guess the exact year' : 'Where does this song fit?'}</div>
          <div className="muted" style={{ fontSize: 13 }}>{bonus ? 'Closest year wins.' : 'Drag the orange card into your timeline.'}</div>
        </div>
      </div>

      {bonus ? (
        <label className="field panel">
          Year
          <input
            className="input"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={4}
            value={yearGuess}
            style={{ fontSize: 28, fontWeight: 800, textAlign: 'center' }}
            placeholder="19??"
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, '').slice(0, 4);
              setYearGuess(v);
              if (v.length === 4) sendDraft({ ...current(), yearGuess: Number(v) });
            }}
          />
        </label>
      ) : (
        <DndContext sensors={sensors} onDragStart={() => setDragging(true)} onDragEnd={onDragEnd} onDragCancel={() => setDragging(false)}>
          <div className="panel stack" style={{ gap: 8 }}>
            {position === null && (
              <div style={{ marginBottom: 8, paddingLeft: 26 }}>
                <Draggable>
                  <MysteryCard />
                </Draggable>
              </div>
            )}
            <div className="tl">
              <div className="muted" style={{ fontSize: 12, fontWeight: 600 }}>▲ older</div>
              {Array.from({ length: timeline.length + 1 }).map((_, i) => (
                <div key={i} style={{ display: 'grid', gap: 10 }}>
                  <Slot index={i} active={dragging || position === null} filled={position === i} onTap={() => place(i)} />
                  {i < timeline.length && <TimelineRow card={timeline[i]} />}
                </div>
              ))}
              <div className="muted" style={{ fontSize: 12, fontWeight: 600 }}>▼ newer</div>
            </div>
            <div className="muted" style={{ fontSize: 12, textAlign: 'center' }}>Tip: you can also tap a dashed spot.</div>
          </div>
        </DndContext>
      )}

      <div className="panel stack">
        <label className="field">
          <span>Artist <span style={{ fontWeight: 500 }}>(+100)</span></span>
          <input className="input" value={artist} maxLength={80} autoComplete="off" onChange={(e) => { setArtist(e.target.value); sendDraft({ ...current(), artist: e.target.value }); }} />
        </label>
        <label className="field">
          <span>Title <span style={{ fontWeight: 500 }}>(+100)</span></span>
          <input className="input" value={title} maxLength={80} autoComplete="off" onChange={(e) => { setTitle(e.target.value); sendDraft({ ...current(), title: e.target.value }); }} />
        </label>
      </div>

      <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, padding: 16, background: 'linear-gradient(transparent, var(--navy) 35%)' }}>
        <div style={{ maxWidth: 520, margin: '0 auto' }}>
          <button className="btn mint big" style={{ width: '100%' }} disabled={bonus ? yearGuess.length !== 4 : position === null} onClick={confirm}>
            Confirm answer
          </button>
        </div>
      </div>
    </div>
  );
}

function placementText(years: number[], p: number | null) {
  if (p === null) return 'No spot chosen';
  if (years.length === 0) return 'Placed';
  if (p === 0) return `Before ${years[0]}`;
  if (p >= years.length) return `After ${years[years.length - 1]}`;
  return `Between ${years[p - 1]} and ${years[p]}`;
}

function MyResult({ state }: { state: PlayerState }) {
  const r = state.round!;
  const me = state.me!;
  const song = r.song;
  if (!r.participants.includes(me.id) || !song) return <Notice title="Answer revealed" text="Check the big screen!" />;
  const j = r.judgments?.[me.id];
  const placed = r.placementCorrect?.[me.id];
  const a = r.answers?.[me.id];
  const mark = (v: boolean | null | undefined) => (v === true ? <span className="pill ok">+100</span> : v === false ? <span className="pill bad">✗</span> : <span className="pill">judging…</span>);
  return (
    <div className="panel stack fadeup">
      <div className="row">
        <GiftCard year={song.year} cover={song.coverUrl} width={130} className="pop" />
        <div>
          <div style={{ fontWeight: 800, fontSize: 30 }}>{song.year}</div>
          <div style={{ fontWeight: 700 }}>{song.title}</div>
          <div className="muted">{song.artist}</div>
        </div>
      </div>
      {r.kind === 'normal' ? (
        <div className={`pill ${placed ? 'ok' : 'bad'}`} style={{ justifyContent: 'center', padding: 10, fontSize: 15 }}>
          {placed ? '✓ Right spot! The card joins your timeline' : a ? '✗ Wrong spot this time' : '✗ No answer'}
        </div>
      ) : (
        <div className="pill" style={{ justifyContent: 'center', padding: 10, fontSize: 15 }}>
          Your guess: {a?.yearGuess ?? '–'} ({a?.yearGuess ? `${Math.abs(a.yearGuess - (song.year ?? 0))} off` : 'no answer'})
        </div>
      )}
      <div className="row" style={{ justifyContent: 'space-between' }}><span>Artist: <b>{a?.artist || '–'}</b></span>{mark(j?.artist)}</div>
      <div className="row" style={{ justifyContent: 'space-between' }}><span>Title: <b>{a?.title || '–'}</b></span>{mark(j?.title)}</div>
    </div>
  );
}

function StageWon({ state }: { state: PlayerState }) {
  const winner = state.teams.find((t) => t.id === state.outcome?.winnerId);
  const mine = winner?.id === state.me?.id;
  return (
    <div className="panel center stack pop" style={{ padding: 28 }}>
      <Medals wins={[state.stage.index + 1]} size={84} />
      <div style={{ fontWeight: 800, fontSize: 24 }}>{mine ? `You won ${state.stage.name}!` : `${winner?.name ?? 'Someone'} wins ${state.stage.name}`}</div>
      <div className="muted">{mine ? `+${state.settings.winBonus} points for your team.` : state.outcome?.message}</div>
    </div>
  );
}

function Finished({ state }: { state: PlayerState }) {
  const ranked = [...state.teams].sort((a, b) => b.points - a.points || b.wins.length - a.wins.length);
  const myRank = ranked.findIndex((t) => t.id === state.me?.id) + 1;
  const winner = ranked[0];
  const mine = winner?.id === state.me?.id;
  return (
    <div className="panel center stack pop" style={{ padding: 28 }}>
      <div style={{ fontSize: 56 }}>{mine ? '🏆' : '🎉'}</div>
      <div style={{ fontWeight: 800, fontSize: 26 }}>{mine ? 'You won the night!' : `${winner?.name ?? 'Someone'} wins the night!`}</div>
      <div className="muted">You finished #{myRank} with {state.me?.points ?? 0} points.</div>
    </div>
  );
}
