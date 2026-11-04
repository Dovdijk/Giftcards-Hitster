import { StrictMode, lazy, Suspense } from 'react';
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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Suspense fallback={null}>
        <Routes>
          <Route path="/show" element={<Show />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="*" element={<Play />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  </StrictMode>,
);
