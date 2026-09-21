import { NextResponse } from 'next/server';

function clean(value, limit) {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

export async function POST(request) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  console.error('[client-error]', JSON.stringify({
    kind: clean(payload?.kind, 80),
    message: clean(payload?.message, 500),
    stack: clean(payload?.stack, 4000),
    path: clean(payload?.path, 1000),
    occurredAt: new Date().toISOString(),
  }));

  return new NextResponse(null, { status: 204 });
}
