import { Component, StrictMode, lazy, Suspense, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import '@fontsource/poppins/400.css';
import '@fontsource/poppins/500.css';
import '@fontsource/poppins/600.css';
import '@fontsource/poppins/700.css';
import '@fontsource/poppins/800.css';
import './styles.css';

const Play = lazy(() => import('./pages/Play'));
const Show = lazy(() => import('./pages/Show'));
const Admin = lazy(() => import('./pages/Admin'));
const Home = lazy(() => import('./pages/Home'));
const Host = lazy(() => import('./pages/Host'));

/** Shows a message instead of an empty screen when a page crashes. */
class Crash extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error(error);
    // after a new version went online an open tab can't load the old page files: reload once
    if (/dynamically imported module|Loading chunk|Importing a module script failed/i.test(String(error?.message)) && !sessionStorage.getItem('hitster-reloaded')) {
      try { sessionStorage.setItem('hitster-reloaded', '1'); } catch { /* ignore */ }
      location.reload();
    }
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="center" style={{ minHeight: '100vh', padding: 24 }}>
        <div className="panel stack" style={{ maxWidth: 460, padding: 26, gap: 12, textAlign: 'left' }}>
          <h2 style={{ margin: 0 }}>Something went <span className="accent">wrong</span></h2>
          <p className="muted" style={{ margin: 0 }}>Reload the page. If this keeps happening, send this message to the organiser:</p>
          <code style={{ fontSize: 12, background: 'rgba(0,0,0,0.3)', padding: 10, borderRadius: 8, whiteSpace: 'pre-wrap' }}>{String(this.state.error.message)}</code>
          <button className="btn" onClick={() => location.reload()}>Reload</button>
        </div>
      </div>
    );
  }
}
setTimeout(() => { try { sessionStorage.removeItem('hitster-reloaded'); } catch { /* ignore */ } }, 10000);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Crash>
    <BrowserRouter>
      <Suspense fallback={null}>
        <Routes>
          <Route path="/join/:code" element={<Play />} />
          <Route path="/show/:code" element={<Show />} />
          <Route path="/host" element={<Host />} />
          <Route path="/host/:gameId" element={<Admin />} />
          <Route path="*" element={<Home />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
    </Crash>
  </StrictMode>,
);
