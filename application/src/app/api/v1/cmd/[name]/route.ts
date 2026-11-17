import { NextRequest, NextResponse } from 'next/server';
import { execute } from '@/server/registry';
import { currentActor } from '@/server/session';

export const dynamic = 'force-dynamic';
/** All browser mutations: same-origin check, verified session actor, Idempotency-Key. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const origin = req.headers.get('origin');
  if (origin && new URL(origin).host !== req.headers.get('host')) return NextResponse.json({ error: { code: 'CSRF', message: 'درخواست از مبدأ نامعتبر' } }, { status: 403 });
  const { name } = await params;
  let input: unknown = {};
  try { input = await req.json(); } catch { return NextResponse.json({ error: { code: 'MALFORMED', message: 'بدنه درخواست نامعتبر است.' } }, { status: 400 }); }
  const r = await execute(name, input, await currentActor(), req.headers.get('idempotency-key'));
  return NextResponse.json(r.body, { status: r.status });
}
