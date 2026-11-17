import { NextRequest, NextResponse } from 'next/server';
import { readScope } from '@/server/registry';
import { currentActor } from '@/server/session';
import { scopedStatement } from '@/server/queries';
import { toWire } from '@/server/kit';
import { audit } from '@/server/core';

export const dynamic = 'force-dynamic';
/** Scoped statement; an inaccessible ID is indistinguishable from an absent one (404). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await currentActor();
  if (!actor) return NextResponse.json({ error: { code: 'UNAUTHENTICATED' } }, { status: 401 });
  const { id } = await params;
  const s = await readScope(actor, async (t) => {
    const r = await scopedStatement(t, actor, id);
    await audit(t, actor, r ? 'statement.read' : 'denied:statement.read', 'purchase', /^[0-9a-f-]{36}$/.test(id) ? id : null);
    return r;
  });
  if (!s) return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'یافت نشد' } }, { status: 404 });
  return NextResponse.json(toWire({ purchase_id: s.purchase.id, creditor_id: s.purchase.current_owner_id, totals: s.totals, dpd: s.dpd,
    installments: s.installments.map((i) => ({ id: i.id, sequence: i.sequence, due_local_date: i.due_local_date, status: i.projected, principal_irr: i.principal_irr, commission_irr: i.commission_irr, residual: i.residual })) }));
}
