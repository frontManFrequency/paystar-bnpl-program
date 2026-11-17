import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { reset } from '@/server/registry';
import { currentActor, COOKIE } from '@/server/session';
import { AppError } from '@/server/core';

export const dynamic = 'force-dynamic';
export async function POST(req: NextRequest) {
  const { phrase } = await req.json().catch(() => ({}));
  try {
    await reset(await currentActor(), String(phrase ?? ''));
    (await cookies()).delete(COOKIE);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const err = e as AppError;
    return NextResponse.json({ error: { code: err.code ?? 'ERROR', message: err.message } }, { status: err.status ?? 500 });
  }
}
