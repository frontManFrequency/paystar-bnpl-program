import { NextRequest, NextResponse } from 'next/server';
import { receiveWebhook } from '@/server/payments';
import { AppError } from '@/server/core';

export const dynamic = 'force-dynamic';
/** Provider callbacks: HMAC-SHA256 over `timestamp.rawBody`, 5-minute skew, inbox de-duplication. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  if (!['mock-pay', 'mock-bank'].includes(provider)) return NextResponse.json({ error: { code: 'UNKNOWN_PROVIDER' } }, { status: 404 });
  const raw = await req.text();
  try {
    const r = await receiveWebhook(provider, raw, req.headers.get('x-signature'), req.headers.get('x-timestamp'));
    return NextResponse.json(r, { status: 200 });
  } catch (e) {
    const err = e as AppError;
    return NextResponse.json({ error: { code: err.code ?? 'ERROR', message: err.message } }, { status: err.status ?? 500 });
  }
}
