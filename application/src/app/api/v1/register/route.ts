import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { register } from '@/server/registry';
import { COOKIE } from '@/server/session';

export const dynamic = 'force-dynamic';
export async function POST(req: NextRequest) {
  const input = await req.json().catch(() => ({}));
  const r = await register(input);
  if (r.status === 200) {
    (await cookies()).set(COOKIE, String(r.body.token), { httpOnly: true, sameSite: 'lax', path: '/' });
    delete r.body.token;
  }
  return NextResponse.json(r.body, { status: r.status });
}
