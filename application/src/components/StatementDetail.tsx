import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Actor } from '@/server/core';
import { readScope } from '@/server/registry';
import { scopedStatement, timeline, journalLines } from '@/server/queries';
import { audit } from '@/server/core';
import { Badge, Card, M, StatementView, Table, TimelineView, fa, jdate, short } from '@/components/ui';

/** One statement computation for every role; inaccessible IDs return 404 (no existence leak). */
export default async function StatementDetail({ id, actor, back }: { id: string; actor: Actor; back?: string }) {
  const d = await readScope(actor, async (t) => {
    const s = await scopedStatement(t, actor, id);
    await audit(t, actor, s ? 'statement.view' : 'denied:statement.view', 'purchase', /^[0-9a-f-]{36}$/.test(id) ? id : null);
    if (!s) return null;
    const tl = await timeline(t, actor, id);
    const checks = await t.q('SELECT c.*, b.name ben, h.name holder FROM checks c JOIN organizations b ON b.id=c.beneficiary_id JOIN organizations h ON h.id=c.custodian_id WHERE c.purchase_id=$1 ORDER BY expected_installment_sequence, created_at', [id]);
    const owners = await t.q('SELECT o.*, g.name FROM ownership_history o JOIN organizations g ON g.id=o.owner_id WHERE purchase_id=$1', [id]);
    const contract = await t.one('SELECT c.*, g.name creditor FROM contracts c JOIN organizations g ON g.id=c.creditor_id WHERE c.id=$1', [s.purchase.contract_id]);
    const allocations = await t.q('SELECT a.*, i.sequence, r.provider_reference FROM payment_allocations a JOIN installments i ON i.id=a.installment_id JOIN payment_receipts r ON r.id=a.receipt_id WHERE i.purchase_id=$1 ORDER BY r.received_at, i.sequence', [id]);
    const lines = actor.role === 'customer' || actor.role === 'business-admin' ? [] : await journalLines(t, tl.filter((x) => x.kind === 'سند حسابداری').map((x) => x.ref));
    const bankAck = await t.q("SELECT * FROM bank_instructions WHERE purchase_id=$1 ORDER BY created_at", [id]);
    return { s, tl, checks, owners, contract, allocations, lines, bankAck };
  });
  if (!d) notFound();
  const lastAck = [...d.bankAck].reverse().find((b: any) => b.acknowledged_balance_irr !== null);
  const pending = d.bankAck.filter((b: any) => b.status === 'PENDING');
  return <>
    {back && <Link className="ps-back" href={back}>→ بازگشت به فهرست</Link>}
    <h2>صورت‌حساب خرید <span className="ps-id">{short(id)}</span> <Badge s={d.s.purchase.status} /></h2>
    <p className="ps-small">مشتری: {d.s.purchase.customer_name} · کلینیک: {d.s.purchase.clinic_name} · طلبکار فعلی: <b>{d.s.purchase.creditor_name}</b> · قرارداد: {d.contract.contract_type} با {d.contract.creditor} ({jdate(d.contract.signed_at)}) · خدمت: <Badge s={d.s.purchase.service_status} /></p>
    <Card title="اجزای بدهی"><StatementView s={d.s} /></Card>
    <Card title="مانده نزد بانک">
      <p className="ps-small">آخرین مانده اصل تأییدشده بانک: {lastAck ? <M v={lastAck.acknowledged_balance_irr} /> : '—'} · مانده محاسبه‌شده پی‌استار: <M v={d.s.totals.outstandingPrincipal} />
        {pending.length > 0 && <> · <span className="ps-badge ps-badge--warning">اصلاحیه برگشت در انتظار تأیید بانک (مانده مورد انتظار <M v={pending[pending.length - 1].expected_balance_irr} />)</span></>}</p>
      <p className="ps-small ps-muted">دفتر رسمی بانک مرجع است؛ آینه محلی پی‌استار نمی‌تواند مانده بانک را ویرایش کند. اختلاف‌ها در تطبیق نمایش داده می‌شوند.</p>
    </Card>
    <Card title="چک‌ها و زنجیره امانت">
      <Table head={['قسط', 'صیاد', 'مبلغ', 'سررسید', 'ذی‌نفع', 'امانت‌دار', 'وضعیت']} rows={d.checks.map((c: any) => [fa(c.expected_installment_sequence), <span key="s" className="ps-id">{c.sayad_id_token}</span>, <M key="m" v={c.amount_irr} />, jdate(c.maturity_date), c.ben, c.holder, <Badge key="b" s={c.status} />])} />
      <p className="ps-small">مالکیت طلب: {d.owners.map((o: any) => `${o.name} از ${jdate(o.valid_from)}${o.valid_to ? ` تا ${jdate(o.valid_to)}` : ' (جاری)'}`).join('، ')} — بدون فروش یا انتقال.</p>
    </Card>
    <Card title="تخصیص پرداخت‌ها (اصل → کمیسیون → جریمه)">
      <Table head={['رسید', 'قسط', 'جزء', 'مبلغ']} rows={d.allocations.map((a: any) => [<span key="r" className="ps-id">{a.provider_reference}</span>, fa(a.sequence), a.component, <M key="m" v={a.amount_irr} />])} />
    </Card>
    <Card title="ردگیری: رویداد → رسید → سند → دستور بانکی"><TimelineView rows={d.tl} /></Card>
    {d.lines.length > 0 && <Card title="سطرهای سند (متوازن و غیرقابل ویرایش)">
      <Table head={['سند', 'حساب', 'بدهکار', 'بستانکار']} rows={d.lines.map((l: any) => [<span key="e" className="ps-id">{l.event_key}</span>, l.account_code, l.debit_irr ? <M key="d" v={l.debit_irr} /> : '', l.credit_irr ? <M key="c" v={l.credit_irr} /> : ''])} />
    </Card>}
  </>;
}
