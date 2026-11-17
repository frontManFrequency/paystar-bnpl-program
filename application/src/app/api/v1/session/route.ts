import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { demoLogin, logout, actorFromToken } from '@/server/registry';
import { COOKIE } from '@/server/session';
import { AppError } from '@/server/core';
import { ROLE_HOME } from '@/lib/fmt';

export const dynamic = 'force-dynamic';
/** Prototype-only demo role session for a seeded user; role always derives from the stored membership. */
export async function POST(req: NextRequest) {
  const { key } = await req.json().catch(() => ({}));
  try {
    const token = await demoLogin(String(key ?? ''));
    const actor = await actorFromToken(token);
    const c = await cookies();
    const old = c.get(COOKIE)?.value;
    if (old) await logout(old);
    c.set(COOKIE, token, { httpOnly: true, sameSite: 'lax', path: '/', secure: req.nextUrl.protocol === 'https:' });
    return NextResponse.json({ ok: true, role: actor?.role, home: ROLE_HOME[actor!.role] });
  } catch (e) {
    const err = e as AppError;
    return NextResponse.json({ error: { code: err.code ?? 'ERROR', message: err.message } }, { status: err.status ?? 500 });
  }
}
export async function DELETE() {
  const c = await cookies();
  await logout(c.get(COOKIE)?.value);
  c.delete(COOKIE);
  return NextResponse.json({ ok: true });
}
