'use client';

import AppErrorFallback from '../components/AppErrorFallback';

export default function ErrorPage({ error, reset }) {
  return <AppErrorFallback error={error} reset={reset} />;
}
