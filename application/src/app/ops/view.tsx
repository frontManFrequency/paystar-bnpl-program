import Link from 'next/link';
import { requirePageRole } from '@/server/session';
import { readScope } from '@/server/registry';
import { accountBalance, clock, parties, dayDiff, tehranIso } from '@/server/core';
import { statement } from '@/server/services';
import Action from '@/components/Action';
import { SectionTiles } from '@/components/AppShell';
import { Badge, Card, Kpi, M, Table, fa, jdate, jdatetime, short, st } from '@/components/ui';

export default async function OpsView({ section }: { section: string }) {
  const show = (...k: string[]) => k.includes(section);
  const actor = await requirePageRole('paystar-admin');
  const d = await readScope(actor, async (t) => {
    const now = await clock(t);
    const { paystar, bank } = await parties(t);
    const apps = await t.q(`SELECT a.*, u.display_name, cu.kyc_status, cu.verified_monthly_income_irr, cu.external_monthly_obligations_irr, r.business_id, b.name clinic,
        (SELECT risk_band FROM assessments s WHERE s.application_id=a.id ORDER BY assessed_at DESC LIMIT 1) band,
        (SELECT assessed_at FROM assessments s WHERE s.application_id=a.id ORDER BY assessed_at DESC LIMIT 1) assessed_at,
        (SELECT count(*)::int FROM consents c WHERE c.customer_id=a.customer_id AND c.withdrawn_at IS NULL) consents,
        (SELECT count(*)::int FROM bank_accounts ba WHERE ba.owner_user_id=cu.user_id AND ba.owner_match) accounts
      FROM applications a JOIN customers cu ON cu.id=a.customer_id JOIN users u ON u.id=cu.user_id JOIN referrals r ON r.id=a.referral_id JOIN organizations b ON b.id=r.business_id ORDER BY a.updated_at DESC`);
    const docs = await t.q('SELECT id, application_id, category, scan_status, created_at FROM documents ORDER BY created_at');
    const purchases = []; for (const p of await t.q('SELECT id FROM purchases ORDER BY confirmed_at DESC')) purchases.push((await statement(t, p.id))!);
    const pending = await t.q("SELECT pi.*, u.display_name FROM payment_intents pi JOIN customers c ON c.id=pi.customer_id JOIN users u ON u.id=c.user_id WHERE pi.status IN ('UNKNOWN','PENDING') ORDER BY pi.created_at");
    const recent = await t.q("SELECT pi.*, u.display_name FROM payment_intents pi JOIN customers c ON c.id=pi.customer_id JOIN users u ON u.id=c.user_id WHERE pi.status='SUCCEEDED' AND pi.provider_intent_ref LIKE 'MOCK-%-%' ORDER BY pi.updated_at DESC LIMIT 8");
    const unapplied = await t.q("SELECT * FROM payment_receipts WHERE status IN ('UNAPPLIED','PARTIALLY_UNAPPLIED')");
    const inbox = await t.q('SELECT provider, event_key, status, created_at FROM webhook_inbox ORDER BY created_at DESC LIMIT 10');
    const settlements = await t.q("SELECT s.*, c.name clinic FROM settlements s JOIN organizations c ON c.id=s.to_party_id ORDER BY s.created_at DESC");
    const refunds = await t.q('SELECT r.*, u.display_name FROM refunds r JOIN purchases p ON p.id=r.purchase_id JOIN customers c ON c.id=p.customer_id JOIN users u ON u.id=c.user_id ORDER BY r.created_at DESC');
    const amend = await t.q("SELECT * FROM bank_instructions WHERE instruction_type='REFUND_AMENDMENT' AND status='PENDING'");
    const wallets = await t.q('SELECT w.*, u.display_name FROM wallets w JOIN customers c ON c.id=w.customer_id JOIN users u ON u.id=c.user_id WHERE liability_irr>0 OR held_irr>0');
    const withdrawals = await t.q("SELECT * FROM withdrawals WHERE status IN ('UNKNOWN','SUBMITTED')");
    const cases = await t.q(`SELECT cc.*, u.display_name customer, (SELECT count(*)::int FROM collection_actions a WHERE a.case_id=cc.id) actions FROM collection_cases cc JOIN purchases p ON p.id=cc.purchase_id JOIN customers c ON c.id=p.customer_id JOIN users u ON u.id=c.user_id WHERE cc.stage<>'CLOSED' ORDER BY cc.dpd DESC`);
    const support = await t.q("SELECT s.*, u.display_name FROM support_cases s JOIN customers c ON c.id=s.customer_id JOIN users u ON u.id=c.user_id ORDER BY s.created_at DESC");
    const run = await t.one('SELECT * FROM reconciliation_runs ORDER BY updated_at DESC LIMIT 1');
    const items = run ? await t.q('SELECT * FROM reconciliation_items WHERE run_id=$1 ORDER BY created_at', [run.id]) : [];
    const bridge = await accountBalance(t, paystar, 'REFUND_BRIDGE_CASH');
    const partner = await accountBalance(t, paystar, 'PARTNER_RECOVERY');
    const feeRev = -(await accountBalance(t, paystar, 'ASSESSMENT_REVENUE'));
    const invoices = await t.one("SELECT COALESCE(sum(net_irr-reversed_irr),0)::bigint s FROM invoices WHERE payee_id=$1", [paystar]);
    return { now, bank, apps, docs, purchases, pending, recent, unapplied, inbox, settlements, refunds, amend, wallets, withdrawals, cases, support, run, items, bridge, partner, feeRev, invoiceNet: invoices.s };
  });
  const review = d.apps.filter((a: any) => a.status === 'PAYSTAR_REVIEW');
  const atBank = d.apps.filter((a: any) => a.status === 'CREDITOR_REVIEW');
  const today = tehranIso(d.now);
  return <>
    {show('overview') && <>
    <div className="ps-grid">
      <Kpi l="صف بررسی پی‌استار" v={fa(review.length)} s="SLA دو روز کاری" />
      <Kpi l="در انتظار تصمیم بانک" v={fa(atBank.length)} />
      <Kpi l="پرداخت‌های نامعلوم" v={fa(d.pending.length)} />
      <Kpi l="مانده پل بازپرداخت" v={<M v={d.bridge} />} s={<>مطالبه از شرکا: <M v={d.partner} /></>} />
      <Kpi l="درآمد هزینه استعلام" v={<M v={d.feeRev} />} />
      <Kpi l="کارمزد خدمات از بانک (خالص)" v={<M v={d.invoiceNet} />} s="جدا از بدهی مشتری" />
    </div>

    </>}
    {show('overview') && <SectionTiles role="paystar-admin" counts={{ applications: fa(review.length), payments: fa(d.pending.length), collections: fa(d.cases.length), support: fa(d.support.filter((s: any) => s.status === 'OPEN').length) }} />}
    {show('applications', 'overview') && <>
    <Card id="review" title="بررسی مقدماتی (پیشنهاد؛ تصمیم نهایی با بانک)">
      {review.length === 0 && <p className="ps-small ps-muted">پرونده‌ای در صف بررسی پی‌استار نیست.</p>}
      {review.map((a: any) => <div key={a.id} className="ps-card">
        <h3>{a.display_name} · معرف: {a.clinic} · <span className="ps-id">{short(a.id)}</span></h3>
        <Table head={['مبلغ درخواستی', 'تعداد اقساط', 'هویت', 'رضایت‌ها', 'حساب', 'باند', 'ارزیابی', 'درآمد', 'ظرفیت ماهانه (۳۰٪)', 'پیشنهاد سقف', 'مدارک']} rows={[[a.requested_limit_irr ? <M key="q" v={a.requested_limit_irr} /> : '—', `${fa(Number(a.installment_count ?? 4))} قسط`, a.kyc_status, fa(a.consents), a.accounts ? 'تطبیق' : 'ندارد', a.band ?? '—', jdate(a.assessed_at), <M key="i" v={a.verified_monthly_income_irr} />,
          <M key="c" v={BigInt(a.verified_monthly_income_irr) * 30n / 100n - BigInt(a.external_monthly_obligations_irr)} />, <M key="r" v={a.recommended_limit_irr} />,
          d.docs.filter((x: any) => x.application_id === a.id).map((x: any) => <div key={x.id}><a href={`/api/v1/documents/${x.id}`} target="_blank">{x.category}</a> <span className="ps-small">{x.scan_status}</span></div>)]]} />
        <Action command="review.paystar" label="ثبت بررسی" fixed={{ application_id: a.id, version: String(a.version) }}
          fields={[{ name: 'outcome', label: 'نتیجه', type: 'select', options: [{ value: 'APPROVE', label: 'تأیید مقدماتی و ارسال به بانک' }, { value: 'CORRECTION', label: 'درخواست اصلاح' }, { value: 'REJECT', label: 'رد' }] },
            { name: 'reason_code', label: 'کد دلیل' }, { name: 'customer_message', label: 'پیام به مشتری', type: 'textarea' }, { name: 'fields', label: 'موارد اصلاح', placeholder: 'income_document' }]} />
      </div>)}
      <h3>پرونده‌های در انتظار بانک</h3>
      <Table head={['متقاضی', 'پیشنهاد', 'به‌روزرسانی', 'آزمون اختیار']} rows={atBank.map((a: any) => [a.display_name, <M key="m" v={a.recommended_limit_irr} />, jdatetime(a.updated_at),
        <Action key="x" command="decision.bank_final" label="تلاش برای تأیید نهایی توسط پی‌استار" fixed={{ application_id: a.id, outcome: 'APPROVE' }} tone="danger" inline />])} empty="—" />
      <details className="ps-accordion"><summary>همه درخواست‌ها</summary><Table head={['متقاضی', 'وضعیت', 'مرحله بازگشت', 'به‌روزرسانی']} rows={d.apps.map((a: any) => [a.display_name, <Badge key="b" s={a.status} />, a.resume_stage ?? '—', jdatetime(a.updated_at)])} /></details>
    </Card>

    </>}
    {show('purchases') && <>
    <Card id="purchases" title="خریدها (طلبکار: بانک)">
      <Table head={['مشتری', 'کلینیک', 'اصل', 'مانده اصل', 'DPD', 'وضعیت', 'خدمت', '']} rows={d.purchases.map((s: any) => [s.purchase.customer_name, s.purchase.clinic_name, <M key="p" v={s.totals.principal} />, <M key="o" v={s.totals.outstandingPrincipal} />, fa(s.dpd), <Badge key="b" s={s.purchase.status} />, <Badge key="v" s={s.purchase.service_status} />, <Link key="l" href={`/ops/purchases/${s.purchase.id}`}>ردگیری</Link>])} />
    </Card>

    </>}
    {show('payments') && <>
    <Card id="payments" title="پرداخت‌ها، callbackها و وجوه اعمال‌نشده">
      <p className="ps-small ps-muted">دکمه «پرداخت شد» وجود ندارد. وضعیت نامعلوم فقط با استعلام از ارائه‌دهنده یا callback امضاشده قطعی می‌شود.</p>
      <h3>در انتظار نتیجه</h3>
      <Table head={['مشتری', 'هدف', 'مرجع', 'مبلغ', 'وضعیت', '']} rows={d.pending.map((i: any) => [i.display_name, st(i.purpose), <span key="r" className="ps-id">{i.provider_intent_ref}</span>, <M key="m" v={i.amount_irr} />, <Badge key="b" s={i.status} />, <Action key="a" command="payment.inquire" label="استعلام" fixed={{ intent_id: i.id }} inline tone="neutral" />])} empty="پرداخت نامعلومی نیست." />
      <h3>آزمون callback تکراری</h3>
      <Table head={['مشتری', 'هدف', 'مرجع', 'مبلغ', '']} rows={d.recent.map((i: any) => [i.display_name, st(i.purpose), <span key="r" className="ps-id">{i.provider_intent_ref}</span>, <M key="m" v={i.amount_irr} />, <Action key="a" command="payment.replay_webhook" label="بازپخش رویداد" fixed={{ intent_id: i.id }} inline tone="neutral" />])} empty="پرداخت موفق جدیدی نیست." />
      <h3>وجوه اعمال‌نشده (بدهی به مشتری)</h3>
      <Table head={['مرجع', 'مبلغ', 'وضعیت']} rows={d.unapplied.map((u: any) => [<span key="r" className="ps-id">{u.provider_reference}</span>, <M key="m" v={u.amount_irr} />, <Badge key="b" s={u.status} />])} empty="—" />
      <details className="ps-accordion"><summary>صندوق ورودی وب‌هوک</summary><Table head={['ارائه‌دهنده', 'رویداد', 'وضعیت', 'زمان']} rows={d.inbox.map((w: any) => [w.provider, <span key="k" className="ps-id">{w.event_key}</span>, w.status, jdatetime(w.created_at)])} /></details>
    </Card>

    </>}
    {show('settlements') && <>
    <Card id="settlements" title="تسویه کلینیک (پرداخت‌کننده: بانک)">
      <p className="ps-small ps-muted">پی‌استار نمی‌تواند واریز بانک را ثبت کند. پس از ۲ روز کاری، موضوع به بانک و کلینیک ارجاع می‌شود.</p>
      <Table head={['کلینیک', 'مبلغ', 'سررسید', 'سن (روز)', 'وضعیت', '']} rows={d.settlements.map((s: any) => [s.clinic, <M key="m" v={s.amount_irr} />, jdatetime(s.due_at), fa(Math.max(0, dayDiff(today, tehranIso(new Date(s.created_at))))), <Badge key="b" s={s.status} />,
        ['UNKNOWN', 'SUBMITTED'].includes(s.status) ? <Action key="a" command="disbursement.inquire" label="استعلام" fixed={{ settlement_id: s.id }} inline tone="neutral" /> : ''])} />
    </Card>

    </>}
    {show('refunds') && <>
    <Card id="refunds" title="برگشت‌ها، اصلاحیه بانک و کیف بازپرداخت">
      <Table head={['مشتری', 'برگشت تجمعی اصل', 'بازپرداخت به کیف', 'وضعیت', 'زمان']} rows={d.refunds.map((r: any) => [r.display_name, <M key="c" v={r.cumulative_principal_irr} />, <M key="w" v={r.wallet_entitlement_irr} />, <Badge key="b" s={r.status} />, jdatetime(r.posted_at ?? r.created_at)])} empty="برگشتی ثبت نشده است." />
      <p className="ps-small">اصلاحیه‌های در انتظار تأیید بانک: {fa(d.amend.length)}</p>
      <Table head={['مشتری', 'طلب', 'پشتوانه‌دار', 'در حال برداشت']} rows={d.wallets.map((w: any) => [w.display_name, <M key="l" v={w.liability_irr} />, <M key="f" v={w.funded_irr} />, <M key="h" v={w.held_irr} />])} empty="—" />
      <Table head={['برداشت نامعلوم', 'مبلغ', '']} rows={d.withdrawals.map((w: any) => [<span key="r" className="ps-id">{w.provider_reference}</span>, <M key="m" v={w.amount_irr} />, <Action key="a" command="wallet.inquire" label="استعلام" fixed={{ withdrawal_id: w.id }} inline tone="neutral" />])} empty="برداشت در انتظاری نیست." />
    </Card>

    </>}
    {show('collections') && <>
    <Card id="collections" title="پیگیری نرم (تا DPD29 به نمایندگی از بانک)">
      <Table head={['مشتری', 'DPD', 'مرحله', 'اقدامات', '']} rows={d.cases.map((c: any) => [c.customer, fa(c.dpd), <Badge key="b" s={c.stage} />, fa(c.actions),
        c.dpd < 30 ? <Action key="a" command="collections.log_contact" label="ثبت تماس" fixed={{ case_id: c.id }} inline fields={[{ name: 'result_code', label: 'نتیجه', type: 'select', options: [{ value: 'PROMISE_TO_PAY', label: 'قول پرداخت' }, { value: 'NO_ANSWER', label: 'پاسخ نداد' }] }, { name: 'notes', label: 'یادداشت' }]} />
          : <span key="h" className="ps-small">ارجاع‌شده به حقوقی بانک؛ پی‌استار فقط پشتیبانی/نمایش</span>])} empty="پرونده بازی نیست." />
    </Card>

    </>}
    {show('support') && <>
    <Card id="support" title="پشتیبانی، اختلاف و اعتراض">
      <Table head={['مشتری', 'نوع', 'شرح', 'وضعیت', 'مهلت', '']} rows={d.support.map((s: any) => [s.display_name, s.case_type, s.summary, <Badge key="b" s={s.status} />, jdatetime(s.due_at),
        s.status === 'OPEN' ? <Action key="a" command="support.resolve" label={s.case_type === 'HARDSHIP' ? 'ارسال به بانک' : 'ثبت پاسخ'} fixed={{ case_id: s.id }} inline fields={[{ name: 'resolution', label: 'پاسخ/یادداشت' }]} /> : ''])} />
      <p className="ps-small ps-muted">اختلاف خدمت به کلینیک ارجاع می‌شود؛ اپراتور نمی‌تواند برگشت مالی ایجاد کند.</p>
    </Card>

    </>}
    {show('recon') && <>
    <Card id="recon" title="تطبیق روزانه حساب وصول بانک و کیف">
      <Action command="recon.run" label="اجرای تطبیق امروز" />
      {d.run && <>
        <p className="ps-small">تاریخ {d.run.business_date.toISOString?.().slice(0, 10) ?? String(d.run.business_date)} · <Badge s={d.run.status} /> · افتتاحیه <M v={d.run.opening_irr} /> + ورودی <M v={d.run.inflow_irr} /> − خروجی <M v={d.run.outflow_irr} /> = پایانی <M v={d.run.closing_irr} /></p>
        <Table head={['مرجع', 'نوع مغایرت', 'مبلغ', 'وضعیت']} rows={d.items.map((i: any) => [<span key="r" className="ps-id">{i.provider_reference}</span>, i.exception_type, <M key="m" v={i.amount_irr} />, <Badge key="b" s={i.status} />])} empty="بدون مغایرت." />
      </>}
    </Card>
    </>}
  </>;
}
