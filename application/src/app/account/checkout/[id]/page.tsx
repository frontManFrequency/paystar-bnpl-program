import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requirePageRole } from '@/server/session';
import { readScope } from '@/server/registry';
import { parties } from '@/server/core';
import Action from '@/components/Action';
import { Badge, Card, M, Table, fa, jdatetime, short } from '@/components/ui';

export const dynamic = 'force-dynamic';
export default async function Checkout({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePageRole('customer');
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const d = await readScope(actor, async (t) => {
    const co = await t.one('SELECT c.*, o.customer_id, o.external_reference, o.cash_contribution_irr, b.name AS clinic FROM checkouts c JOIN orders o ON o.id=c.order_id JOIN organizations b ON b.id=o.business_id WHERE c.id=$1', [id]);
    if (!co || co.customer_id !== actor.customerId) return null;
    const { bank, paystar } = await parties(t);
    const orgs = await t.q('SELECT id, name FROM organizations WHERE id IN ($1,$2,$3)', [bank, paystar, co.order_id ? (await t.one('SELECT business_id FROM orders WHERE id=$1', [co.order_id])).business_id : bank]);
    const contract = await t.one("SELECT * FROM contracts WHERE checkout_id=$1 AND status='SIGNED'", [id]);
    const checks = await t.q('SELECT * FROM checks WHERE checkout_id=$1 ORDER BY expected_installment_sequence', [id]);
    const intents = await t.q('SELECT * FROM payment_intents WHERE checkout_id=$1 ORDER BY created_at DESC', [id]);
    const purchase = await t.one('SELECT id FROM purchases WHERE checkout_id=$1', [id]);
    return { co, bank, orgs, contract, checks, intents, purchase };
  });
  if (!d) notFound();
  const q = d.co.quote_snapshot;
  const bankName = d.orgs.find((o: any) => o.id === d.bank)?.name;
  const benOptions = d.orgs.map((o: any) => ({ value: o.id, label: o.name }));
  benOptions.sort((a: any) => (a.value === d.bank ? -1 : 1));
  return <>
    <h2>وضعیت پیش‌فاکتور <Badge s={d.co.status} /></h2>
    <p className="ps-small"><Link className="ps-back" href="/account/purchases">→ بازگشت به خریدها</Link> · مهلت پیش‌فاکتور: {jdatetime(d.co.expires_at)} (۱۵ دقیقه، ساعت نمایشی)</p>
    {d.purchase && <div className="ps-alert ps-alert--success ps-alert--block">خرید تأیید شد. <Link href={`/account/purchases/${d.purchase.id}`}>مشاهده صورت‌حساب</Link> — شروع خدمت فقط پس از تأیید واریز بانک به کلینیک.</div>}
    <Card title="شرایط ثابت‌شده (هش پیش‌فاکتور)">
      <p className="ps-small">کلینیک: {d.co.clinic} · خدمت: {q.service} · اعتباردهنده: <b>{bankName}</b> · ذی‌نفع چک: <b>{bankName}</b> · سیاست: {q.policy} · هش <span className="ps-id">{short(d.co.quote_hash)}</span></p>
      <Table head={['قسط', 'سررسید', 'اصل', 'کمیسیون', 'جمع']} rows={q.installments.map((i: any) => [fa(i.sequence), fa(i.due_local_date), <M key="p" v={i.principal_irr} />, <M key="c" v={i.commission_irr} />, <M key="t" v={i.total_irr} />])} />
      <p className="ps-small">اصل اقساطی: <M v={q.principal_irr} /> · کمیسیون: <M v={q.commission_irr} /> · جمع: <M v={q.total_irr} /> · سهم نقدی جداگانه به کلینیک: <M v={q.cash_contribution_irr} /> · هزینه استعلام (جدا): <M v={q.assessment_fee_irr} /></p>
      <p className="ps-small ps-muted">کمیسیون ثابت ۱۲٪ است نه ماهانه؛ معادل نرخ سود سالانه نیست. در برگشت خدمت، مبالغ پرداخت‌شده به کیف بازپرداخت و مبالغ آتی لغو می‌شوند.</p>
    </Card>
    <Card title="۱. قرارداد اعتبار خرید با بانک">
      <div className="ps-document"><span className="ps-document__watermark" aria-hidden="true">نمونه</span>
        <p className="ps-small">وام‌گیرنده: شما · وام‌دهنده و طلبکار: {bankName} · کلینیک: {d.co.clinic} · خدمات‌دهنده: پی‌استار (نماینده بانک) · {fa(q.installments.length)} قسط بالا · مقصد پرداخت: حساب وصول بانک · تسویه زودهنگام: مانده اصل + کمیسیون زمان‌بندی‌شده باقی‌مانده · جریمه دیرکرد: صفر · چک‌ها: سه فقره به نام بانک · وصول حقوقی فقط با مجوز بانک.</p>
      </div>
      {d.contract ? <div className="ps-alert ps-alert--success ps-alert--block">امضا شد · هش سند <span className="ps-id">{short(d.contract.document_hash)}</span></div> :
        d.co.status === 'RESERVED' && <Action command="checkout.sign_contract" label="امضای قرارداد خرید" fixed={{ checkout_id: id }} fields={[{ name: 'accept', label: 'متن قرارداد را خواندم و امضا می‌کنم (امضای نمایشی)', type: 'checkbox' }]} />}
    </Card>
    <Card title={`۲. ${fa(q.installments.length - 1)} چک صیادی به نام بانک`}>
      <p className="ps-small ps-muted">چک را از کانال مجاز بانکی/صیاد صادر کنید و شناسه را وارد کنید. ورود شناسه به معنی ثبت واقعی در صیاد نیست؛ پذیرش و امانت را بانک تأیید می‌کند.</p>
      <Table head={['قسط', 'شناسه صیاد', 'مبلغ', 'ذی‌نفع', 'وضعیت']} rows={d.checks.map((c: any) => [fa(c.expected_installment_sequence), <span key="s" className="ps-id">{c.sayad_id_token}</span>, <M key="m" v={c.amount_irr} />, bankName, <Badge key="b" s={c.status} />])} empty="هنوز چکی ثبت نشده است." />
      {d.co.status === 'RESERVED' && d.checks.length < q.installments.length - 1 && <Action command="checkout.register_checks" label="ثبت چک‌ها" fixed={{ checkout_id: id }}
        fields={[{ name: 'checks', label: 'چک‌ها', type: 'checks', options: benOptions, checks: q.installments.slice(1).map((i: any) => ({ sequence: i.sequence, total_irr: i.total_irr, due: fa(i.due_local_date) })) }]} />}
      {d.checks.some((c: any) => c.status === 'REGISTERED') && <div className="ps-alert ps-alert--block">در انتظار پذیرش چک‌ها توسط بانک.</div>}
    </Card>
    <Card title="۳. پرداخت قسط اول به حساب بانک">
      {d.intents.map((i: any) => <div key={i.id} className="ps-actions ps-small">پرداخت <span className="ps-id">{i.provider_intent_ref}</span> <M v={i.amount_irr} /> <Badge s={i.status} />
        {['UNKNOWN', 'PENDING'].includes(i.status) && <Action command="payment.inquire" label="استعلام وضعیت" fixed={{ intent_id: i.id }} tone="neutral" inline />}</div>)}
      {d.co.status === 'CONTRACT_READY' ? <Action command="payment.start" label={`پرداخت قسط اول`} fixed={{ checkout_id: id }}
        scenarios={[{ value: 'success', label: 'موفق' }, { value: 'unknown', label: 'نامعلوم' }, { value: 'failed', label: 'ناموفق' }, { value: 'duplicate', label: 'موفق + callback تکراری' }]}
        confirm={`پرداخت قسط اول به حساب وصول ${bankName}. بازگشت از درگاه به‌تنهایی تأیید پرداخت نیست.`} />
        : !d.purchase && <p className="ps-small ps-muted">پرداخت پس از امضای قرارداد و پذیرش همه چک‌ها توسط بانک فعال می‌شود.</p>}
      {['RESERVED', 'CONTRACT_READY'].includes(d.co.status) && <Action command="checkout.cancel" label="انصراف از خرید" fixed={{ checkout_id: id }} tone="danger" confirm="رزرو اعتبار آزاد می‌شود." />}
    </Card>
  </>;
}
