'use client';

import { useEffect } from 'react';
import { reportClientError } from './ClientErrorReporter';

const RECOVERABLE_ASSET_ERROR = /ChunkLoadError|Loading chunk .* failed|Failed to fetch dynamically imported module|CSS_CHUNK_LOAD_FAILED/i;

export default function AppErrorFallback({ error, reset }) {
  useEffect(() => {
    reportClientError('react-error-boundary', error);

    if (!RECOVERABLE_ASSET_ERROR.test(String(error?.message || error || ''))) return;

    try {
      if (window.sessionStorage.getItem('wevic-client-recovery')) return;
      window.sessionStorage.setItem('wevic-client-recovery', '1');
      window.setTimeout(() => window.location.reload(), 150);
    } catch {
      // Show the manual recovery controls when storage is unavailable.
    }
  }, [error]);

  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: '#0b1020', color: '#f8fafc' }}>
      <section style={{ width: 'min(520px, 100%)', padding: 28, border: '1px solid #334155', borderRadius: 18, background: '#111827', textAlign: 'center' }}>
        <h1 style={{ marginTop: 0 }}>Không thể tải giao diện</h1>
        <p style={{ color: '#cbd5e1', lineHeight: 1.6 }}>
          Phiên làm việc hoặc tài nguyên trình duyệt có thể đã cũ. Hãy thử tải lại; dữ liệu trên máy chủ không bị ảnh hưởng.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button type="button" onClick={() => reset?.()} style={{ padding: '10px 16px', borderRadius: 10, cursor: 'pointer' }}>
            Thử lại
          </button>
          <button type="button" onClick={() => window.location.reload()} style={{ padding: '10px 16px', border: 0, borderRadius: 10, background: '#2563eb', color: 'white', cursor: 'pointer' }}>
            Tải lại trang
          </button>
        </div>
      </section>
    </main>
  );
}
