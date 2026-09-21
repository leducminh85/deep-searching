'use client';

import AppErrorFallback from '../components/AppErrorFallback';

export default function GlobalError({ error, reset }) {
  return (
    <html lang="vi">
      <body>
        <AppErrorFallback error={error} reset={reset} />
      </body>
    </html>
  );
}
