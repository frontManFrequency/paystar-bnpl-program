import { NextRequest, NextResponse } from 'next/server';
import { readScope } from '@/server/registry';
import { currentActor } from '@/server/session';
import { audit } from '@/server/core';
import { content } from '@/server/db';

export const dynamic = 'force-dynamic';
/** Purpose-scoped evidence access: owner customer, PayStar reviewer, or the assigned bank. Every read is audited; unsafe files are never served. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await currentActor();
  const { id } = await params;
  if (!actor || !/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ error: { code: 'NOT_FOUND' } }, { status: 404 });
  const r = await readScope(actor, async (t) => {
    const d = await t.one('SELECT d.*, a.creditor_id FROM documents d LEFT JOIN applications a ON a.id=d.application_id WHERE d.id=$1', [id]);
    if (!d) return null;
    const ok = (actor.role === 'customer' && d.customer_id === actor.customerId) || actor.role === 'paystar-admin' || (actor.role === 'bank' && d.creditor_id === actor.orgId);
    await audit(t, actor, ok ? 'document.read' : 'denied:document.read', 'document', id);
    if (!ok || d.scan_status !== 'CLEAN') return null;
    const up = await t.one('SELECT bytes FROM app_uploads WHERE id=$1', [id]);
    return { mime: d.mime_type, bytes: up ? Buffer.from(up.bytes) : Buffer.from(content().mock_document_asset.base64, 'base64') };
  });
  if (!r) return NextResponse.json({ error: { code: 'NOT_FOUND' } }, { status: 404 });
  return new NextResponse(new Uint8Array(r.bytes), { headers: { 'content-type': r.mime, 'cache-control': 'private, no-store' } });
}
