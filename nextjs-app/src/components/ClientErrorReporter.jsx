'use client';

import { useEffect } from 'react';

const sentErrors = new Set();

function errorDetails(value) {
  if (value instanceof Error) {
    return { message: value.message, stack: value.stack || '' };
  }
  return { message: String(value || 'Unknown client error'), stack: '' };
}

export function reportClientError(kind, value) {
  if (typeof window === 'undefined') return;

  const details = errorDetails(value);
  const signature = `${kind}:${details.message}:${window.location.pathname}`;
  if (sentErrors.has(signature)) return;
  sentErrors.add(signature);

  if (sentErrors.size > 50) {
    sentErrors.delete(sentErrors.values().next().value);
  }

  fetch('/api/client-errors', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    keepalive: true,
    body: JSON.stringify({
      kind,
      message: details.message.slice(0, 500),
      stack: details.stack.slice(0, 4000),
      path: `${window.location.pathname}${window.location.search}`.slice(0, 1000),
    }),
  }).catch(() => {});
}

export default function ClientErrorReporter() {
  useEffect(() => {
    const onError = (event) => {
      const assetUrl = event?.target?.src || event?.target?.href;
      reportClientError(assetUrl ? 'asset-error' : 'window-error', event.error || assetUrl || event.message);
    };
    const onUnhandledRejection = (event) => {
      reportClientError('unhandled-rejection', event.reason);
    };

    window.addEventListener('error', onError, true);
    window.addEventListener('unhandledrejection', onUnhandledRejection);

    const clearRecoveryMarker = window.setTimeout(() => {
      try {
        window.sessionStorage.removeItem('wevic-client-recovery');
      } catch {
        // Session storage can be disabled by browser privacy settings.
      }
    }, 10000);

    return () => {
      window.removeEventListener('error', onError, true);
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
      window.clearTimeout(clearRecoveryMarker);
    };
  }, []);

  return null;
}
