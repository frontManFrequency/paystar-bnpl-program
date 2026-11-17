import Link from 'next/link';
import { requirePageRole } from '@/server/session';
import { readScope } from '@/server/registry';
import { accountBalance, clock } from '@/server/core';
import { statement } from '@/server/services';
import Action from '@/components/Action';
import { SectionTiles } from '@/components/AppShell';
import { Badge, Card, Kpi, M, Table, fa, jdate, jdatetime, short } from '@/components/ui';

export default async function BankView({ section }: { section: string }) {
  const show = (...k: string[]) => k.includes(section);
  const actor = await requirePageRole('bank');
  const org = actor.orgId!;
  const d = await readScope(actor, async (t) => {
    const now = await clock(t);
    const apps = await t.q(`SELECT a.*, u.display_name, cu.verified_monthly_income_irr, cu.external_monthly_obligations_irr, cu.kyc_status,
        (SELECT risk_band FROM assessments s WHERE s.application_id=a.id ORDER BY assessed_at DESC LIMIT 1) band,
        (SELECT assessed_at FROM assessments s WHERE s.application_id=a.id ORDER BY assessed_at DESC LIMIT 1) assessed_at
      FROM applications a JOIN customers cu ON cu.id=a.customer_id JOIN users u ON u.id=cu.user_id WHERE a.creditor_id=$1 AND a.status='CREDITOR_REVIEW' ORDER BY a.updated_at`, [org]);
    const decisions = await t.q('SELECT * FROM decisions WHERE application_id = ANY($1) ORDER BY created_at', [apps.map((a: any) => a.id)]);
    const docs = await t.q("SELECT id, application_id, category, scan_status FROM documents WHERE application_id = ANY($1)", [apps.map((a: any) => a.id)]);
    const regChecks = await t.q(`SELECT c.checkout_id, count(*)::int n, sum(c.amount_irr)::bigint total, max(u.display_name) customer FROM checks c JOIN customers cu ON cu.id=c.issuer_customer_id JOIN users u ON u.id=cu.user_id
       WHERE c.beneficiary_id=$1 AND c.status='REGISTERED' GROUP BY c.checkout_id`, [org]);
    const settlements = await t.q(`SELECT s.*, c.name clinic, p.customer_id, (SELECT count(*)::int FROM checks k WHERE k.purchase_id=s.purchase_id AND k.status='IN_CUSTODY') custody,
        (SELECT row_to_json(a) FROM (SELECT id, proposed_by, status FROM approvals WHERE resource_id=s.id AND action='CLINIC_PAYOUT' ORDER BY created_at DESC LIMIT 1) a) approval
       FROM settlements s JOIN organizations c ON c.id=s.to_party_id JOIN purchases p ON p.id=s.purchase_id WHERE s.from_party_id=$1 ORDER BY s.created_at DESC`, [org]);
    const users = Object.fromEntries((await t.q('SELECT id, display_name FROM users')).map((u: any) => [u.id, u.display_name]));
    const loans = [];
    for (const p of await t.q("SELECT id FROM purchases WHERE current_owner_id=$1 ORDER BY confirmed_at DESC", [org])) loans.push((await statement(t, p.id))!);
    const amendments = await t.q("SELECT b.*, p.business_id FROM bank_instructions b JOIN purchases p ON p.id=b.purchase_id WHERE b.bank_id=$1 AND b.instruction_type='REFUND_AMENDMENT' ORDER BY b.created_at DESC", [org]);
    const cases = await t.q(`SELECT cc.*, u.display_name customer, p.business_id,
        (SELECT json_agg(json_build_object('t',action_type,'at',occurred_at,'r',result_code) ORDER BY occurred_at) FROM collection_actions a WHERE a.case_id=cc.id) actions
       FROM collection_cases cc JOIN purchases p ON p.id=cc.purchase_id JOIN customers cu ON cu.id=p.customer_id JOIN users u ON u.id=cu.user_id WHERE cc.creditor_id=$1 AND cc.stage<>'CLOSED' ORDER BY cc.dpd DESC`, [org]);
    const claims = await t.q('SELECT gc.*, g.cap_irr, g.used_irr, g.coverage_bps FROM guarantee_claims gc JOIN guarantees g ON g.id=gc.guarantee_id WHERE g.beneficiary_id=$1 ORDER BY gc.created_at DESC', [org]);
    const guarantees = await t.q('SELECT g.*, c.name clinic FROM guarantees g JOIN organizations c ON c.id=g.business_id WHERE g.beneficiary_id=$1', [org]);
    const hardship = await t.q("SELECT s.*, u.display_name customer FROM support_cases s JOIN purchases p ON p.id=s.purchase_id JOIN customers cu ON cu.id=s.customer_id JOIN users u ON u.id=cu.user_id WHERE s.case_type='HARDSHIP' AND p.current_owner_id=$1 ORDER BY s.created_at DESC", [org]);
    const invoices = await t.q('SELECT i.*, (SELECT name FROM organizations WHERE id=i.payee_id) payee FROM invoices i WHERE payer_id=$1 ORDER BY created_at DESC', [org]);
    const cash = await accountBalance(t, org, 'CASH');
    const principal = await accountBalance(t, org, 'CUSTOMER_PRINCIPAL');
    const revenue = -(await accountBalance(t, org, 'COMMISSION_REVENUE'));
    return { now, apps, decisions, docs, regChecks, settlements, users, loans, amendments, cases, claims, guarantees, hardship, invoices, cash, principal, revenue };
  });
  const outstanding = d.loans.reduce((a: bigint, s: any) => a + s.totals.outstandingPrincipal, 0n);
  const overdue = d.loans.reduce((a: bigint, s: any) => a + s.totals.overdue, 0n);
  return <>
    {show('overview') && <>
    <p className="ps-small ps-muted">نقش حقوقی: وام‌دهنده و ذی‌نفع چک از ابتدا؛ تصمیم نهایی اعتبار، واریز به کلینیک، تأیید اصلاحیه بدهی و اقدام حقوقی فقط با کاربران بانک. پی‌استار نماینده خدمات‌دهی تا DPD29 است. ارقام دفتر، آینه خدمات‌دهی است و دفتر رسمی نزد بانک می‌ماند.</p>
    <div className="ps-grid">
      <Kpi l="اصل طلب بانک از مشتریان" v={<M v={outstanding} />} s="آینه خدمات‌دهی؛ دفتر رسمی نزد بانک" />
      <Kpi l="سررسید گذشته" v={<M v={overdue} />} />
      <Kpi l="صف تصمیم اعتباری" v={fa(d.apps.length)} />
      <Kpi l="واریزهای در انتظار" v={fa(d.settlements.filter((s: any) => s.status !== 'CONFIRMED').length)} />
      <Kpi l="درآمد کمیسیون شناسایی‌شده" v={<M v={d.revenue} />} s="درآمد بانک، نه پی‌استار" />
      <Kpi l="مانده نقد حساب وصول (آینه)" v={<M v={d.cash} />} s="شامل مانده افتتاحیه نمایشی" />
    </div>

    </>}
    {show('overview') && <SectionTiles role="bank" counts={{ applications: fa(d.apps.length), checks: fa(d.regChecks.length), disbursements: fa(d.settlements.filter((s: any) => s.status !== 'CONFIRMED').length), amendments: fa(d.amendments.filter((a: any) => a.status === 'PENDING').length), collections: fa(d.cases.length) }} />}
    {show('applications', 'overview') && <>
    <Card id="applications" title="۱. تصمیم نهایی اعتبار">
      {d.apps.length === 0 && <p className="ps-small ps-muted">پرونده‌ای در صف بانک نیست. پرونده‌ها پس از تأیید مقدماتی پی‌استار ارسال می‌شوند.</p>}
      {d.apps.map((a: any) => <div key={a.id} className="ps-card">
        <h3>{a.display_name} · <span className="ps-id">{short(a.id)}</span></h3>
        <Table head={['مبلغ درخواستی مشتری', 'تعداد اقساط', 'احراز هویت', 'باند ریسک', 'تاریخ ارزیابی', 'درآمد ماهانه تأییدشده', 'سقف ۳۰٪ قسط ماهانه', 'پیشنهاد پی‌استار', 'مدارک']}
          rows={[[a.requested_limit_irr ? <M key="q" v={a.requested_limit_irr} /> : '—', `${fa(Number(a.installment_count ?? 4))} قسط`, a.kyc_status, a.band ?? 'UNKNOWN', jdate(a.assessed_at), <M key="i" v={a.verified_monthly_income_irr} />, <M key="c" v={BigInt(a.verified_monthly_income_irr) * 30n / 100n - BigInt(a.external_monthly_obligations_irr)} />, <M key="r" v={a.recommended_limit_irr} />,
            d.docs.filter((x: any) => x.application_id === a.id).map((x: any) => <div key={x.id}><a href={`/api/v1/documents/${x.id}`} target="_blank">{x.category}</a> <span className="ps-small">({x.scan_status})</span></div>)]]} />
        <p className="ps-small">سابقه: {d.decisions.filter((x: any) => x.application_id === a.id).map((x: any) => `${x.stage === 'CREDITOR_REVIEW' ? 'بانک' : 'پی‌استار'}: ${x.outcome} (${x.reason_code})`).join(' ← ')}</p>
        <Action command="decision.bank_final" label="ثبت تصمیم بانک" fixed={{ application_id: a.id, version: String(a.version) }}
          fields={[{ name: 'outcome', label: 'نتیجه', type: 'select', options: [{ value: 'APPROVE', label: 'تأیید' }, { value: 'CORRECTION', label: 'درخواست اصلاح' }, { value: 'REJECT', label: 'رد' }] },
            { name: 'limit_irr', label: 'سقف (ریال؛ ≤ پیشنهاد پی‌استار که خود ≤ مبلغ درخواستی مشتری است، مضرب ۱۰٬۰۰۰٬۰۰۰)', defaultValue: String(a.recommended_limit_irr) },
            { name: 'reason_code', label: 'کد دلیل', placeholder: 'INCOME_DOCUMENT_STALE' },
            { name: 'customer_message', label: 'پیام قابل نمایش به مشتری', type: 'textarea' },
            { name: 'fields', label: 'موارد اصلاح (با ویرگول)', placeholder: 'income_document' }]}
          confirm="تصمیم بانک با نسخه سیاست BASELINE v1 (شبیه‌سازی) ثبت و امضا می‌شود." />
      </div>)}
    </Card>

    </>}
    {show('checks') && <>
    <Card id="checks" title="۲. پذیرش چک‌های صادرشده به نام بانک">
      <Table head={['پیش‌فاکتور', 'مشتری', 'تعداد', 'جمع', '']} rows={d.regChecks.map((c: any) => [<span key="k" className="ps-id">{short(c.checkout_id)}</span>, c.customer, fa(c.n), <M key="m" v={c.total} />,
        <Action key="a" command="checks.bank_accept" label="پذیرش و امانت" fixed={{ checkout_id: c.checkout_id }} inline confirm="تأیید ثبت، پذیرش و امانت چک‌ها با شواهد بانک (شبیه‌سازی صیاد)." />])} empty="چکی در انتظار پذیرش نیست." />
    </Card>

    </>}
    {show('disbursements') && <>
    <Card id="disbursements" title="۳. واریز کل مبلغ خدمت به کلینیک (کنترل دوگانه)">
      <p className="ps-small ps-muted">پیشنهاددهنده و تأییدکننده باید دو کاربر متفاوت بانک باشند. هر تعهد یک مرجع انتقال ثابت دارد؛ استعلام، انتقال دوم ایجاد نمی‌کند.</p>
      <Table head={['کلینیک', 'مبلغ', 'سررسید تسویه', 'چک در امانت', 'وضعیت', 'مرجع', 'اقدام']} rows={d.settlements.map((s: any) => [s.clinic, <M key="m" v={s.amount_irr} />, jdatetime(s.due_at), fa(s.custody), <Badge key="b" s={s.status} />, <span key="r" className="ps-id">{s.external_reference ?? '—'}</span>,
        ['QUEUED', 'FAILED'].includes(s.status) && (!s.approval || s.approval.status !== 'PENDING') ? <Action key="p" command="disbursement.propose" label="پیشنهاد واریز" fixed={{ settlement_id: s.id }} inline />
        : s.approval?.status === 'PENDING' ? <div key="a"><span className="ps-small">پیشنهاد: {d.users[s.approval.proposed_by]}</span><Action command="disbursement.approve" label="تأیید و ارسال" fixed={{ approval_id: s.approval.id }} inline scenarios={[{ value: 'confirmed', label: 'تأیید بانک' }, { value: 'unknown', label: 'پاسخ نامعلوم' }, { value: 'failed', label: 'ناموفق' }]} /></div>
        : ['UNKNOWN', 'SUBMITTED'].includes(s.status) ? <Action key="i" command="disbursement.inquire" label="استعلام با همان مرجع" fixed={{ settlement_id: s.id }} inline tone="neutral" /> : '✓'])} empty="تعهد واریزی وجود ندارد." />
    </Card>

    </>}
    {show('loans') && <>
    <Card id="loans" title="۴. وام‌های بانک (طلب از ابتدا متعلق به بانک)">
      <Table head={['مشتری', 'کلینیک', 'اصل', 'مانده اصل', 'مانده کل', 'DPD', 'وضعیت', 'خدمت', '']} rows={d.loans.map((s: any) => [s.purchase.customer_name, s.purchase.clinic_name, <M key="p" v={s.totals.principal} />, <M key="o" v={s.totals.outstandingPrincipal} />, <M key="t" v={s.totals.payoff} />, fa(s.dpd), <Badge key="b" s={s.purchase.status} />, <Badge key="sv" s={s.purchase.service_status} />,
        <Link key="l" href={`/bank/loans/${s.purchase.id}`}>صورت‌حساب</Link>])} />
      <a href="/api/v1/exports/orders">خروجی CSV (فقط وام‌های همین بانک)</a>
    </Card>

    </>}
    {show('amendments') && <>
    <Card id="amendments" title="۵. اصلاحیه بدهی ناشی از برگشت خدمت">
      <p className="ps-small ps-muted">پس از تأیید برگشت توسط کلینیک، لغو برای مشتری فوراً اعمال و از یادآوری حذف می‌شود؛ مانده تأییدشده بانک تا تأیید شما جدا نگه داشته می‌شود (مهلت یک روز کاری).</p>
      <Table head={['مرجع', 'مانده مورد انتظار', 'مانده تأییدشده بانک', 'وضعیت', 'ایجاد', '']} rows={d.amendments.map((b: any) => [<span key="r" className="ps-id">{b.external_reference}</span>, <M key="e" v={b.expected_balance_irr} />, b.acknowledged_balance_irr === null ? 'هنوز تأیید نشده' : <M key="a" v={b.acknowledged_balance_irr} />, <Badge key="b" s={b.status} />, jdatetime(b.created_at),
        b.status === 'PENDING' ? <Action key="x" command="amendment.bank_ack" label="تأیید اصلاحیه و آزادسازی/جایگزینی چک" fixed={{ instruction_id: b.id }} inline /> : ''])} empty="اصلاحیه‌ای ثبت نشده است." />
    </Card>

    </>}
    {show('collections') && <>
    <Card id="collections" title="۶. وصول حقوقی (از DPD30) و ضمانت کلینیک">
      {d.cases.map((c: any) => <div key={c.id} className="ps-card">
        <h3>{c.customer} · DPD {fa(c.dpd)} <Badge s={c.stage} /></h3>
        <p className="ps-small">مجوز حقوقی: {c.legal_authorized_at ? jdatetime(c.legal_authorized_at) : 'ندارد'} · اقدامات: {(c.actions ?? []).map((a: any) => `${a.t} (${jdate(a.at)})`).join('، ') || 'هیچ'}</p>
        <div className="ps-actions">
          {c.stage === 'LEGAL_REVIEW' && <Action command="collections.authorize_legal" label="مجوز اقدام حقوقی" fixed={{ case_id: c.id }} inline confirm="مجوز اقدام حقوقی بانک؛ هیچ اقدام خودکاری از تایمر انجام نمی‌شود." />}
          <Action command="collections.record_recovery" label="ثبت پیگیری مشتری" fixed={{ case_id: c.id, action_type: 'CUSTOMER_RECOVERY_ATTEMPT' }} inline tone="neutral" />
          <Action command="collections.record_recovery" label="ثبت ارائه چک" fixed={{ case_id: c.id, action_type: 'CHECK_PRESENTATION', result_code: 'BOUNCED' }} inline tone="neutral" />
          <Action command="guarantee.propose_claim" label="پیشنهاد مطالبه ضمانت" fixed={{ case_id: c.id }} inline />
        </div>
      </div>)}
      {d.cases.length === 0 && <p className="ps-small ps-muted">پرونده وصولی باز نیست.</p>}
      <h3>ضمانت‌ها</h3>
      <Table head={['کلینیک', 'نوع', 'پوشش', 'سقف', 'استفاده‌شده', 'رزرو', 'انقضا']} rows={d.guarantees.map((g: any) => [g.clinic, g.guarantee_type, `${fa(g.coverage_bps / 100)}٪ اصل باقی‌مانده`, <M key="c" v={g.cap_irr} />, <M key="u" v={g.used_irr} />, <M key="r" v={g.reserved_claim_irr} />, jdate(g.expires_at)])} />
      <Table head={['مطالبه', 'مبلغ', 'وضعیت', 'پیشنهاد', '']} rows={d.claims.map((c: any) => [<span key="i" className="ps-id">{short(c.id)}</span>, <M key="m" v={c.requested_irr} />, <Badge key="b" s={c.status} />, d.users[c.proposed_by],
        c.status === 'ELIGIBLE' ? <Action key="a" command="guarantee.approve_claim" label="تأیید (کاربر دوم، حقوقی)" fixed={{ claim_id: c.id }} inline /> : ''])} empty="مطالبه‌ای ثبت نشده است." />
      <p className="ps-small ps-muted">وصول ضمانت زیان بانک را کاهش می‌دهد اما بدهی مشتری را تسویه نمی‌کند؛ حق جانشینی جداگانه ثبت می‌شود.</p>
    </Card>

    </>}
    {show('hardship') && <>
    <Card id="hardship" title="۷. درخواست‌های مهلت (تصمیم با بانک)">
      <Table head={['مشتری', 'شرح', 'وضعیت', '']} rows={d.hardship.map((h: any) => [h.customer, h.summary, <Badge key="b" s={h.status} />,
        ['OPEN', 'CREDITOR_REVIEW'].includes(h.status) ? <Action key="a" command="hardship.bank_decide" label="ثبت تصمیم" fixed={{ case_id: h.id }} inline fields={[{ name: 'outcome', label: 'نتیجه', type: 'select', options: [{ value: 'APPROVE', label: 'تأیید (۳۰ روز، بدون کمیسیون اضافه)' }, { value: 'REJECT', label: 'رد' }] }, { name: 'reason', label: 'دلیل' }]} /> : ''])} empty="درخواستی نیست." />
    </Card>

    </>}
    {show('invoices') && <>
    <Card id="invoices" title="۸. صورت‌حساب کارمزد خدمات پی‌استار (جدا از بدهی مشتری)">
      <Table head={['دوره', 'خالص', 'برگشت‌خورده', 'سررسید', 'وضعیت']} rows={d.invoices.map((i: any) => [`${i.period_start.toISOString?.().slice(0, 10) ?? i.period_start} تا ${i.period_end.toISOString?.().slice(0, 10) ?? i.period_end}`, <M key="n" v={i.net_irr} />, <M key="r" v={i.reversed_irr} />, jdate(i.due_at), <Badge key="b" s={i.status} />])} />
      <p className="ps-small ps-muted">۱٪ اصل خالص پس از قسط اول؛ برگشت خدمت آن را به نسبت برمی‌گرداند. مشتری این کارمزد را نمی‌پردازد.</p>
    </Card>
    </>}
  </>;
}
