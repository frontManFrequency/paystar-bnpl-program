import { NextResponse } from 'next/server';
import { readScope } from '@/server/registry';
import { currentActor } from '@/server/session';
import { audit } from '@/server/core';

export const dynamic = 'force-dynamic';
/** CSV export obeys the same scope as the screens: clinic → own orders only; bank → own-creditor purchases. */
export async function GET() {
  const actor = await currentActor();
  if (!actor || !['business-admin', 'bank', 'paystar-admin', 'super-admin'].includes(actor.role)) return NextResponse.json({ error: { code: 'FORBIDDEN' } }, { status: 403 });
  const rows = await readScope(actor, async (t) => {
    const where = actor.role === 'business-admin' ? 'p.business_id=$1' : actor.role === 'bank' ? 'p.current_owner_id=$1' : '$1::uuid IS NOT NULL';
    const r = await t.q(`SELECT p.id, o.external_reference, c.name AS clinic, p.principal_irr, p.commission_irr, p.status, p.service_status, p.confirmed_at
       FROM purchases p JOIN orders o ON o.id=(SELECT order_id FROM checkouts WHERE id=p.checkout_id) JOIN organizations c ON c.id=p.business_id WHERE ${where} ORDER BY p.confirmed_at`, [actor.orgId ?? '00000000-0000-0000-0000-000000000000']);
    await audit(t, actor, 'export.orders_csv', 'export', null, { rows: r.length });
    return r;
  });
  const head = 'purchase_id,order_reference,clinic,principal_irr,commission_irr,status,service_status,confirmed_at';
  const body = rows.map((r: any) => [r.id, r.external_reference, `"${r.clinic}"`, r.principal_irr, r.commission_irr, r.status, r.service_status, new Date(r.confirmed_at).toISOString()].join(','));
  return new NextResponse(['# DEMO / شبیه‌سازی — فاقد اثر مالی واقعی', head, ...body].join('\n'), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="orders-demo.csv"' } });
}
