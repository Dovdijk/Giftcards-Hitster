import { useEffect, useMemo, useRef, useState } from 'react';
import type { AdminState, Song, TeamPublic } from '../../../shared/types';
import { useCountdown, useGameSocket } from '../socket';
import { Avatar, Offline, Ring, Wordmark, useToast } from '../components/common';
import { Link, useParams } from 'react-router-dom';
import { SpotifyPlayer, type PlayerHandle, type PlaybackInfo } from '../components/SpotifyPlayer';

type Emit = ReturnType<typeof useGameSocket>['emit'];

export default function Admin() {
  const gameId = useParams().gameId ?? '';
  const auth = useMemo(() => ({ role: 'admin', gameId }), [gameId]);
  const g = useGameSocket<AdminState>(auth);

  if (g.authError)
    return (
      <div className="center stack" style={{ height: '100%' }}>
        <Wordmark />
        <div style={{ fontWeight: 800, fontSize: 22 }}>{g.authError}</div>
        <Link className="btn" to="/host">Go to my games</Link>
      </div>
    );
  if (!g.state) return <div className="center" style={{ height: '100%' }}>Connecting…</div>;
  return <Dashboard s={g.state} emit={g.emit} serverNow={g.serverNow} connected={g.connected} socket={g.socket} />;
}

type Tab = 'game' | 'songs' | 'teams' | 'settings';

function Dashboard({ s, emit, serverNow, connected, socket }: { s: AdminState; emit: Emit; serverNow: () => number; connected: boolean; socket: React.RefObject<any> }) {
  const [tab, setTab] = useState<Tab>('game');
  const { toast, show } = useToast();
  const act = async (type: string, extra: Record<string, unknown> = {}) => {
    const r = await emit('admin', { type, ...extra });
    if (!r.ok) show(r.error);
    return r;
  };
  const needsCheck = s.songs.filter((x) => x.needsCheck && !x.used).length;

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto', padding: 20 }}>
      <Offline connected={connected} />
      <div className="row wrap" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
        <div className="row" style={{ gap: 14 }}>
          <Link to="/host" className="btn small ghost">← My games</Link>
          <div>
            <div style={{ fontWeight: 800, fontSize: 20 }}>{s.game.name}</div>
            <div className="muted" style={{ fontSize: 13 }}>Game code <b style={{ color: 'var(--yellow)', letterSpacing: '0.1em' }}>{s.game.code}</b> · players join at {window.location.host}/join/{s.game.code}</div>
          </div>
        </div>
        <div className="row">
          {(['game', 'songs', 'teams', 'settings'] as Tab[]).map((t) => (
            <button key={t} className={`btn small ${tab === t ? '' : 'secondary'}`} onClick={() => setTab(t)}>
              {t === 'game' ? 'Game' : t === 'songs' ? `Songs (${s.songs.length})${needsCheck ? ' ⚠' : ''}` : t === 'teams' ? `Teams (${s.teams.length})` : 'Settings'}
            </button>
          ))}
          <a className="btn small ghost" href={`/show/${s.game.code}`} target="_blank" rel="noreferrer">Open show screen ↗</a>
        </div>
      </div>
      {/* The player stays mounted on every tab so the music never stops when switching. */}
      <Control s={s} act={act} serverNow={serverNow} show={show} visible={tab === 'game'} />
      {tab === 'songs' && <Songs s={s} act={act} socket={socket} show={show} />}
      {tab === 'teams' && <Teams s={s} act={act} />}
      {tab === 'settings' && <SettingsTab s={s} act={act} />}
      {toast}
    </div>
  );
}

const phaseLabel: Record<string, string> = {
  lobby: 'Lobby: teams are joining', intro: 'Showing the explanation', ready: 'Song loaded, press play', playing: 'Teams are answering',
  answers: 'Showing team answers', reveal: 'Answer revealed: judge artist & title', scoreboard: 'Scoreboard', finished: 'We have a winner!',
};

function Control({ s, act, serverNow, show, visible }: { s: AdminState; act: (t: string, e?: Record<string, unknown>) => Promise<any>; serverNow: () => number; show: (m: string) => void; visible: boolean }) {
  const r = s.round;
  const song = s.songs.find((x) => x.id === s.currentSongId) ?? null;
  const player = useRef<PlayerHandle>(null);
  const startedFor = useRef<number | null>(null);
  const [preview, setPreview] = useState(false);
  const [pb, setPb] = useState<PlaybackInfo | null>(null);
  const left = useCountdown(s.phase === 'playing' ? r?.endsAt : null, serverNow);

  // pressing play in the Spotify player itself also starts the timer
  const onPlayback = (p: PlaybackInfo) => {
    setPb(p);
    if (p.duration > 0) setPreview(p.duration <= 31000);
    if (p.playing && s.phase === 'ready' && r && startedFor.current !== r.index) {
      startedFor.current = r.index;
      act('startRound');
    }
  };
  // keep the latest phase available to the listener
  const phaseRef = useRef(s.phase);
  phaseRef.current = s.phase;

  async function playAndStart() {
    if (!r) return;
    player.current?.play();
    startedFor.current = r.index;
    await act('startRound');
    setTimeout(() => {
      if (phaseRef.current === 'playing' && pbRef.current && !pbRef.current.playing) show('Music not playing? Click the green play button in the Spotify player.');
    }, 2500);
  }
  const pbRef = useRef(pb);
  pbRef.current = pb;

  const players = s.teams.filter((t) => r?.participants.includes(t.id));
  const nextLabel = s.pendingBonus.length ? '⭐ Start bonus round' : s.phase === 'intro' ? '▶ Load first song' : '▶ Load next song';

  return (
    <div style={{ display: visible ? 'grid' : 'none', gridTemplateColumns: '380px 1fr', gap: 20, alignItems: 'start' }}>
      <div className="stack" style={{ position: 'sticky', top: 20 }}>
        <div className="panel stack">
          <div className="muted" style={{ fontSize: 13, fontWeight: 700 }}>STATUS</div>
          <div style={{ fontWeight: 800, fontSize: 20 }}>{phaseLabel[s.phase]}</div>
          {r && <div className="muted">{r.kind === 'bonus' ? 'Bonus round' : `Round ${r.index}`} · {s.songsLeft} songs left</div>}
          {s.outcome?.message && <div className="pill warn" style={{ whiteSpace: 'normal' }}>{s.outcome.message}</div>}
          {s.phase === 'playing' && left !== null && (
            <div className="row"><Ring seconds={left} total={s.settings.roundSeconds} size={80} /><div className="muted">{r?.confirmedTeamIds.length}/{players.length} locked in</div></div>
          )}

          <div className="stack" style={{ gap: 8 }}>
            {s.phase === 'lobby' && <button className="btn big" onClick={() => act('startShow')} disabled={!s.teams.length}>Start show ({s.teams.length} teams)</button>}
            {(s.phase === 'intro' || s.phase === 'scoreboard') && <button className="btn big" onClick={() => act('nextSong')}>{nextLabel}</button>}
            {s.phase === 'ready' && (
              <>
                <button className="btn mint big" onClick={playAndStart}>▶ Play & start timer</button>
                <button className="btn small secondary" onClick={() => act('startRound')}>Start timer only</button>
              </>
            )}
            {s.phase === 'playing' && (
              <div className="row">
                <button className="btn secondary grow" onClick={() => act('addTime', { seconds: 15 })}>+15 sec</button>
                <button className="btn danger grow" onClick={() => act('endRound')}>Stop now</button>
              </div>
            )}
            {s.phase === 'answers' && <button className="btn big yellow" onClick={() => act('reveal')}>Reveal answer now</button>}
            {s.phase === 'reveal' && <button className="btn big" onClick={() => act('commit')}>Done judging → scoreboard</button>}
            {s.phase === 'finished' && <button className="btn danger" onClick={() => confirm('Reset the game? Teams and songs stay, scores and timelines are cleared.') && act('resetGame')}>New game (keep teams & songs)</button>}
            {['intro', 'ready'].includes(s.phase) && <button className="btn small ghost" onClick={() => act('scoreboard')}>Show scoreboard</button>}
            {['scoreboard', 'ready'].includes(s.phase) && <button className="btn small ghost" onClick={() => act('showIntro')}>Show explanation again</button>}
          </div>
        </div>

        <div className="panel stack" style={{ display: song ? 'grid' : 'none' }}>
          <div className="muted" style={{ fontSize: 13, fontWeight: 700 }}>NOW PLAYING (only you see this)</div>
          {song && (
            <div className="row">
              {song.coverUrl && <img src={song.coverUrl} alt="" style={{ width: 56, height: 56, borderRadius: 8 }} />}
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 800 }}>{song.title}</div>
                <div className="muted">{song.artist} · <b style={{ color: 'var(--yellow)' }}>{song.year}</b></div>
              </div>
            </div>
          )}
        </div>
        <div style={{ display: song ? 'block' : 'none' }}>
          <SpotifyPlayer ref={player} trackId={song?.spotifyId ?? null} onPlayback={onPlayback} />
          {preview && <div className="pill warn" style={{ marginTop: 6, whiteSpace: 'normal' }}>Preview mode (30 sec). Log in to Spotify Premium in this browser for full songs.</div>}
        </div>
        {s.phase === 'ready' && <NextSongPicker s={s} act={act} />}
      </div>

      <div className="stack">
        {s.phase === 'lobby' && <LobbyTeams teams={s.teams} />}
        {r && ['playing', 'answers', 'reveal'].includes(s.phase) && <JudgeTable s={s} act={act} />}
        {['intro', 'scoreboard', 'finished', 'ready'].includes(s.phase) && <MiniScoreboard s={s} />}
      </div>
    </div>
  );
}

function NextSongPicker({ s, act }: { s: AdminState; act: (t: string, e?: Record<string, unknown>) => Promise<any> }) {
  const options = s.songs.filter((x) => !x.used && x.year !== null);
  return (
    <div className="panel stack">
      <div className="muted" style={{ fontSize: 13, fontWeight: 700 }}>SWAP SONG</div>
      <select className="input" value="" onChange={(e) => e.target.value && act('nextSong', { songId: e.target.value })}>
        <option value="">Pick another song…</option>
        {options.map((x) => <option key={x.id} value={x.id}>{x.bonus ? '⭐ ' : ''}{x.title} – {x.artist} ({x.year})</option>)}
      </select>
    </div>
  );
}

function LobbyTeams({ teams }: { teams: TeamPublic[] }) {
  return (
    <div className="panel">
      <div style={{ fontWeight: 800, marginBottom: 12 }}>Teams joined</div>
      {!teams.length && <div className="muted">Nobody yet. Open the show screen: it has a QR code to join.</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 14 }}>
        {teams.map((t) => (
          <div key={t.id} className="center" style={{ gap: 6 }}>
            <Avatar team={t} size={72} />
            <div style={{ fontWeight: 700 }}>{t.name}</div>
            <span className={`pill ${t.connected ? 'ok' : 'bad'}`}>{t.connected ? 'online' : 'offline'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function placement(years: number[] | undefined, p: number | null | undefined) {
  if (!years || p === null || p === undefined) return '–';
  if (p === 0) return `before ${years[0]}`;
  if (p >= years.length) return `after ${years[years.length - 1]}`;
  return `${years[p - 1]}–${years[p]}`;
}

function JudgeTable({ s, act }: { s: AdminState; act: (t: string, e?: Record<string, unknown>) => Promise<any> }) {
  const r = s.round!;
  const song = r.song;
  const judging = s.phase === 'reveal' || s.phase === 'answers';
  const players = s.teams.filter((t) => r.participants.includes(t.id));
  const Toggle = ({ teamId, field, value }: { teamId: string; field: 'artist' | 'title'; value: boolean | null | undefined }) => (
    <div className="row" style={{ gap: 4 }}>
      <button className={`btn small ${value === true ? 'mint' : 'secondary'}`} disabled={!judging} onClick={() => act('judge', { teamId, field, value: value === true ? null : true })}>✓</button>
      <button className={`btn small ${value === false ? 'danger' : 'secondary'}`} disabled={!judging} onClick={() => act('judge', { teamId, field, value: value === false ? null : false })}>✗</button>
    </div>
  );
  return (
    <div className="panel">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ fontWeight: 800 }}>Answers {s.phase === 'playing' && <span className="muted">(live)</span>}</div>
        {song && <div className="muted">Correct: <b style={{ color: '#fff' }}>{song.artist}</b> – <b style={{ color: '#fff' }}>{song.title}</b> ({song.year})</div>}
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr className="muted" style={{ fontSize: 12, textAlign: 'left' }}>
            <th style={{ padding: 6 }}>Team</th>
            <th>{r.kind === 'bonus' ? 'Year guess' : 'Timeline spot'}</th>
            <th>Artist</th><th></th><th>Title</th><th></th>
          </tr>
        </thead>
        <tbody>
          {players.map((t) => {
            const a = r.answers?.[t.id];
            const j = r.judgments?.[t.id];
            const ok = r.placementCorrect?.[t.id];
            return (
              <tr key={t.id} style={{ borderTop: '1px solid var(--line)' }}>
                <td style={{ padding: 8 }}>
                  <div className="row" style={{ gap: 8 }}>
                    <Avatar team={t} size={34} />
                    <div>
                      <div style={{ fontWeight: 700 }}>{t.name}</div>
                      {a?.confirmed ? <span className="pill ok">locked</span> : a ? <span className="pill warn">draft</span> : <span className="pill">no answer</span>}
                    </div>
                  </div>
                </td>
                <td>
                  {r.kind === 'bonus' ? (
                    <b>{a?.yearGuess ?? '–'}{song?.year && a?.yearGuess ? <span className="muted"> ({Math.abs(a.yearGuess - song.year)} off)</span> : null}</b>
                  ) : (
                    <div className="row" style={{ gap: 6 }}>
                      <b>{placement(r.timelineYears?.[t.id], a?.position)}</b>
                      {judging && (
                        <button className={`btn small ${ok ? 'mint' : 'danger'}`} title="Click to override" onClick={() => act('placement', { teamId: t.id, value: !ok })}>
                          {ok ? '✓' : '✗'}
                        </button>
                      )}
                    </div>
                  )}
                </td>
                <td style={{ maxWidth: 200 }}>{a?.artist || <span className="muted">–</span>}</td>
                <td><Toggle teamId={t.id} field="artist" value={j?.artist} /></td>
                <td style={{ maxWidth: 200 }}>{a?.title || <span className="muted">–</span>}</td>
                <td><Toggle teamId={t.id} field="title" value={j?.title} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function MiniScoreboard({ s }: { s: AdminState }) {
  const ranked = [...s.teams].sort((a, b) => b.timeline.length - a.timeline.length || b.points - a.points);
  return (
    <div className="panel">
      <div style={{ fontWeight: 800, marginBottom: 10 }}>Standings</div>
      <div className="stack" style={{ gap: 8 }}>
        {ranked.map((t, i) => (
          <div key={t.id} className="row" style={{ gap: 10 }}>
            <b style={{ width: 24 }}>{i + 1}</b>
            <Avatar team={t} size={32} />
            <div className="grow" style={{ fontWeight: 700 }}>{t.name} {!t.connected && <span className="pill bad">offline</span>}</div>
            <div className="muted" style={{ fontSize: 13 }}>{t.timeline.map((c) => c.year).join(' · ')}</div>
            <b style={{ width: 110, textAlign: 'right' }}>{t.timeline.length}/{s.settings.targetCards} · {t.points}</b>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------- songs ----------------

function Songs({ s, act, socket, show }: { s: AdminState; act: (t: string, e?: Record<string, unknown>) => Promise<any>; socket: React.RefObject<any>; show: (m: string) => void }) {
  const [text, setText] = useState('');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [manual, setManual] = useState({ title: '', artist: '', year: '', spotifyUrl: '' });
  const [filter, setFilter] = useState<'all' | 'check' | 'bonus'>('all');

  useEffect(() => {
    const sock = socket.current;
    if (!sock) return;
    const h = (p: { done: number; total: number } | null) => setProgress(p);
    sock.on('importProgress', h);
    return () => sock.off('importProgress', h);
  }, [socket]);

  const list = s.songs.filter((x) => (filter === 'check' ? x.needsCheck : filter === 'bonus' ? x.bonus : true));
  const unused = s.songs.filter((x) => !x.used);

  return (
    <div className="stack">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <div className="panel stack">
          <div style={{ fontWeight: 800 }}>Add songs from Spotify</div>
          <div className="muted" style={{ fontSize: 14 }}>
            Paste one or more Spotify track links. Tip: open a playlist in the Spotify desktop app, click a song, press Ctrl+A then Ctrl+C, and paste everything here.
          </div>
          <textarea className="input" rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder="https://open.spotify.com/track/…" />
          <div className="row">
            <button
              className="btn"
              disabled={!text.trim() || !!progress}
              onClick={async () => {
                const r = await act('importSongs', { text });
                if (r.ok) {
                  setText('');
                  show(`Importing ${r.result.queued} song(s)${r.result.skipped ? `, ${r.result.skipped} already in the list` : ''}`);
                }
              }}
            >
              Add songs
            </button>
            {progress && <span className="pill warn">Looking up {progress.done}/{progress.total}… (about 2 sec per song)</span>}
          </div>
        </div>
        <form
          className="panel stack"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await act('addSong', { song: { ...manual, year: manual.year ? Number(manual.year) : null } });
            if (r.ok) setManual({ title: '', artist: '', year: '', spotifyUrl: '' });
          }}
        >
          <div style={{ fontWeight: 800 }}>Add a song manually</div>
          <div className="row">
            <input className="input" placeholder="Title" value={manual.title} onChange={(e) => setManual({ ...manual, title: e.target.value })} />
            <input className="input" placeholder="Artist" value={manual.artist} onChange={(e) => setManual({ ...manual, artist: e.target.value })} />
          </div>
          <div className="row">
            <input className="input" placeholder="Year" inputMode="numeric" style={{ width: 110 }} value={manual.year} onChange={(e) => setManual({ ...manual, year: e.target.value.replace(/\D/g, '').slice(0, 4) })} />
            <input className="input" placeholder="Spotify link (optional)" value={manual.spotifyUrl} onChange={(e) => setManual({ ...manual, spotifyUrl: e.target.value })} />
          </div>
          <button className="btn secondary" disabled={!manual.title.trim()}>Add</button>
        </form>
      </div>

      <div className="panel">
        <div className="row wrap" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
          <div className="row">
            <b>{s.songs.length} songs</b>
            <span className="muted">· {unused.length} not played · {s.songs.filter((x) => x.bonus).length} bonus</span>
          </div>
          <div className="row">
            {(['all', 'check', 'bonus'] as const).map((f) => (
              <button key={f} className={`btn small ${filter === f ? '' : 'secondary'}`} onClick={() => setFilter(f)}>
                {f === 'all' ? 'All' : f === 'check' ? `Check year (${s.songs.filter((x) => x.needsCheck).length})` : 'Bonus'}
              </button>
            ))}
            <button className="btn small ghost" onClick={() => act('shuffleSongs')}>Shuffle unplayed</button>
          </div>
        </div>
        <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>
          Songs play top to bottom. ⭐ bonus songs are only used for tie-breaker rounds. Check the year: Spotify sometimes shows the remaster year; MusicBrainz usually has the original.
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            {list.map((x) => <SongRow key={x.id} song={x} act={act} index={s.songs.indexOf(x)} />)}
          </tbody>
        </table>
        {!s.songs.length && <div className="muted" style={{ padding: 20, textAlign: 'center' }}>No songs yet.</div>}
      </div>
    </div>
  );
}

function SongRow({ song, act, index }: { song: Song; act: (t: string, e?: Record<string, unknown>) => Promise<any>; index: number }) {
  const [year, setYear] = useState(song.year ? String(song.year) : '');
  const [title, setTitle] = useState(song.title);
  const [artist, setArtist] = useState(song.artist);
  useEffect(() => setYear(song.year ? String(song.year) : ''), [song.year]);
  useEffect(() => setTitle(song.title), [song.title]);
  useEffect(() => setArtist(song.artist), [song.artist]);
  const save = (patch: Partial<Song>) => act('updateSong', { songId: song.id, patch });
  return (
    <tr style={{ borderTop: '1px solid var(--line)', opacity: song.used ? 0.45 : 1 }}>
      <td style={{ padding: 6, width: 30 }} className="muted">{index + 1}</td>
      <td style={{ width: 52 }}>{song.coverUrl ? <img src={song.coverUrl} alt="" style={{ width: 44, height: 44, borderRadius: 6 }} /> : <div style={{ width: 44, height: 44, borderRadius: 6, background: 'var(--card-strong)' }} />}</td>
      <td><input className="input" style={{ padding: '6px 10px' }} value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => title !== song.title && save({ title })} /></td>
      <td><input className="input" style={{ padding: '6px 10px' }} value={artist} onChange={(e) => setArtist(e.target.value)} onBlur={() => artist !== song.artist && save({ artist })} /></td>
      <td style={{ width: 90 }}>
        <input
          className="input" inputMode="numeric" style={{ padding: '6px 10px', fontWeight: 800, borderColor: song.needsCheck ? 'var(--yellow)' : undefined }}
          value={year} placeholder="year"
          onChange={(e) => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))}
          onBlur={() => year.length === 4 && Number(year) !== song.year && save({ year: Number(year) })}
        />
      </td>
      <td style={{ fontSize: 12, width: 150 }} className="muted">
        {song.spotifyYear && <div>Spotify: {song.spotifyYear}</div>}
        {song.musicbrainzYear && <div>MusicBrainz: {song.musicbrainzYear}</div>}
        {song.needsCheck && <button className="btn small yellow" style={{ marginTop: 2 }} onClick={() => save({ needsCheck: false, year: song.year })} disabled={!song.year}>Year OK</button>}
      </td>
      <td style={{ width: 230 }}>
        <div className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
          {song.used && <span className="pill">played</span>}
          {song.spotifyUrl && <a className="btn small ghost" href={song.spotifyUrl} target="_blank" rel="noreferrer" title="Open in Spotify">♪</a>}
          <button className={`btn small ${song.bonus ? 'yellow' : 'secondary'}`} title="Bonus round song" onClick={() => save({ bonus: !song.bonus })}>⭐</button>
          {song.used && <button className="btn small secondary" title="Make playable again" onClick={() => save({ used: false })}>↺</button>}
          <button className="btn small secondary" onClick={() => act('moveSong', { songId: song.id, delta: -1 })}>↑</button>
          <button className="btn small secondary" onClick={() => act('moveSong', { songId: song.id, delta: 1 })}>↓</button>
          <button className="btn small danger" onClick={() => confirm(`Remove "${song.title}"?`) && act('removeSong', { songId: song.id })}>✕</button>
        </div>
      </td>
    </tr>
  );
}

// ---------------- teams ----------------

function Teams({ s, act }: { s: AdminState; act: (t: string, e?: Record<string, unknown>) => Promise<any> }) {
  return (
    <div className="panel">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <b>{s.teams.length} / 20 teams</b>
        <button className={`btn small ${s.settings.joinOpen ? 'mint' : 'danger'}`} onClick={() => act('settings', { patch: { joinOpen: !s.settings.joinOpen } })}>
          Joining {s.settings.joinOpen ? 'open' : 'closed'}
        </button>
      </div>
      <div className="muted" style={{ fontSize: 13, marginBottom: 10 }}>Start year: leave empty to use the default ({s.settings.defaultStartYear}). It can be changed until a team gets its second card.</div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <tbody>{s.teams.map((t) => <TeamRow key={t.id} t={t} s={s} act={act} />)}</tbody>
      </table>
    </div>
  );
}

function TeamRow({ t, s, act }: { t: TeamPublic; s: AdminState; act: (t: string, e?: Record<string, unknown>) => Promise<any> }) {
  const [name, setName] = useState(t.name);
  const [start, setStart] = useState(t.startYear ? String(t.startYear) : '');
  const [points, setPoints] = useState(String(t.points));
  useEffect(() => setName(t.name), [t.name]);
  useEffect(() => setPoints(String(t.points)), [t.points]);
  const update = (patch: Record<string, unknown>) => act('updateTeam', { teamId: t.id, patch });
  return (
    <tr style={{ borderTop: '1px solid var(--line)' }}>
      <td style={{ padding: 8, width: 60 }}><Avatar team={t} size={44} /></td>
      <td><input className="input" style={{ padding: '6px 10px' }} value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name !== t.name && update({ name })} /></td>
      <td style={{ width: 130 }}>
        <input className="input" style={{ padding: '6px 10px' }} placeholder={`${s.settings.defaultStartYear}`} inputMode="numeric" value={start}
          onChange={(e) => setStart(e.target.value.replace(/\D/g, '').slice(0, 4))}
          onBlur={() => update({ startYear: start.length === 4 ? Number(start) : null })} />
      </td>
      <td style={{ width: 120 }}>
        <input className="input" style={{ padding: '6px 10px' }} inputMode="numeric" value={points} onChange={(e) => setPoints(e.target.value.replace(/[^\d-]/g, ''))} onBlur={() => Number(points) !== t.points && update({ points: Number(points) })} />
      </td>
      <td className="muted" style={{ fontSize: 13 }}>{t.timeline.map((c) => c.year).join(' · ') || '–'}</td>
      <td><span className={`pill ${t.connected ? 'ok' : 'bad'}`}>{t.connected ? 'online' : 'offline'}</span></td>
      <td style={{ width: 60 }}>
        <button className="btn small danger" onClick={() => confirm(`Remove team "${t.name}"? Their device will need to join again.`) && act('removeTeam', { teamId: t.id })}>✕</button>
      </td>
    </tr>
  );
}

// ---------------- settings ----------------

function SettingsTab({ s, act }: { s: AdminState; act: (t: string, e?: Record<string, unknown>) => Promise<any> }) {
  const [v, setV] = useState({ ...s.settings });
  const field = (k: 'defaultStartYear' | 'roundSeconds' | 'targetCards' | 'answersSeconds', label: string, help: string) => (
    <label className="field">
      {label}
      <input className="input" inputMode="numeric" value={String(v[k])} onChange={(e) => setV({ ...v, [k]: Number(e.target.value.replace(/\D/g, '')) || 0 })} />
      <span style={{ fontWeight: 400 }}>{help}</span>
    </label>
  );
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, alignItems: 'start' }}>
      <form className="panel stack" onSubmit={(e) => { e.preventDefault(); act('settings', { patch: v }); }}>
        <b>Game settings</b>
        {field('defaultStartYear', 'Default start year', 'Every team starts with this year unless set per team.')}
        {field('roundSeconds', 'Seconds per song', 'Time teams have to answer.')}
        {field('targetCards', 'Cards to win', 'Including the start card.')}
        {field('answersSeconds', 'Seconds to show answers', 'Before the correct answer appears.')}
        <button className="btn">Save settings</button>
      </form>
      <div className="panel stack">
        <b>Reset</b>
        <div className="muted">Back to the lobby. Teams, photos and songs stay; timelines, points and played songs are cleared.</div>
        <button className="btn danger" onClick={() => confirm('Reset the game?') && act('resetGame')}>Reset game</button>
      </div>
    </div>
  );
}
