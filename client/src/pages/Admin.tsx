import { useEffect, useMemo, useRef, useState } from 'react';
import { BONUS_LIST, MUSIC_LIST, PRACTICE_LIST, type AdminState, type Song, type Stage, type TeamPublic } from '../../../shared/types';
import { useCountdown, useGameSocket } from '../socket';
import { Avatar, Offline, Ring, Wordmark, useToast } from '../components/common';
import { Link, useParams } from 'react-router-dom';
import { SpotifyPlayer, spIframeAllow, spLog, spLogLines, useSpLog, type PlayerHandle, type PlaybackInfo } from '../components/SpotifyPlayer';
import { Medals } from '../components/giftcard';

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
  const act = async (type: string, extra: Record<string, unknown> = {}, quiet = false) => {
    const r = await emit('admin', { type, ...extra });
    if (!r.ok && !quiet) show(r.error);
    return r;
  };
  const needsCheck = s.songs.filter((x) => x.needsCheck && !x.used).length;

  return (
    <div className="admin-page" style={{ maxWidth: 1280, margin: '0 auto', padding: 20 }}>
      <Offline connected={connected} />
      <div className="row wrap" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
        <div className="row" style={{ gap: 14, minWidth: 0 }}>
          <Link to="/host" className="btn small ghost" style={{ flex: 'none' }}>← My games</Link>
          <div>
            <div style={{ fontWeight: 800, fontSize: 20 }}>{s.game.name}</div>
            <div className="muted" style={{ fontSize: 13 }}>Game code <b style={{ color: 'var(--yellow)', letterSpacing: '0.1em' }}>{s.game.code}</b> · players join at {window.location.host}/join/{s.game.code}</div>
          </div>
        </div>
        <div className="row wrap">
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
  lobby: 'Lobby: teams are joining', intro: 'Showing the explanation', stageIntro: 'New round: timelines reset', ready: 'Song loaded, press play',
  playing: 'Teams are answering', answers: 'Showing team answers', reveal: 'Answer revealed: judge artist & title', scoreboard: 'Scoreboard',
  stageEnd: 'Round won!', awards: 'Awards', finished: 'Final results of the night',
};

type Act = (t: string, e?: Record<string, unknown>, quiet?: boolean) => Promise<any>;

function Control({ s, act, serverNow, show, visible }: { s: AdminState; act: Act; serverNow: () => number; show: (m: string) => void; visible: boolean }) {
  const r = s.round;
  const gameSong = s.songs.find((x) => x.id === s.currentSongId) ?? null;
  const music = s.songs.find((x) => x.id === s.musicSongId) ?? null;
  // the game song keeps playing until scoreboard music takes over (or the next song is loaded)
  const lastPlayed = useRef<typeof gameSong>(null);
  if (gameSong) lastPlayed.current = gameSong;
  const nowPlaying = music ?? gameSong ?? (['scoreboard', 'stageEnd', 'finished'].includes(s.phase) ? lastPlayed.current : null);
  const isMusic = !!music && nowPlaying === music;
  // blind mode: the host plays along, so the song stays hidden until the reveal
  const hidden = s.settings.blind && !isMusic && !['reveal', 'scoreboard', 'stageEnd', 'awards', 'finished'].includes(s.phase);

  const player = useRef<PlayerHandle>(null);
  const [preview, setPreview] = useState(false);
  const pbRef = useRef<PlaybackInfo | null>(null);
  const left = useCountdown(s.phase === 'playing' ? r?.endsAt : null, serverNow);
  const phaseRef = useRef(s.phase);
  phaseRef.current = s.phase;
  const turnKey = r ? `${r.stage}-${r.index}-${r.kind}` : null;

  // pressing play in the Spotify player itself also starts the timer
  const lastStart = useRef<{ key: string; at: number } | null>(null);
  const isGameTrack = (p: PlaybackInfo | null) =>
    !!p && !!gameSong?.spotifyId && (p.playingId ? p.playingId === gameSong.spotifyId : p.trackId === gameSong.spotifyId);
  const tryStart = () => {
    if (phaseRef.current !== 'ready' || !turnKey) return;
    const p = pbRef.current;
    if (!p?.playing || !isGameTrack(p)) return;
    const l = lastStart.current;
    // send once per song, but send again if the server still says "ready" a few seconds later
    if (l && l.key === turnKey && Date.now() - l.at < 2500) return;
    lastStart.current = { key: turnKey, at: Date.now() };
    act('startRound', {}, true); // quiet: a duplicate start is simply ignored
  };
  const tryStartRef = useRef(tryStart);
  tryStartRef.current = tryStart;
  const onPlayback = (p: PlaybackInfo) => {
    pbRef.current = p;
    if (p.duration > 0) setPreview(p.duration <= 31000);
    tryStartRef.current();
  };
  // safety net: while a song is loaded, keep checking whether it is actually playing
  useEffect(() => {
    if (s.phase !== 'ready') return;
    lastStart.current = null;
    const t = setInterval(() => tryStartRef.current(), 1000);
    return () => clearInterval(t);
  }, [s.phase, turnKey]);

  const auto = s.settings.autopilot;
  const autoLeft = useCountdown(auto ? s.autoAt : null, serverNow);
  // song loaded but still silent after a few seconds: ask the host to press play
  const [needsClick, setNeedsClick] = useState(false);
  useEffect(() => {
    setNeedsClick(false);
    if (s.phase !== 'ready' || !gameSong?.spotifyId) return;
    const t = setTimeout(() => setNeedsClick(true), auto ? 10000 : 15000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.phase, turnKey]);

  const players = s.teams.filter((t) => r?.participants.includes(t.id));
  const lastStage = s.stage.index >= s.stage.count - 1;
  const nextLabel = s.pendingBonus.length ? '⭐ Start bonus song' : ['intro', 'stageIntro'].includes(s.phase) ? `▶ Load first song of ${s.stage.name}` : '▶ Load next song';

  return (
    <div className="rgrid" style={{ display: visible ? 'grid' : 'none', gridTemplateColumns: '380px 1fr', gap: 20, alignItems: 'start' }}>
      <div className="stack" style={{ position: 'sticky', top: 20 }}>
        <div className="panel stack">
          <div className="muted" style={{ fontSize: 13, fontWeight: 700 }}>{s.stage.name.toUpperCase()} · ROUND {s.stage.index + 1} OF {s.stage.count}</div>
          <div style={{ fontWeight: 800, fontSize: 20 }}>{phaseLabel[s.phase]}</div>
          {r && <div className="muted">{r.practice ? `Practice song ${r.index} · doesn't count` : <>{r.kind === 'bonus' ? 'Bonus song' : `Song ${r.index}`} · {s.songsLeft} songs left in this round</>}</div>}
          {s.outcome?.message && <div className="pill warn" style={{ whiteSpace: 'normal' }}>{s.outcome.message}</div>}
          {s.phase === 'playing' && left !== null && (
            <div className="row"><Ring seconds={left} total={s.settings.roundSeconds} size={80} /><div className="muted">{r?.confirmedTeamIds.length}/{players.length} locked in</div></div>
          )}

          <div className="row" style={{ justifyContent: 'space-between', background: auto ? 'rgba(62,224,161,0.12)' : 'rgba(255,255,255,0.05)', borderRadius: 14, padding: '8px 10px' }}>
            <div style={{ fontSize: 14 }}>
              <b>🤖 Autopilot {auto ? 'on' : 'off'}</b>
              {auto && (
                <div className="muted" style={{ fontSize: 12 }}>
                  {autoLeft !== null && s.autoAt
                    ? `Next step in ${autoLeft}s`
                    : s.phase === 'ready'
                      ? 'Starting the song… (press ▶ if it stays silent)'
                      : ['playing', 'answers'].includes(s.phase)
                        ? 'Waiting for the answers'
                        : 'Waiting for you'}
                </div>
              )}
            </div>
            <button className={`btn small ${auto ? 'secondary' : 'mint'}`} onClick={() => act('settings', { patch: { autopilot: !auto } })}>{auto ? 'Pause' : 'Turn on'}</button>
          </div>

          <div className="stack" style={{ gap: 8 }}>
            {s.phase === 'lobby' && <button className="btn big" onClick={() => act('startShow')} disabled={!s.teams.length}>Start show ({s.teams.length} teams)</button>}
            {['intro', 'stageIntro'].includes(s.phase) && s.practiceLeft > 0 && (
              <button className="btn big yellow" onClick={() => act('practiceSong')}>🎯 Practice song ({s.practiceLeft} left)</button>
            )}
            {['intro', 'stageIntro', 'scoreboard'].includes(s.phase) && <button className={`btn ${s.practiceLeft > 0 ? '' : 'big'}`} onClick={() => act('nextSong')}>{nextLabel}</button>}
            {s.phase === 'ready' && (
              <>
                <div className="pill ok" style={{ whiteSpace: 'normal', padding: '12px 14px', fontSize: 15, lineHeight: 1.35 }}>
                  ▶ Press the green play button in the Spotify player below. The timer starts automatically.
                </div>
                <button className="btn small secondary" onClick={() => act('startRound')}>Start timer only (song not on Spotify)</button>
              </>
            )}
            {s.phase === 'playing' && (
              <div className="row">
                <button className="btn secondary grow" onClick={() => act('addTime', { seconds: 15 })}>+15 sec</button>
                <button className="btn danger grow" onClick={() => act('endRound')}>Stop now</button>
              </div>
            )}
            {s.phase === 'answers' && <button className="btn big yellow" onClick={() => act('reveal')}>Reveal answer now</button>}
            {s.phase === 'reveal' && <button className="btn big" onClick={() => act('commit')}>{r?.practice ? 'Practice done → start the game' : 'Done judging → scoreboard'}</button>}
            {s.phase === 'stageEnd' && !lastStage && <button className="btn big" onClick={() => act('nextStage')}>▶ Start round {s.stage.index + 2}</button>}
            {s.phase === 'stageEnd' && <button className={`btn ${lastStage ? 'big yellow' : 'small ghost'}`} onClick={() => (lastStage || confirm('End the night now? The remaining rounds are skipped.')) && act('finishEvening')}>🏅 Awards & final results</button>}
            {s.phase === 'awards' && s.awards && (
              <>
                <div className="panel" style={{ padding: 12 }}>
                  <div className="muted" style={{ fontSize: 13 }}>Award {s.awardIndex + 1} of {s.awards.length}</div>
                  <div style={{ fontWeight: 800 }}>{s.awards[s.awardIndex].emoji} {s.awards[s.awardIndex].title}</div>
                  <div className="muted" style={{ fontSize: 14 }}>
                    {s.awards[s.awardIndex].teamIds.map((id) => s.teams.find((t) => t.id === id)?.name).filter(Boolean).join(', ')} · {s.awards[s.awardIndex].detail}
                  </div>
                </div>
                <button className="btn big yellow" onClick={() => act('nextAward')}>
                  {s.awardIndex < s.awards.length - 1 ? (s.awards[s.awardIndex + 1].grand ? '🏆 Final award: Best Hitster Players of All Time' : `▶ Next award (${s.awardIndex + 2}/${s.awards.length})`) : '🏆 Show final results'}
                </button>
                {s.awardIndex < s.awards.length - 1 && <button className="btn small ghost" onClick={() => act('skipAwards')}>Skip remaining awards</button>}
              </>
            )}
            {s.phase === 'finished' && <button className="btn danger" onClick={() => confirm('Reset the game? Teams and songs stay, scores and timelines are cleared.') && act('resetGame')}>Reset game (keep teams & songs)</button>}
            {['intro', 'stageIntro', 'ready'].includes(s.phase) && <button className="btn small ghost" onClick={() => act('scoreboard')}>Show scoreboard</button>}
            {['scoreboard', 'ready', 'stageIntro'].includes(s.phase) && <button className="btn small ghost" onClick={() => act('showIntro')}>Show explanation again</button>}
            {s.phase === 'scoreboard' && <button className="btn small ghost" onClick={() => confirm('End the night now? This round gets no winner.') && act('finishEvening')}>End the night now</button>}
          </div>
        </div>

        <div className="panel stack" style={{ display: nowPlaying ? 'grid' : 'none' }}>
          <div className="muted" style={{ fontSize: 13, fontWeight: 700 }}>{isMusic ? `SCOREBOARD MUSIC · from ${fmtTime(music!.startAt)}` : 'NOW PLAYING (only you see this)'}</div>
          {nowPlaying && hidden && <div style={{ fontWeight: 800 }}>🙈 Hidden (blind mode)</div>}
          {nowPlaying && !hidden && (
            <div className="row">
              {nowPlaying.coverUrl && <img src={nowPlaying.coverUrl} alt="" style={{ width: 56, height: 56, borderRadius: 8 }} />}
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 800 }}>{nowPlaying.title}</div>
                <div className="muted">{nowPlaying.artist}{!isMusic && <> · <b style={{ color: 'var(--yellow)' }}>{nowPlaying.year}</b></>}</div>
              </div>
            </div>
          )}
        </div>
        {needsClick && s.phase === 'ready' && (
          <div className="pill warn pop" style={{ whiteSpace: 'normal', padding: '12px 14px', fontSize: 15, animation: 'pulse 1.2s ease-in-out infinite' }}>
            🔇 The browser didn't let the song start by itself. Click ▶ in the Spotify player below; the timer starts with it.
          </div>
        )}
        <div style={{ display: nowPlaying?.spotifyId ? 'block' : 'none', position: 'relative' }}>
          <SpotifyPlayer ref={player} trackId={nowPlaying?.spotifyId ?? null} startAt={isMusic ? music!.startAt : 0} autoplay={isMusic} autostart={auto && s.phase === 'ready' && !isMusic && !!gameSong?.spotifyId} onPlayback={onPlayback} />
          {hidden && (
            // covers cover art, title and artist; the play button on the right stays clickable
            <div style={{ position: 'absolute', left: 0, top: 0, height: 152, right: 64, borderRadius: '12px 0 0 12px', background: 'linear-gradient(90deg, #1b1170 85%, rgba(27,17,112,0.85))', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 14, textAlign: 'center', padding: 12 }}>
              🙈 Song hidden
              <br />
              <span className="muted" style={{ fontWeight: 500 }}>Press ▶ on the right →</span>
            </div>
          )}
          {preview && (
            <div className="panel stack" style={{ marginTop: 8, padding: 14, gap: 6, border: '2px solid var(--yellow)', fontSize: 14 }}>
              <b style={{ color: 'var(--yellow)' }}>Spotify plays a 30 sec preview</b>
              <span>1. Use Chrome or Edge on the laptop (not incognito).</span>
              <span>2. Log in at <a href="https://open.spotify.com" target="_blank" rel="noreferrer" style={{ fontWeight: 700 }}>open.spotify.com</a> with a Premium account in this same browser.</span>
              <span>3. Allow third-party cookies for this site: click the icon left of the address bar → Cookies / Third-party cookies → Allow. Then reload this page.</span>
              <span>4. Start songs with the green play button inside the Spotify player.</span>
            </div>
          )}
          <SpotifyCheck player={player} />
          {isMusic && <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>Not playing? Press play in the player once; the browser sometimes blocks autoplay.</div>}
        </div>
        {nowPlaying && !nowPlaying.spotifyId && !isMusic && <div className="panel muted" style={{ padding: 14 }}>No Spotify link for this song. Play it manually, then press “Start timer only”.</div>}
        {s.phase === 'ready' && !s.settings.blind && <NextSongPicker s={s} act={act} />}
      </div>

      <div className="stack">
        {s.phase === 'lobby' && <LobbyTeams teams={s.teams} />}
        {r && ['playing', 'answers', 'reveal'].includes(s.phase) && <JudgeTable s={s} act={act} />}
        {['intro', 'stageIntro', 'scoreboard', 'stageEnd', 'awards', 'finished', 'ready'].includes(s.phase) && <MiniScoreboard s={s} />}
      </div>
    </div>
  );
}

export function fmtTime(sec: number) {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}
function parseTime(v: string): number | null {
  const m = v.trim().match(/^(\d+)(?::(\d{1,2}))?$/);
  if (!m) return null;
  return m[2] !== undefined ? Number(m[1]) * 60 + Number(m[2]) : Number(m[1]);
}

function NextSongPicker({ s, act }: { s: AdminState; act: Act }) {
  const stageId = s.stages[s.stage.index]?.id;
  const options = s.songs.filter((x) => !x.used && x.year !== null && (x.list === stageId || x.list === BONUS_LIST));
  return (
    <div className="panel stack">
      <div className="muted" style={{ fontSize: 13, fontWeight: 700 }}>SWAP SONG</div>
      <select className="input" value="" onChange={(e) => e.target.value && act('nextSong', { songId: e.target.value })}>
        <option value="">Pick another song…</option>
        {options.map((x) => <option key={x.id} value={x.id}>{x.list === BONUS_LIST ? '⭐ ' : ''}{x.title} – {x.artist} ({x.year})</option>)}
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
  // blind mode: nothing that gives the answer away before the reveal
  const secret = s.settings.blind && s.phase !== 'reveal';
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
        {secret && <div className="muted">🙈 Blind mode: answers and the correct song show at the reveal</div>}
        {song && !secret && <div className="muted">Correct: <b style={{ color: '#fff' }}>{song.artist}</b> – <b style={{ color: '#fff' }}>{song.title}</b> ({song.year})</div>}
      </div>
      <div className="table-scroll"><table style={{ width: '100%', borderCollapse: 'collapse' }}>
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
                      <b>{secret ? (a ? '🙈' : '–') : placement(r.timelineYears?.[t.id], a?.position)}</b>
                      {!secret && r.speedWinnerId === t.id && <span className="pill warn" title="First team to lock in the right spot">⚡ +{s.settings.speedBonus} · {((r.speedMs ?? 0) / 1000).toFixed(1)}s</span>}
                      {judging && !secret && (
                        <button className={`btn small ${ok ? 'mint' : 'danger'}`} title="Click to override" onClick={() => act('placement', { teamId: t.id, value: !ok })}>
                          {ok ? '✓' : '✗'}
                        </button>
                      )}
                    </div>
                  )}
                </td>
                <td style={{ maxWidth: 200 }}>{secret ? (a?.artist ? '🙈' : '–') : a?.artist || <span className="muted">–</span>}</td>
                <td>{!secret && <Toggle teamId={t.id} field="artist" value={j?.artist} />}</td>
                <td style={{ maxWidth: 200 }}>{secret ? (a?.title ? '🙈' : '–') : a?.title || <span className="muted">–</span>}</td>
                <td>{!secret && <Toggle teamId={t.id} field="title" value={j?.title} />}</td>
              </tr>
            );
          })}
        </tbody>
      </table></div>
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
            <div className="grow" style={{ fontWeight: 700 }}>{t.name}<Medals wins={t.wins} size={18} /> {!t.connected && <span className="pill bad">offline</span>}</div>
            <div className="muted" style={{ fontSize: 13 }}>{t.timeline.map((c) => c.year).join(' · ')}</div>
            <b style={{ width: 150, textAlign: 'right' }}>{t.timeline.length}/{s.settings.targetCards} · {t.points} pts</b>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------- songs ----------------

function Songs({ s, act, socket, show }: { s: AdminState; act: Act; socket: React.RefObject<any>; show: (m: string) => void }) {
  const [listId, setListId] = useState<string>(() => s.stages[s.stage.index]?.id ?? s.stages[0].id);
  const [text, setText] = useState('');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [manual, setManual] = useState({ title: '', artist: '', year: '', spotifyUrl: '', startAt: '' });
  const [onlyCheck, setOnlyCheck] = useState(false);

  useEffect(() => {
    const sock = socket.current;
    if (!sock) return;
    const h = (p: { done: number; total: number } | null) => setProgress(p);
    sock.on('importProgress', h);
    return () => sock.off('importProgress', h);
  }, [socket]);

  // the selected round may have been deleted
  const valid = listId === BONUS_LIST || listId === MUSIC_LIST || listId === PRACTICE_LIST || s.stages.some((x) => x.id === listId);
  const list = valid ? listId : s.stages[0].id;
  const stageIndex = s.stages.findIndex((x) => x.id === list);
  const stage = stageIndex >= 0 ? s.stages[stageIndex] : null;
  const isMusic = list === MUSIC_LIST;
  const songs = s.songs.filter((x) => x.list === list && (!onlyCheck || x.needsCheck));
  const count = (id: string) => s.songs.filter((x) => x.list === id).length;
  const played = stageIndex >= 0 && s.phase !== 'lobby' && stageIndex < s.stage.index;
  const target = s.settings.targetCards - (stage?.startYears.length ?? 1);

  const tabs = [
    ...s.stages.map((st, i) => ({ id: st.id, label: `${i + 1}. ${st.name}`, n: count(st.id) })),
    { id: PRACTICE_LIST, label: '🎯 Practice', n: count(PRACTICE_LIST) },
    { id: BONUS_LIST, label: '⭐ Bonus', n: count(BONUS_LIST) },
    { id: MUSIC_LIST, label: '🎵 Scoreboard music', n: count(MUSIC_LIST) },
  ];

  const blind = s.settings.blind;
  return (
    <div className="stack">
    <BlindSetup s={s} act={act} socket={socket} show={show} />
    <div className="rgrid" style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 20, alignItems: 'start' }}>
      <div className="panel stack" style={{ gap: 6, position: 'sticky', top: 20 }}>
        <div className="muted" style={{ fontSize: 13, fontWeight: 700 }}>SONG LISTS</div>
        {tabs.map((t) => (
          <button key={t.id} className={`btn small ${list === t.id ? '' : 'secondary'}`} style={{ textAlign: 'left', display: 'flex', justifyContent: 'space-between', gap: 8 }} onClick={() => setListId(t.id)}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.label}</span>
            <span style={{ opacity: 0.8 }}>{t.n}</span>
          </button>
        ))}
        <button className="btn small ghost" onClick={async () => { const r = await act('addStage'); if (r.ok) show('Round added'); }}>+ Add round</button>
        <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
          Each round plays its own list top to bottom until a team has {s.settings.targetCards} cards. Bonus songs are only used for tie-breakers.
        </div>
      </div>

      <div className="stack">
        {stage && <StageSettings key={stage.id} stage={stage} index={stageIndex} total={s.stages.length} act={act} played={played} songs={count(stage.id)} needed={target} />}
        {list === PRACTICE_LIST && <div className="panel muted">🎯 Practice songs are played before the first real song so everyone can try dragging and confirming. They give no points and no cards. Add 1 or 2; in the host panel you choose whether to play them.</div>}
        {list === BONUS_LIST && <div className="panel muted">⭐ Bonus songs are played only when teams tie: they guess the exact year, closest wins. Add a few (3 to 5).</div>}
        {isMusic && <div className="panel muted">🎵 These songs play on the scoreboard and winner screens, starting at the second you choose (e.g. the chorus). They rotate one per scoreboard.</div>}

        <div className="rgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <div className="panel stack">
            <div style={{ fontWeight: 800 }}>Add from Spotify</div>
            <div className="muted" style={{ fontSize: 14 }}>
              Paste one or more Spotify track links. Tip: in the Spotify desktop app open a playlist, click a song, press Ctrl+A then Ctrl+C, and paste here. The order is kept.
            </div>
            <textarea className="input" rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="https://open.spotify.com/track/…" />
            <div className="row wrap">
              <button
                className="btn"
                disabled={!text.trim() || !!progress}
                onClick={async () => {
                  const r = await act('importSongs', { text, list });
                  if (r.ok) {
                    setText('');
                    show(`Adding ${r.result.queued} song(s)${r.result.skipped ? `, ${r.result.skipped} already in this game` : ''}`);
                  }
                }}
              >
                Add to {tabs.find((t) => t.id === list)?.label.replace(/^\d+\. /, '')}
              </button>
              {progress && <span className="pill warn">Looking up {progress.done}/{progress.total}…</span>}
            </div>
          </div>
          <form
            className="panel stack"
            onSubmit={async (e) => {
              e.preventDefault();
              const startAt = parseTime(manual.startAt) ?? 0;
              const r = await act('addSong', { song: { ...manual, list, startAt, year: manual.year ? Number(manual.year) : null } });
              if (r.ok) setManual({ title: '', artist: '', year: '', spotifyUrl: '', startAt: '' });
            }}
          >
            <div style={{ fontWeight: 800 }}>Add manually</div>
            <div className="row">
              <input className="input" placeholder="Title" value={manual.title} onChange={(e) => setManual({ ...manual, title: e.target.value })} />
              <input className="input" placeholder="Artist" value={manual.artist} onChange={(e) => setManual({ ...manual, artist: e.target.value })} />
            </div>
            <div className="row">
              {isMusic ? (
                <input className="input" placeholder="Start 1:05" style={{ width: 120 }} value={manual.startAt} onChange={(e) => setManual({ ...manual, startAt: e.target.value })} />
              ) : (
                <input className="input" placeholder="Year" inputMode="numeric" style={{ width: 110 }} value={manual.year} onChange={(e) => setManual({ ...manual, year: e.target.value.replace(/\D/g, '').slice(0, 4) })} />
              )}
              <input className="input" placeholder="Spotify link" value={manual.spotifyUrl} onChange={(e) => setManual({ ...manual, spotifyUrl: e.target.value })} />
            </div>
            <button className="btn secondary" disabled={!manual.title.trim()}>Add</button>
          </form>
        </div>

        <div className="panel">
          <div className="row wrap" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
            <b>{s.songs.filter((x) => x.list === list).length} songs{stage ? ` · ${s.songs.filter((x) => x.list === list && !x.used).length} not played` : ''}</b>
            <div className="row">
              {!isMusic && (
                <button className={`btn small ${onlyCheck ? '' : 'secondary'}`} onClick={() => setOnlyCheck((v) => !v)}>
                  ⚠ Check year ({s.songs.filter((x) => x.list === list && x.needsCheck).length})
                </button>
              )}
              <button className="btn small ghost" onClick={() => confirm('Shuffle the unplayed songs of this list?') && act('shuffleSongs', { list })}>Shuffle</button>
            </div>
          </div>
          {!isMusic && (
            <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>
              Songs play top to bottom. Spotify sometimes shows the remaster year; MusicBrainz usually has the original. Edit the year if needed.
            </div>
          )}
          {blind && !isMusic ? (
            <div className="stack" style={{ gap: 6 }}>
              {songs.map((x, i) => (
                <div key={x.id} className="row" style={{ borderTop: '1px solid var(--line)', padding: '6px 0', opacity: x.used ? 0.45 : 1 }}>
                  <span className="muted" style={{ width: 30 }}>{i + 1}</span>
                  <div style={{ width: 44, height: 44, borderRadius: 6, background: 'var(--card-strong)', display: 'grid', placeItems: 'center' }}>🙈</div>
                  <span className="grow muted">Hidden song</span>
                  {x.used && <span className="pill">played</span>}
                </div>
              ))}
            </div>
          ) : (
            <div className="table-scroll"><table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                {songs.map((x, i) => <SongRow key={x.id} song={x} act={act} index={i} s={s} />)}
              </tbody>
            </table></div>
          )}
          {!songs.length && <div className="muted" style={{ padding: 20, textAlign: 'center' }}>No songs in this list yet.</div>}
        </div>
      </div>
    </div>
    </div>
  );
}

function BlindSetup({ s, act, socket, show }: { s: AdminState; act: Act; socket: React.RefObject<any>; show: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [f, setF] = useState({ rounds: 6, perRound: 15, practice: 1, bonus: 3 });
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  useEffect(() => {
    const sock = socket.current;
    if (!sock) return;
    const p = (x: { done: number; total: number } | null) => setProgress(x);
    const d = (x: { done: number; total: number; skipped: number }) =>
      show(x.done >= x.total ? `Ready! ${x.done} hidden songs spread over the rounds.` : `Only ${x.done} of ${x.total} songs could be used. Paste a bigger playlist and run it again.`);
    sock.on('importProgress', p);
    sock.on('blindDone', d);
    return () => {
      sock.off('importProgress', p);
      sock.off('blindDone', d);
    };
  }, [socket, show]);
  const need = f.rounds * f.perRound + f.practice + f.bonus;
  const found = (text.match(/track[/:][A-Za-z0-9]{22}/g) ?? []).length;
  const num = (k: keyof typeof f, label: string, max: number) => (
    <label className="field" style={{ width: 120 }}>
      {label}
      <input className="input" inputMode="numeric" value={String(f[k])} onChange={(e) => setF({ ...f, [k]: Math.min(max, Number(e.target.value.replace(/\D/g, '')) || 0) })} />
    </label>
  );

  if (s.settings.blind) {
    return (
      <div className="panel row wrap" style={{ justifyContent: 'space-between', border: '2px solid var(--yellow)' }}>
        <div>
          <b>🙈 Blind mode is on</b>
          <div className="muted" style={{ fontSize: 14 }}>Titles, artists and years are hidden in the host panel until each reveal, so you can play along.</div>
        </div>
        <div className="row">
          {progress && <span className="pill warn">Picking songs {progress.done}/{progress.total}…</span>}
          <button className="btn small ghost" onClick={() => confirm('Show all songs? You will see the answers.') && act('settings', { patch: { blind: false } })}>Show songs (spoilers!)</button>
        </div>
      </div>
    );
  }
  if (s.phase !== 'lobby') return null;
  return (
    <div className="panel stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <b>🙈 Blind setup: play along without knowing the songs</b>
          <div className="muted" style={{ fontSize: 14 }}>Paste a big playlist; the app picks random songs, spreads them over the rounds and hides them from you.</div>
        </div>
        <button className="btn small secondary" onClick={() => setOpen((v) => !v)}>{open ? 'Close' : 'Set up'}</button>
      </div>
      {open && (
        <>
          <div className="muted" style={{ fontSize: 14 }}>
            Tip: pick a large playlist (e.g. a top 2000 or a Hitster playlist), open it in the Spotify desktop app, click one song, press Ctrl+A and Ctrl+C without reading along, and paste here. The more songs, the bigger the surprise.
          </div>
          <textarea className="input" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste Spotify track links here" style={{ color: 'transparent', textShadow: '0 0 8px rgba(255,255,255,0.5)' }} />
          <div className="row wrap" style={{ alignItems: 'flex-end' }}>
            {num('rounds', 'Rounds', 12)}
            {num('perRound', 'Songs per round', 40)}
            {num('practice', 'Practice songs', 2)}
            {num('bonus', 'Bonus songs', 5)}
            <div className="grow" />
            <div className="muted" style={{ fontSize: 13, textAlign: 'right' }}>
              Needs {need} songs · pasted {found}
              <br />
              Takes about {Math.ceil((need * 2) / 60)} min
            </div>
            <button
              className="btn"
              disabled={found < need || !!progress}
              onClick={async () => {
                const r = await act('blindSetup', { text, ...f });
                if (r.ok) {
                  setText('');
                  setOpen(false);
                }
              }}
            >
              Pick songs blind
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function StageSettings({ stage, index, total, act, played, songs, needed }: { stage: Stage; index: number; total: number; act: Act; played: boolean; songs: number; needed: number }) {
  const [name, setName] = useState(stage.name);
  const [y1, setY1] = useState(String(stage.startYears[0] ?? ''));
  const [y2, setY2] = useState(String(stage.startYears[1] ?? ''));
  const two = stage.startYears.length > 1;
  const saveYears = (a: string, b: string, twoCards: boolean) => {
    const ys = [a, b].slice(0, twoCards ? 2 : 1).filter((v) => v.length === 4).map(Number);
    if (ys.length === (twoCards ? 2 : 1)) act('updateStage', { stageId: stage.id, patch: { startYears: ys } });
  };
  return (
    <div className="panel stack">
      <div className="row wrap" style={{ justifyContent: 'space-between' }}>
        <b>Round {index + 1} of {total}{played && <span className="pill" style={{ marginLeft: 8 }}>played</span>}</b>
        <div className="row">
          <button className="btn small secondary" disabled={index === 0} onClick={() => act('moveStage', { stageId: stage.id, delta: -1 })}>↑ Earlier</button>
          <button className="btn small secondary" disabled={index === total - 1} onClick={() => act('moveStage', { stageId: stage.id, delta: 1 })}>↓ Later</button>
          <button className="btn small danger" disabled={total === 1} onClick={() => confirm(`Delete "${stage.name}" and its ${songs} songs?`) && act('removeStage', { stageId: stage.id })}>Delete round</button>
        </div>
      </div>
      <div className="rgrid" style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr 1fr', gap: 16, alignItems: 'end' }}>
        <label className="field">
          Name (shown on the big screen)
          <input className="input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== stage.name && act('updateStage', { stageId: stage.id, patch: { name } })} />
        </label>
        <label className="field">
          Start cards
          <select className="input" value={two ? 2 : 1} onChange={(e) => saveYears(y1, y2 || String(Number(y1) + 15), e.target.value === '2')}>
            <option value={1}>1 start year</option>
            <option value={2}>2 start years</option>
          </select>
        </label>
        <div className="row" style={{ gap: 8 }}>
          <label className="field grow">
            Start year{two ? ' 1' : ''}
            <input className="input" inputMode="numeric" value={y1} onChange={(e) => setY1(e.target.value.replace(/\D/g, '').slice(0, 4))} onBlur={() => saveYears(y1, y2, two)} />
          </label>
          {two && (
            <label className="field grow">
              Start year 2
              <input className="input" inputMode="numeric" value={y2} onChange={(e) => setY2(e.target.value.replace(/\D/g, '').slice(0, 4))} onBlur={() => saveYears(y1, y2, two)} />
            </label>
          )}
        </div>
      </div>
      <div className="muted" style={{ fontSize: 13 }}>
        A team needs at least {needed} correct songs to win this round, so add more than that: {songs} song{songs === 1 ? '' : 's'} now{songs < needed * 2 ? ', we suggest ' + needed * 2 + ' or more' : ''}.
      </div>
    </div>
  );
}

function SongRow({ song, act, index, s }: { song: Song; act: Act; index: number; s: AdminState }) {
  const [year, setYear] = useState(song.year ? String(song.year) : '');
  const [title, setTitle] = useState(song.title);
  const [artist, setArtist] = useState(song.artist);
  const [startAt, setStartAt] = useState(fmtTime(song.startAt ?? 0));
  useEffect(() => setYear(song.year ? String(song.year) : ''), [song.year]);
  useEffect(() => setTitle(song.title), [song.title]);
  useEffect(() => setArtist(song.artist), [song.artist]);
  useEffect(() => setStartAt(fmtTime(song.startAt ?? 0)), [song.startAt]);
  const save = (patch: Partial<Song>) => act('updateSong', { songId: song.id, patch });
  const isMusic = song.list === MUSIC_LIST;
  return (
    <tr style={{ borderTop: '1px solid var(--line)', opacity: song.used ? 0.45 : 1 }}>
      <td style={{ padding: 6, width: 30 }} className="muted">{index + 1}</td>
      <td style={{ width: 52 }}>{song.coverUrl ? <img src={song.coverUrl} alt="" style={{ width: 44, height: 44, borderRadius: 6 }} /> : <div style={{ width: 44, height: 44, borderRadius: 6, background: 'var(--card-strong)' }} />}</td>
      <td><input className="input" style={{ padding: '6px 10px' }} value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => title !== song.title && save({ title })} /></td>
      <td><input className="input" style={{ padding: '6px 10px' }} value={artist} onChange={(e) => setArtist(e.target.value)} onBlur={() => artist !== song.artist && save({ artist })} /></td>
      {isMusic ? (
        <td style={{ width: 110 }}>
          <input
            className="input" title="Start at (m:ss), e.g. the chorus" style={{ padding: '6px 10px', fontWeight: 800 }}
            value={startAt} onChange={(e) => setStartAt(e.target.value)}
            onBlur={() => { const t = parseTime(startAt); if (t !== null && t !== song.startAt) save({ startAt: t }); else setStartAt(fmtTime(song.startAt ?? 0)); }}
          />
        </td>
      ) : (
        <>
          <td style={{ width: 90 }}>
            <input
              className="input" inputMode="numeric" style={{ padding: '6px 10px', fontWeight: 800, borderColor: song.needsCheck ? 'var(--yellow)' : undefined }}
              value={year} placeholder="year"
              onChange={(e) => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))}
              onBlur={() => year.length === 4 && Number(year) !== song.year && save({ year: Number(year) })}
            />
          </td>
          <td style={{ fontSize: 12, width: 140 }} className="muted">
            {song.spotifyYear && <div>Spotify: {song.spotifyYear}</div>}
            {song.musicbrainzYear && <div>MusicBrainz: {song.musicbrainzYear}</div>}
            {song.needsCheck && <button className="btn small yellow" style={{ marginTop: 2 }} onClick={() => save({ needsCheck: false, year: song.year })} disabled={!song.year}>Year OK</button>}
          </td>
        </>
      )}
      <td style={{ width: 300 }}>
        <div className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
          {song.used && <span className="pill">played</span>}
          {song.spotifyUrl && <a className="btn small ghost" href={song.spotifyUrl} target="_blank" rel="noreferrer" title="Open in Spotify">♪</a>}
          {!isMusic && (
            <select className="input" style={{ padding: '4px 6px', width: 96, fontSize: 12 }} value="" title="Move to another list" onChange={(e) => e.target.value && save({ list: e.target.value })}>
              <option value="">Move…</option>
              {s.stages.map((st, i) => st.id !== song.list && <option key={st.id} value={st.id}>{i + 1}. {st.name}</option>)}
              {song.list !== BONUS_LIST && <option value={BONUS_LIST}>⭐ Bonus</option>}
            </select>
          )}
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

function Teams({ s, act }: { s: AdminState; act: Act }) {
  return (
    <div className="panel">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <b>{s.teams.length} / 20 teams</b>
        <button className={`btn small ${s.settings.joinOpen ? 'mint' : 'danger'}`} onClick={() => act('settings', { patch: { joinOpen: !s.settings.joinOpen } })}>
          Joining {s.settings.joinOpen ? 'open' : 'closed'}
        </button>
      </div>
      <div className="muted" style={{ fontSize: 13, marginBottom: 10 }}>
        Own start years: leave empty to use the round's start years. One year or two separated by a comma, e.g. “1987, 2004”. Points can be corrected by hand.
      </div>
      <div className="table-scroll"><table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr className="muted" style={{ fontSize: 12, textAlign: 'left' }}>
            <th></th><th>Name</th><th>Own start years</th><th>Points</th><th>Timeline</th><th></th><th></th>
          </tr>
        </thead>
        <tbody>{s.teams.map((t) => <TeamRow key={t.id} t={t} s={s} act={act} />)}</tbody>
      </table></div>
    </div>
  );
}

function TeamRow({ t, s, act }: { t: TeamPublic; s: AdminState; act: Act }) {
  const [name, setName] = useState(t.name);
  const [start, setStart] = useState(t.startYears?.join(', ') ?? '');
  const [points, setPoints] = useState(String(t.points));
  useEffect(() => setName(t.name), [t.name]);
  useEffect(() => setPoints(String(t.points)), [t.points]);
  const update = (patch: Record<string, unknown>) => act('updateTeam', { teamId: t.id, patch });
  return (
    <tr style={{ borderTop: '1px solid var(--line)' }}>
      <td style={{ padding: 8, width: 60 }}><Avatar team={t} size={44} /></td>
      <td><input className="input" style={{ padding: '6px 10px' }} value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name !== t.name && update({ name })} /></td>
      <td style={{ width: 150 }}>
        <input className="input" style={{ padding: '6px 10px' }} placeholder={s.stage.startYears.join(', ')} value={start}
          onChange={(e) => setStart(e.target.value.replace(/[^\d, ]/g, ''))}
          onBlur={() => {
            const ys = start.split(/[ ,]+/).filter((v) => v.length === 4).map(Number).slice(0, 2);
            update({ startYears: ys.length ? ys : null });
            setStart(ys.join(', '));
          }} />
      </td>
      <td style={{ width: 110 }}>
        <input className="input" style={{ padding: '6px 10px' }} inputMode="numeric" value={points} onChange={(e) => setPoints(e.target.value.replace(/[^\d-]/g, ''))} onBlur={() => Number(points) !== t.points && update({ points: Number(points) })} />
      </td>
      <td className="muted" style={{ fontSize: 13 }}>{t.timeline.map((c) => c.year).join(' · ') || '–'}<Medals wins={t.wins} size={18} /></td>
      <td><span className={`pill ${t.connected ? 'ok' : 'bad'}`}>{t.connected ? 'online' : 'offline'}</span></td>
      <td style={{ width: 60 }}>
        <button className="btn small danger" onClick={() => confirm(`Remove team "${t.name}"? Their device will need to join again.`) && act('removeTeam', { teamId: t.id })}>✕</button>
      </td>
    </tr>
  );
}

// ---------------- settings ----------------

function SettingsTab({ s, act }: { s: AdminState; act: Act }) {
  const [v, setV] = useState({ ...s.settings });
  const [base] = useState({ ...s.settings });
  // only send what was changed here, so switches flipped elsewhere (autopilot, joining) aren't overwritten
  const changes = () => Object.fromEntries(Object.entries(v).filter(([k, val]) => (base as any)[k] !== val));
  const field = (k: 'roundSeconds' | 'targetCards' | 'answersSeconds' | 'winBonus' | 'speedBonus' | 'autoRevealSeconds' | 'autoScoreboardSeconds', label: string, help: string) => (
    <label className="field">
      {label}
      <input className="input" inputMode="numeric" value={String(v[k])} onChange={(e) => setV({ ...v, [k]: Number(e.target.value.replace(/\D/g, '')) || 0 })} />
      <span style={{ fontWeight: 400 }}>{help}</span>
    </label>
  );
  return (
    <div className="rgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, alignItems: 'start' }}>
      <form className="panel stack" onSubmit={async (e) => { e.preventDefault(); const r = await act('settings', { patch: changes() }); if (r.ok) Object.assign(base, v); }}>
        <b>Game settings</b>
        {field('roundSeconds', 'Seconds per song', 'How long teams can answer. The song starts at the beginning and keeps playing through the answers and the reveal.')}
        {field('targetCards', 'Cards to win a round', 'Including the start card(s).')}
        {field('winBonus', 'Points for winning a round', 'Artist and title are worth 100 points each.')}
        {field('speedBonus', 'Speed bonus', 'For the first team that locks in the right spot. 0 turns it off.')}
        <label className="row" style={{ gap: 10, cursor: 'pointer' }}>
          <input type="checkbox" checked={!!v.autopilot} onChange={(e) => setV({ ...v, autopilot: e.target.checked })} />
          <span><b>Autopilot</b> <span className="muted">· the game moves on by itself and judges artist/title automatically (you can still click and correct)</span></span>
        </label>
        {v.autopilot && (
          <div className="row">
            {field('autoRevealSeconds', 'Seconds on the answer', 'Time to look at (and correct) the answer.')}
            {field('autoScoreboardSeconds', 'Seconds on the scoreboard', 'Before the next song loads.')}
          </div>
        )}
        <label className="row" style={{ gap: 10, cursor: 'pointer' }}>
          <input type="checkbox" checked={!!v.blind} onChange={(e) => setV({ ...v, blind: e.target.checked })} />
          <span><b>Blind mode</b> <span className="muted">· hide songs in the host panel so you can play along</span></span>
        </label>
        {field('answersSeconds', 'Seconds to show answers', 'Before the correct answer appears.')}
        <button className="btn">Save settings</button>
      </form>
      <div className="panel stack">
        <b>Reset</b>
        <div className="muted">Back to the lobby. Teams, photos and songs stay; timelines, points, medals and played songs are cleared.</div>
        <button className="btn danger" onClick={() => confirm('Reset the game?') && act('resetGame')}>Reset game</button>
      </div>
    </div>
  );
}

/** Troubleshooting panel: shows what the browser and the Spotify player did, and lets the host test autostart. */
function SpotifyCheck({ player }: { player: React.RefObject<PlayerHandle | null> }) {
  const lines = useSpLog();
  const [copied, setCopied] = useState(false);
  const [wait, setWait] = useState(0);
  useEffect(() => {
    if (!wait) return;
    const t = setTimeout(() => {
      if (wait === 1) {
        spLog('test: start without a click (after 8 sec)');
        player.current?.play();
      }
      setWait(wait - 1);
    }, 1000);
    return () => clearTimeout(t);
  }, [wait]);
  const report = () =>
    [`browser: ${navigator.userAgent}`, `player allow: ${spIframeAllow()}`, `page: ${location.host}`, ...spLogLines()].join('\n');
  return (
    <details style={{ marginTop: 8, fontSize: 13 }}>
      <summary className="muted" style={{ cursor: 'pointer' }}>🔧 Spotify check</summary>
      <div className="stack" style={{ gap: 8, marginTop: 8 }}>
        <div className="row wrap" style={{ gap: 8 }}>
          <button className="btn small secondary" onClick={() => { spLog('test: start with a click'); player.current?.play(); }}>Test 1: start with a click</button>
          <button className="btn small secondary" disabled={!!wait} onClick={() => { player.current?.pause(); setWait(8); }}>{wait ? `Starting in ${wait}…` : 'Test 2: start by itself in 8 sec'}</button>
          <button className="btn small secondary" onClick={() => navigator.clipboard?.writeText(report()).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); })}>{copied ? 'Copied ✓' : 'Copy log'}</button>
        </div>
        <pre style={{ margin: 0, maxHeight: 220, overflow: 'auto', background: 'rgba(0,0,0,0.3)', padding: 10, borderRadius: 8, fontSize: 11, whiteSpace: 'pre-wrap' }}>{lines.slice(-30).join('\n') || 'Nothing yet'}</pre>
      </div>
    </details>
  );
}
