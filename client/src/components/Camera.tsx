import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/** Webcam capture for laptops: phones use their native camera through a file input instead. */
export function CameraCapture({ onCapture, onClose, onPickFile }: { onCapture: (dataUrl: string) => void; onClose: () => void; onPickFile: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shot, setShot] = useState<string | null>(null);
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let stopped = false;
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false })
      .then((s) => {
        if (stopped) return s.getTracks().forEach((t) => t.stop());
        stream.current = s;
        if (video.current) video.current.srcObject = s;
      })
      .catch(() => setError('No camera access. Allow the camera for this site, or upload a photo instead.'));
    if (!navigator.mediaDevices) setError('This browser has no camera access. Upload a photo instead.');
    return () => {
      stopped = true;
      stream.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  function snap() {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const side = Math.min(v.videoWidth, v.videoHeight);
    const size = Math.min(640, side);
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d')!;
    // mirror, like the preview, so the team sees what they expect
    ctx.translate(size, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(v, (v.videoWidth - side) / 2, (v.videoHeight - side) / 2, side, side, 0, 0, size, size);
    setShot(c.toDataURL('image/jpeg', 0.85));
  }

  function countdown() {
    let n = 3;
    setCount(n);
    const t = setInterval(() => {
      n -= 1;
      if (n === 0) {
        clearInterval(t);
        setCount(null);
        snap();
      } else setCount(n);
    }, 800);
  }

  // portal: an animated (transformed) parent would otherwise trap the fixed overlay
  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 150, background: 'rgba(0,4,40,0.85)', display: 'grid', placeItems: 'center', padding: 16 }}>
      <div className="panel stack" style={{ width: '100%', maxWidth: 520, background: 'var(--navy-2)' }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <b>Team photo</b>
          <button className="btn small ghost" onClick={onClose}>Close</button>
        </div>
        {error ? (
          <div className="pill warn" style={{ whiteSpace: 'normal', padding: 12 }}>{error}</div>
        ) : (
          <div style={{ position: 'relative', aspectRatio: '1', borderRadius: 16, overflow: 'hidden', background: '#000' }}>
            {shot ? (
              <img src={shot} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <video ref={video} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }} />
            )}
            {count !== null && (
              <div key={count} className="count-num" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: 140, fontWeight: 800, textShadow: '0 4px 20px rgba(0,0,0,0.6)' }}>{count}</div>
            )}
          </div>
        )}
        {shot ? (
          <div className="row">
            <button className="btn secondary grow" onClick={() => setShot(null)}>Retake</button>
            <button className="btn mint grow" onClick={() => onCapture(shot)}>Use this photo</button>
          </div>
        ) : (
          !error && <button className="btn yellow big" onClick={countdown} disabled={count !== null}>📸 Take photo (3 sec)</button>
        )}
        <button className="btn small ghost" onClick={onPickFile}>Upload a photo instead</button>
      </div>
    </div>,
    document.body,
  );
}

/** Phones and tablets: use the native camera. */
export const prefersNativeCamera = () => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
