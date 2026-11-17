import Link from 'next/link';
import { requirePageRole } from '@/server/session';
import { readScope } from '@/server/registry';
import { content } from '@/server/db';
import { clock, parties } from '@/server/core';
import { lineState, statement } from '@/server/services';
import Action from '@/components/Action';
import { SectionTiles } from '@/components/AppShell';
import QuickApply from '@/components/QuickApply';
import { toman } from '@/lib/fmt';
import { Badge, Card, Kpi, M, StatementView, Table, Empty, jdate, jdatetime, fa, st, short } from '@/components/ui';

const PAY_SCENARIOS = [{ value: 'success', label: 'موفق' }, { value: 'unknown', label: 'نامعلوم (بعداً استعلام)' }, { value: 'failed', label: 'ناموفق' }, { value: 'duplicate', label: 'موفق + callback تکراری' }];
const FLOW = ['DRAFT', 'IDENTITY_PENDING', 'FEE_PENDING', 'ASSESSMENT_PENDING', 'PAYSTAR_REVIEW', 'CREDITOR_REVIEW', 'APPROVED', 'ACTIVE'];
const NEXT: Record<string, string> = {
  DRAFT: 'کد تأیید و رضایت‌ها را ثبت کنید.', IDENTITY_PENDING: 'تطبیق کارت، بارگذاری مدارک و ارسال.', FEE_PENDING: 'پرداخت هزینه استعلام.', ASSESSMENT_PENDING: 'درخواست گزارش اعتباری.',
  EXTERNAL_PENDING: 'منتظر پاسخ سرویس اعتبارسنجی؛ تلاش مجدد بدون هزینه دوباره.', PAYSTAR_REVIEW: 'کارشناس پی‌استار پرونده را بررسی می‌کند (حداکثر ۲ روز کاری).',
  CREDITOR_REVIEW: 'بانک تصمیم نهایی را می‌گیرد (حداکثر ۲ روز کاری). پی‌استار نمی‌تواند تأیید بانک را تضمین کند.', NEEDS_CORRECTION: 'فقط موارد خواسته‌شده را اصلاح کنید.',
  APPROVED: 'قرارداد اعتبار بانک را امضا کنید.', ACTIVE: 'اعتبار فعال است.', REJECTED: 'امکان اعتراض از طریق پشتیبانی.',
};
const OWNER: Record<string, string> = { PAYSTAR_REVIEW: 'پی‌استار', CREDITOR_REVIEW: 'بانک', NEEDS_CORRECTION: 'شما', APPROVED: 'شما' };

export default async function AccountView({ section }: { section: string }) {
  const show = (...k: string[]) => k.includes(section);
  const actor = await requirePageRole('customer');
  const d = await readScope(actor, async (t) => {
    const cid = actor.customerId!;
    const now = await clock(t);
    const { bank } = await parties(t);
    const apps = await t.q('SELECT * FROM applications WHERE customer_id=$1 ORDER BY created_at DESC', [cid]);
    const decisions = await t.q('SELECT * FROM decisions WHERE application_id = ANY($1) ORDER BY created_at', [apps.map((a: any) => a.id)]);
    const docs = await t.q('SELECT id, application_id, category, scan_status, size_bytes, created_at FROM documents WHERE customer_id=$1 ORDER BY created_at', [cid]);
    const lines = await t.q('SELECT id FROM credit_lines WHERE customer_id=$1 ORDER BY created_at DESC', [cid]);
    const lineStates = []; for (const l of lines) lineStates.push(await lineState(t, l.id));
    const purchases = await t.q('SELECT id FROM purchases WHERE customer_id=$1 ORDER BY confirmed_at DESC', [cid]);
    const stmts = []; for (const p of purchases) stmts.push((await statement(t, p.id))!);
    const checkouts = await t.q("SELECT c.*, o.external_reference, b.name AS clinic FROM checkouts c JOIN orders o ON o.id=c.order_id JOIN organizations b ON b.id=o.business_id WHERE o.customer_id=$1 AND c.status IN ('RESERVED','CONTRACT_READY','PAYMENT_PENDING') ORDER BY c.created_at DESC", [cid]);
    const intents = await t.q("SELECT * FROM payment_intents WHERE customer_id=$1 ORDER BY created_at DESC LIMIT 20", [cid]);
    const wallet = await t.one('SELECT * FROM wallets WHERE customer_id=$1', [cid]);
    const withdrawals = wallet ? await t.q('SELECT w.*, b.card_last4 FROM withdrawals w JOIN bank_accounts b ON b.id=w.bank_account_id WHERE wallet_id=$1 ORDER BY w.created_at DESC', [wallet.id]) : [];
    const entries = wallet ? await t.q('SELECT * FROM wallet_entries WHERE wallet_id=$1 ORDER BY created_at DESC', [wallet.id]) : [];
    const unapplied = await t.q("SELECT pr.* FROM payment_receipts pr JOIN payment_intents pi ON pi.id=pr.intent_id WHERE pi.customer_id=$1 AND pr.status IN ('UNAPPLIED','PARTIALLY_UNAPPLIED')", [cid]);
    const accounts = await t.q('SELECT id, card_last4, bank_name, cooling_until FROM bank_accounts WHERE owner_user_id=$1 AND owner_match', [actor.userId]);
    const cases = await t.q('SELECT * FROM support_cases WHERE customer_id=$1 ORDER BY created_at DESC', [cid]);
    const notes = await t.q('SELECT * FROM notifications WHERE user_id=$1 ORDER BY send_at DESC LIMIT 12', [actor.userId]);
    const cust = await t.one('SELECT kyc_status, identity_details FROM customers WHERE id=$1', [cid]);
    const bankName = (await t.one('SELECT name FROM organizations WHERE id=$1', [bank]))?.name;
    const cases2 = await t.q('SELECT purchase_id, stage, dpd FROM collection_cases WHERE purchase_id = ANY($1)', [purchases.map((p: any) => p.id)]);
    const amend = await t.q("SELECT purchase_id, status, expected_balance_irr, acknowledged_balance_irr FROM bank_instructions WHERE purchase_id = ANY($1) AND instruction_type='REFUND_AMENDMENT' AND status='PENDING'", [purchases.map((p: any) => p.id)]);
    return { now, bank, bankName, apps, decisions, docs, lineStates, stmts, checkouts, intents, wallet, withdrawals, entries, unapplied, accounts, cases, notes, cust, cases2, amend };
  });
  const consents = content().consents as any[];
  const app = d.apps[0];
  const openLine = d.lineStates.some((l: any) => ['ACTIVE', 'HELD', 'APPROVED_PENDING_CONTRACT'].includes(l.line.status) && !l.expired);
  const canStart = !openLine && (!app || ['CANCELLED', 'EXPIRED', 'ACTIVE'].includes(app.status) || (app.status === 'REJECTED' && (!app.reapply_at || new Date(app.reapply_at) <= d.now)));
  const consentOpts = consents.map((c) => ({ value: c.purpose, label: c.title, text: c.text }));
  const pendingIntents = d.intents.filter((i: any) => ['UNKNOWN', 'PENDING'].includes(i.status));
  return <>
    {show('overview') && <SectionTiles role="customer" counts={{ purchases: fa(d.stmts.length), support: fa(d.cases.length) }} />}
    {show('application', 'overview') && <>
    {canStart && <Card title="درخواست اعتبار جدید">
      <p className="ps-small">اعتبار خرید اقساطی خدمات درمانی تا سقف ۴۰ میلیون تومان، با تصمیم نهایی بانک. فرم زیر را تکمیل و ارسال کنید.</p>
      <QuickApply applicationId={null} consents={consentOpts} feeToman={toman('500000')} />
    </Card>}
    {app && !(canStart && app.status === 'ACTIVE') && <Card title={<>درخواست اعتبار <Badge s={app.status} /></>}>
      <ol className="ps-stepper">{FLOW.flatMap((s, i) => { const idx = FLOW.indexOf(app.status); const done = idx >= 0 && i < idx; const cur = s === app.status;
        return [i > 0 ? <li key={'l' + s} className={`ps-stepper__line${idx >= 0 && i <= idx ? ' ps-stepper__line--done' : ''}`} aria-hidden="true" /> : null,
          <li key={s} className={`ps-stepper__step${done ? ' ps-stepper__step--done' : cur ? ' ps-stepper__step--current' : ''}`} aria-current={cur ? 'step' : undefined}><span className="ps-stepper__dot" aria-hidden="true">{done ? '✓' : fa(i + 1)}</span>{st(s)}</li>]; })}</ol>
      <p className="ps-small">اقدام بعدی: <b>{NEXT[app.status] ?? '—'}</b> {OWNER[app.status] && <>· مسئول فعلی: {OWNER[app.status]}</>} · مبلغ درخواستی: <b>{app.requested_limit_irr ? <M v={app.requested_limit_irr} /> : 'تعیین نشده'}</b> · تعداد اقساط: <b>{fa(Number(app.installment_count ?? 4))}</b> · اعتباردهنده: <b>بانک</b> · شناسه <span className="ps-id">{short(app.id)}</span></p>
      {app.status === 'DRAFT' || app.status === 'IDENTITY_PENDING' ? <>
        <QuickApply applicationId={app.id} consents={consentOpts} feeToman={toman('500000')} defaultAmountToman={app.requested_limit_irr ? Number(BigInt(app.requested_limit_irr) / 10n) : 40000000} defaultCount={Number(app.installment_count ?? 4)} />
        <details className="ps-accordion"><summary>مراحل جداگانه و سناریوهای شبیه‌سازی (عدم تطبیق هویت و …)</summary><div className="ps-grid ps-grid--wide">
        <div><h3>۰. مبلغ و تعداد اقساط</h3>
          <Action command="application.terms" label="ثبت مبلغ و اقساط" fixed={{ application_id: app.id }} fields={[
            { name: 'requested_limit_irr', label: 'مبلغ اعتبار (ریال، مضرب ۱۰٬۰۰۰٬۰۰۰)', defaultValue: String(app.requested_limit_irr ?? '400000000') },
            { name: 'installment_count', label: 'تعداد اقساط', type: 'select', defaultValue: String(app.installment_count ?? 4), options: [2, 3, 4, 6].map((n) => ({ value: String(n), label: `${fa(n)} قسط` })) }]} /></div>
        <div><h3>۱. کد تأیید و رضایت‌ها</h3>
          {d.cust.kyc_status === 'VERIFIED' && app.status === 'IDENTITY_PENDING' ? <div className="ps-alert ps-alert--success ps-alert--block">هویت تطبیق شد (MOCK-KYC-MATCH)</div> : d.cust.kyc_status === 'MISMATCH' ? <div className="ps-alert ps-alert--error ps-alert--block">عدم تطبیق هویت؛ شماره همراه/اطلاعات را اصلاح و دوباره ارسال کنید.</div> : null}
          <p className="ps-small ps-muted">کد نمایشی: ۱۲۳۴۵۶ · شناسه ملی نمایشی: <span className="ps-id">{d.cust.identity_details?.national_id}</span></p>
          <details className="ps-accordion"><summary>متن رضایت‌ها</summary>{consents.map((c) => <p key={c.purpose} className="ps-small"><b>{c.title}:</b> {c.text}</p>)}</details>
          <Action command="application.identity" label="تأیید هویت" fixed={{ application_id: app.id }}
            fields={[{ name: 'otp', label: 'کد پیامکی (۶ رقم)', placeholder: '123456' }, { name: 'consents', label: 'رضایت‌ها (پیش‌فرض انتخاب نشده)', type: 'multicheck', options: consents.map((c) => ({ value: c.purpose, label: c.title })) }]}
            scenarios={[{ value: 'kyc_match', label: 'تطبیق هویت' }, { value: 'kyc_mismatch', label: 'عدم تطبیق' }]} /></div>
        <div><h3>۲. تطبیق کارت و حساب</h3>
          {d.accounts.length ? <p className="ps-small">حساب تأییدشده: {d.accounts.map((a: any) => `${a.bank_name} ****${a.card_last4}`).join('، ')}</p> : null}
          <Action command="application.account" label="استعلام حساب" fixed={{ application_id: app.id }} fields={[{ name: 'card', label: 'شماره کارت', placeholder: 'DEMO-CARD-1234', help: 'CVV2 و رمز هرگز دریافت نمی‌شود.' }]} />
          <h3>۳. مدارک (PDF/JPG/PNG، حداکثر ۱۰MB)</h3>
          <Table head={['نوع', 'اسکن', 'زمان']} rows={d.docs.filter((x: any) => x.application_id === app.id).map((x: any) => [x.category, <Badge key="s" s={x.scan_status} />, jdatetime(x.created_at)])} empty="هنوز مدرکی بارگذاری نشده است." />
          <Action command="application.document" label="بارگذاری" fixed={{ application_id: app.id }} fields={[{ name: 'category', label: 'نوع مدرک', type: 'select', options: [{ value: 'IDENTITY', label: 'مدرک هویتی' }, { value: 'INCOME', label: 'مدرک درآمد' }] }, { name: 'file', label: 'فایل', type: 'file' }]} />
          <h3>۴. ارسال</h3>
          <Action command="application.submit_evidence" label="ارسال مدارک برای بررسی" fixed={{ application_id: app.id }} /></div>
      </div></details></> : null}
      {app.status === 'FEE_PENDING' && <div>
        <div className="ps-alert ps-alert--block">هزینه استعلام اعتبارسنجی <M v="500000" /> است و پیش از درخواست گزارش دریافت می‌شود. گزارش اجراشده حتی در صورت رد اعتبار قابل بازگشت نیست؛ اگر گزارش ظرف ۴۸ ساعت تحویل نشود هزینه بازگردانده می‌شود. پرداخت تکراری دریافت نمی‌شود.</div>
        <Action command="application.pay_fee" label="پرداخت هزینه استعلام" fixed={{ application_id: app.id }} scenarios={PAY_SCENARIOS.slice(0, 3)} confirm="پرداخت ۵۰٬۰۰۰ تومان به پی‌استار برای استعلام اعتبارسنجی." />
      </div>}
      {(app.status === 'ASSESSMENT_PENDING' || (app.status === 'EXTERNAL_PENDING' && app.resume_stage === 'ASSESSMENT_PENDING')) && <div>
        {app.status === 'EXTERNAL_PENDING' && <div className="ps-alert ps-alert--block">در انتظار تأیید نتیجه سرویس اعتبارسنجی. بدون تأیید، بررسی ادامه نمی‌یابد. پس از ۴۸ ساعت هزینه به کیف بازپرداخت برمی‌گردد. تلاش مجدد هزینه تازه ندارد.</div>}
        <Action command="application.run_assessment" label={app.status === 'EXTERNAL_PENDING' ? 'تلاش مجدد گزارش' : 'درخواست گزارش اعتباری'} fixed={{ application_id: app.id }} scenarios={[{ value: 'normal', label: 'گزارش تحویل می‌شود' }, { value: 'timeout', label: 'عدم پاسخ سرویس' }]} />
      </div>}
      {app.status === 'NEEDS_CORRECTION' && (() => {
        const dec = [...d.decisions].reverse().find((x: any) => x.application_id === app.id && x.outcome === 'CORRECTION');
        return <div><div className="ps-alert ps-alert--block">{dec?.customer_message} — موارد: {(dec?.field_errors ?? []).map((f: any) => f.field).join('، ')} · مهلت: {jdate(app.correction_due_at)} · بازگشت به مرحله: {st(app.resume_stage)}</div>
          <Action command="application.document" label="بارگذاری مدرک اصلاحی" fixed={{ application_id: app.id }} fields={[{ name: 'category', label: 'نوع مدرک', type: 'select', options: [{ value: 'INCOME', label: 'مدرک درآمد' }, { value: 'IDENTITY', label: 'مدرک هویتی' }] }, { name: 'file', label: 'فایل', type: 'file' }]} />
          <Action command="application.resubmit" label="ارسال اصلاحات" fixed={{ application_id: app.id }} /></div>;
      })()}
      {app.status === 'REJECTED' && <div className="ps-alert ps-alert--error ps-alert--block">{[...d.decisions].reverse().find((x: any) => x.application_id === app.id)?.customer_message ?? 'درخواست تأیید نشد'} · امکان درخواست مجدد از {jdate(app.reapply_at)}
        <Action command="support.create" label="ثبت اعتراض" fixed={{ case_type: 'APPEAL', application_id: app.id }} fields={[{ name: 'summary', label: 'شرح اعتراض', type: 'textarea' }]} /></div>}
      <details className="ps-accordion"><summary>تاریخچه تصمیم‌ها</summary>
        <Table head={['مرحله', 'نتیجه', 'پیام', 'سقف']} rows={d.decisions.filter((x: any) => x.application_id === app.id).map((x: any) => [x.stage === 'CREDITOR_REVIEW' ? 'بانک' : 'پی‌استار', x.outcome, x.customer_message, x.approved_limit_irr ? <M key="m" v={x.approved_limit_irr} /> : '—'])} /></details>
    </Card>}

    </>}
    {show('credit', 'overview') && <>
    {d.lineStates.map((l: any) => <Card key={l.line.id} title={<>اعتبار من <Badge s={l.line.status} /></>}>
      <div className="ps-grid">
        <Kpi l="سقف" v={<M v={l.line.limit_irr} />} s={`اعتباردهنده: بانک · انقضا ${jdate(l.line.expires_at)}`} />
        <Kpi l="تعداد اقساط هر خرید" v={`${fa(Number(l.line.installment_count ?? 4))} قسط`} s="قسط اول هنگام خرید، بقیه ماهانه" />
        <Kpi l="مانده اصل" v={<M v={l.line.outstanding_principal_irr} />} />
        <Kpi l="رزروشده" v={<M v={l.line.reserved_principal_irr} />} />
        <Kpi l="اعتبار در دسترس" v={<M v={l.available} />} />
        <Kpi l="قابل خرج" v={<M v={l.spendable} />} s={l.blockedReasons.join('؛ ') || 'بدون محدودیت'} />
      </div>
      {l.line.status === 'APPROVED_PENDING_CONTRACT' && <>
        <div className="ps-document"><span className="ps-document__watermark" aria-hidden="true">نمونه</span><h3>قرارداد چارچوب اعتبار بانکی</h3>
          <p className="ps-small">وام‌گیرنده: شما · وام‌دهنده: {d.bankName} · سقف: <M v={l.line.limit_irr} /> · هر خرید در {fa(Number(l.line.installment_count ?? 4))} قسط ماهانه (قسط اول هنگام خرید)، کمیسیون ثابت نمایشی ۱۲٪ متعلق به بانک، سه چک به نام بانک برای هر خرید، پرداخت اقساط به حساب بانک از طریق رابط پی‌استار، پیگیری نرم پی‌استار تا روز ۲۹ تأخیر و سپس پیگیری حقوقی بانک، جریمه دیرکرد صفر، برگشت خدمت طبق الگوریتم تجمعی.</p></div>
        <Action command="line.sign" label="امضای قرارداد بانک" fixed={{ credit_line_id: l.line.id }} fields={[{ name: 'accept', label: 'متن قرارداد را خواندم و امضا می‌کنم (امضای نمایشی)', type: 'checkbox' }]} confirm="امضای قرارداد اعتبار با بانک؛ پس از امضا اعتبار قابل استفاده می‌شود." />
      </>}
    </Card>)}

    </>}
    {show('purchases', 'overview') && <>
    {d.checkouts.length > 0 && <Card title="پیش‌فاکتورهای در انتظار">
      <Table head={['کلینیک', 'سفارش', 'اصل', 'وضعیت', 'انقضا', '']} rows={d.checkouts.map((c: any) => [c.clinic, c.external_reference, <M key="m" v={c.principal_irr} />, <Badge key="b" s={c.status} />, jdatetime(c.expires_at), <Link key="l" href={`/account/checkout/${c.id}`}>ادامه خرید ←</Link>])} />
    </Card>}

    </>}
    {show('purchases') && <>
    {d.stmts.map((s: any) => {
      const pend = d.amend.filter((a: any) => a.purchase_id === s.purchase.id);
      const cc = d.cases2.find((c: any) => c.purchase_id === s.purchase.id);
      const open = s.installments.filter((i: any) => i.residual.total > 0n);
      return <Card key={s.purchase.id} title={<>خرید از {s.purchase.clinic_name} <Badge s={s.purchase.status} /> <Badge s={s.purchase.service_status} /></>}>
        <p className="ps-small">اعتباردهنده و دارنده چک: <b>{s.purchase.creditor_name}</b> · مقصد پرداخت: حساب وصول بانک (پی‌استار فقط رابط پرداخت است) · در تاریخچه این خرید هیچ فروش یا انتقال طلبی وجود ندارد.</p>
        {cc && cc.stage !== 'CLOSED' && <div className="ps-alert ps-alert--error ps-alert--block">تأخیر {fa(cc.dpd)} روز · خرید جدید مسدود است · {cc.dpd >= 30 ? 'پرونده برای پیگیری حقوقی به بانک ارجاع شده است.' : 'پیگیری نرم پی‌استار از طرف بانک.'}</div>}
        {pend.length > 0 && <div className="ps-alert ps-alert--block">برگشت خدمت تأیید شد؛ اصلاحیه بدهی در انتظار تأیید بانک است. مبالغ لغوشده از شما مطالبه نمی‌شود و یادآوری برای آن‌ها ارسال نمی‌شود.</div>}
        <StatementView s={s} href={`/account/purchases/${s.purchase.id}`} />
        {open.length > 0 && <Action command="payment.start" label="پرداخت به بانک" fixed={{ purchase_id: s.purchase.id }}
          fields={[{ name: 'count', label: 'تعداد اقساط (از قدیمی‌ترین)', type: 'select', options: open.map((_: any, i: number) => ({ value: String(i + 1), label: `${fa(i + 1)} قسط` })) }]}
          scenarios={PAY_SCENARIOS} confirm="مبلغ اقساط انتخابی (به ترتیب سررسید) به حساب وصول بانک پرداخت می‌شود." />}
        {open.length > 1 && <Action command="payment.start" label={`تسویه کامل زودهنگام`} fixed={{ purchase_id: s.purchase.id, payoff: true }} tone="neutral" scenarios={PAY_SCENARIOS.slice(0, 2)} confirm={`تسویه کامل: کل مانده اصل و کمیسیون زمان‌بندی‌شده؛ کمیسیون پرداخت‌شده دوباره دریافت نمی‌شود.`} />}
        {s.purchase.service_status === 'COMPLETED' && !s.purchase.service_evidence?.customer_acknowledged && <Action command="service.acknowledge" label="تأیید دریافت خدمت" fixed={{ purchase_id: s.purchase.id }} tone="neutral" />}
      </Card>;
    })}

    </>}
    {show('purchases', 'overview') && <>
    {pendingIntents.length > 0 && <Card title="پرداخت‌های در انتظار تأیید">
      <p className="ps-small ps-muted">«در انتظار تأیید» به معنی پرداخت‌شده نیست. استعلام از همان درخواست قبلی است و پرداخت دوم ایجاد نمی‌کند.</p>
      <Table head={['مرجع', 'مبلغ', 'وضعیت', '']} rows={pendingIntents.map((i: any) => [<span key="r" className="ps-id">{i.provider_intent_ref}</span>, <M key="m" v={i.amount_irr} />, <Badge key="b" s={i.status} />, <Action key="a" command="payment.inquire" label="استعلام" fixed={{ intent_id: i.id }} tone="neutral" inline />])} />
    </Card>}

    </>}
    {show('wallet') && <>
    <Card title="کیف بازپرداخت (فقط وجوه برگشتی؛ شارژ و انتقال ندارد)">
      <div className="ps-grid">
        <Kpi l="طلب شما (بدهی پی‌استار)" v={<M v={d.wallet?.liability_irr ?? 0} />} />
        <Kpi l="دارای پشتوانه نقدی" v={<M v={d.wallet?.funded_irr ?? 0} />} />
        <Kpi l="در حال برداشت" v={<M v={d.wallet?.held_irr ?? 0} />} />
        <Kpi l="قابل برداشت" v={<M v={BigInt(d.wallet?.funded_irr ?? 0) - BigInt(d.wallet?.held_irr ?? 0)} />} />
      </div>
      {d.unapplied.length > 0 && <div className="ps-alert ps-alert--block">وجه اعمال‌نشده: {d.unapplied.map((u: any) => <span key={u.id}><M v={u.amount_irr} /> (مرجع <span className="ps-id">{u.provider_reference}</span>) </span>)} — این مبلغ پس از تطبیق به حساب شما بازگردانده می‌شود و اعتبار جدید ایجاد نمی‌کند.</div>}
      {d.accounts.length > 0 && BigInt(d.wallet?.funded_irr ?? 0) - BigInt(d.wallet?.held_irr ?? 0) > 0n && <Action command="wallet.withdraw" label="برداشت به حساب خودم"
        fields={[{ name: 'bank_account_id', label: 'حساب مقصد (به نام خودتان)', type: 'select', options: d.accounts.map((a: any) => ({ value: a.id, label: `${a.bank_name} ****${a.card_last4}${a.cooling_until && new Date(a.cooling_until) > d.now ? ' (دوره انتظار ۲۴ ساعته)' : ''}` })) },
          { name: 'amount_irr', label: 'مبلغ (ریال)', defaultValue: String(BigInt(d.wallet.funded_irr) - BigInt(d.wallet.held_irr)) }]}
        scenarios={[{ value: 'confirmed', label: 'موفق' }, { value: 'unknown', label: 'نامعلوم' }, { value: 'failed', label: 'ناموفق' }]} confirm="برداشت بدون کارمزد؛ مبلغ تا نتیجه قطعی نگه داشته می‌شود." />}
      <Table head={['برداشت', 'مبلغ', 'وضعیت', '']} rows={d.withdrawals.map((w: any) => [<span key="r" className="ps-id">{w.provider_reference}</span>, <M key="m" v={w.amount_irr} />, <Badge key="b" s={w.status} />,
        ['UNKNOWN', 'SUBMITTED'].includes(w.status) ? <Action key="a" command="wallet.inquire" label="استعلام" fixed={{ withdrawal_id: w.id }} tone="neutral" inline /> : ''])} empty="برداشتی ثبت نشده است." />
      <details className="ps-accordion"><summary>ریز تراکنش‌های کیف</summary><Table head={['نوع', 'مبلغ', 'زمان']} rows={d.entries.map((e: any) => [e.entry_type, <M key="m" v={e.amount_irr} />, jdatetime(e.created_at)])} /></details>
    </Card>

    </>}
    {show('support') && <>
    <Card title="پشتیبانی و اختلاف">
      <p className="ps-small ps-muted">ثبت اختلاف خدمت، بدهی یا سررسید را تغییر نمی‌دهد. برگشت مالی فقط با تأیید کلینیک انجام می‌شود.</p>
      <Action command="support.create" label="ثبت درخواست" fields={[{ name: 'case_type', label: 'نوع', type: 'select', options: [{ value: 'SERVICE_DISPUTE', label: 'اختلاف خدمت' }, { value: 'PAYMENT_DISPUTE', label: 'اختلاف پرداخت' }, { value: 'HARDSHIP', label: 'درخواست مهلت' }, { value: 'GENERAL', label: 'عمومی' }] },
        { name: 'purchase_id', label: 'خرید مرتبط', type: 'select', options: [{ value: '', label: '—' }, ...d.stmts.map((s: any) => ({ value: s.purchase.id, label: `${s.purchase.clinic_name} ${short(s.purchase.id)}` }))] }, { name: 'summary', label: 'شرح', type: 'textarea' }]} />
      <Table head={['نوع', 'وضعیت', 'شرح', 'مهلت پاسخ']} rows={d.cases.map((c: any) => [c.case_type, <Badge key="b" s={c.status} />, c.summary, jdatetime(c.due_at)])} empty="درخواستی ندارید." />
    </Card>
    </>}
    {show('notifications') && <>
    <Card title="اعلان‌ها (درون‌برنامه؛ پیامک شبیه‌سازی‌شده و ارسال نمی‌شود)">
      {d.notes.length ? <Table head={['زمان', 'الگو', 'کلید']} rows={d.notes.map((n: any) => [jdatetime(n.send_at), (content().notifications as any)[n.template] ?? n.template, <span key="k" className="ps-id">{n.occurrence_key}</span>])} /> : <Empty>اعلانی ندارید.</Empty>}
    </Card>
    </>}
  </>;
}
