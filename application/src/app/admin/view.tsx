import { requirePageRole } from '@/server/session';
import { readScope } from '@/server/registry';
import { accountBalance, parties } from '@/server/core';
import { MODEL_ID } from '@/server/db';
import Action from '@/components/Action';
import { SectionTiles } from '@/components/AppShell';
import { ROLE_FA } from '@/lib/fmt';

const SCOPE_OPTIONS = [
  ['review', 'بررسی درخواست (پی‌استار)'], ['servicing', 'خدمات‌دهی و پشتیبانی (پی‌استار)'], ['treasury', 'خزانه (پی‌استار)'], ['credit', 'اعتبار'],
  ['orders', 'سفارش (کلینیک)'], ['returns', 'برگشت (کلینیک)'], ['checks', 'چک (کلینیک)'],
  ['underwriting', 'تصمیم اعتباری (بانک)'], ['funding', 'واریز (بانک)'], ['collections', 'وصول (بانک)'], ['purchase', 'خرید (بانک)'], ['legal', 'حقوقی'],
  ['organizations', 'سازمان‌ها و کاربران (مدیر ارشد)'], ['policies', 'سیاست‌ها (مدیر ارشد)'], ['audit', 'ممیزی (مدیر ارشد)'], ['demo', 'کنترل نمایش (مدیر ارشد)'],
].map(([value, label]) => ({ value, label }));
import ResetForm from '@/components/ResetForm';
import { Badge, Card, Kpi, M, Table, fa, jdate, jdatetime, short } from '@/components/ui';

export default async function AdminView({ section }: { section: string }) {
  const show = (...k: string[]) => k.includes(section);
  const actor = await requirePageRole('super-admin');
  const d = await readScope(actor, async (t) => {
    const { paystar } = await parties(t);
    const state = await t.one('SELECT * FROM app_demo_state WHERE id=1');
    const orgs = await t.q('SELECT * FROM organizations ORDER BY party_type, name');
    const members = await t.q('SELECT u.id user_id, u.display_name, m.role, m.scopes, m.status, o.name org FROM memberships m JOIN users u ON u.id=m.user_id LEFT JOIN organizations o ON o.id=m.organization_id ORDER BY m.role, u.created_at');
    const orgApprovals = await t.q("SELECT resource_id, proposed_by FROM approvals WHERE action='ACTIVATE_ORGANIZATION' AND status='PENDING'");
    const policies = await t.q('SELECT p.*, (SELECT count(*)::int FROM contracts c WHERE c.policy_id=p.id) contracts FROM policies p');
    const buckets = await t.q('SELECT * FROM exposure_buckets ORDER BY scope_type');
    const approvals = await t.q("SELECT a.*, u.display_name FROM approvals a JOIN users u ON u.id=a.proposed_by WHERE a.action IN ('PAUSE_ORIGINATIONS','RESUME_ORIGINATIONS') ORDER BY a.created_at DESC LIMIT 5");
    const audit = await t.q('SELECT a.*, u.display_name FROM audit_events a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.created_at DESC LIMIT 40');
    const overdue = await t.one(`SELECT COALESCE(sum((principal_irr-principal_paid_irr-principal_cancelled_irr)+(commission_irr-commission_paid_irr-commission_cancelled_irr)),0)::bigint s FROM installments WHERE status='OVERDUE'`);
    const recon = await t.one("SELECT count(*)::int n FROM reconciliation_items WHERE status='OPEN'");
    const queue = await t.one("SELECT count(*)::int n, min(updated_at) oldest FROM applications WHERE status IN ('PAYSTAR_REVIEW','CREDITOR_REVIEW')");
    const bridge = await accountBalance(t, paystar, 'REFUND_BRIDGE_CASH');
    const apps = await t.q(`SELECT a.*, u.display_name, (SELECT name FROM organizations WHERE id=a.creditor_id) creditor FROM applications a JOIN customers c ON c.id=a.customer_id JOIN users u ON u.id=c.user_id ORDER BY a.updated_at DESC`);
    const meetings = await t.q('SELECT * FROM app_meeting_notes ORDER BY recorded_at DESC');
    const matured = await t.one("SELECT count(*)::int n FROM installments WHERE due_at < (SELECT clock FROM app_demo_state) AND sequence>1");
    const jobs = await t.q('SELECT job_type, job_key, attempts, updated_at FROM jobs ORDER BY updated_at DESC LIMIT 6');
    return { orgApprovals, apps, state, orgs, members, policies, buckets, approvals, audit, overdue, recon, queue, bridge, meetings, matured, jobs };
  });
  const program = d.buckets.find((b: any) => b.scope_type === 'PROGRAM') as any;
  return <>
    {show('overview') && <>
    <div className="ps-grid">
      <Kpi l="اصل + رزرو برنامه" v={<M v={BigInt(program.outstanding_irr) + BigInt(program.reserved_irr)} />} s={<>سقف <M v={program.limit_irr} /></>} />
      <Kpi l="مبالغ سررسید گذشته" v={<M v={d.overdue.s} />} />
      <Kpi l="مانده پل بازپرداخت" v={<M v={d.bridge} />} s="بودجه نمایشی ۱۰۰ میلیون تومان" />
      <Kpi l="مغایرت تطبیق باز" v={fa(d.recon.n)} />
      <Kpi l="صف بررسی" v={fa(d.queue.n)} s={d.queue.oldest ? `قدیمی‌ترین ${jdatetime(d.queue.oldest)}` : ''} />
      <Kpi l="نرخ نکول دوره" v="N/A" s={`داده نمایشی؛ ${fa(d.matured.n)} قسط سررسیدشده از سناریوهای عمدی — عملکرد واقعی نیست`} />
    </div>
    </>}
    {show('overview') && <SectionTiles role="super-admin" counts={{}} />}
    {show('operations') && <>
    <div className="ps-grid ps-grid--wide">
      <Card title="ساعت نمایشی و کارهای زمان‌بندی‌شده">
        <p className="ps-small">ساعت فعلی: {jdatetime(d.state.clock)} · فقط رو به جلو؛ بازگشت به عقب نیازمند بازنشانی است.</p>
        <Action command="clock.advance" label="جلو بردن ساعت" inline fields={[{ name: 'minutes', label: 'دقیقه', defaultValue: '16' }, { name: 'days', label: 'روز', defaultValue: '0' }]} confirm="کارهای انقضای رزرو، بازگشت هزینه استعلام، محاسبه تأخیر، یادآوری و ارجاع DPD30 اجرا می‌شوند." />
        <Table head={['کار', 'کلید', 'دفعات']} rows={d.jobs.map((j: any) => [j.job_type, <span key="k" className="ps-id">{j.job_key}</span>, fa(j.attempts)])} />
      </Card>
      <Card title="توقف/ازسرگیری ایجاد خرید جدید (کنترل دوگانه)">
        <p className="ps-small">وضعیت: {d.state.originations_paused ? <span className="ps-badge ps-badge--error">متوقف — {d.state.pause_reason}</span> : <span className="ps-badge ps-badge--success">فعال</span>} · پرداخت، برگشت و پشتیبانی همیشه فعال می‌مانند.</p>
        <Action command="ops.propose_pause" label="پیشنهاد" inline fields={[{ name: 'pause', label: 'توقف (خاموش = ازسرگیری)', type: 'checkbox', defaultValue: 'on' }, { name: 'reason', label: 'دلیل' }]} />
        <Table head={['اقدام', 'پیشنهاد', 'وضعیت', '']} rows={d.approvals.map((a: any) => [a.action, a.display_name, <Badge key="b" s={a.status} />, a.status === 'PENDING' ? <Action key="x" command="ops.approve_pause" label="تأیید (کاربر دوم)" fixed={{ approval_id: a.id }} inline /> : ''])} empty="—" />
      </Card>
      <Card title="بازنشانی نمایشی">
        <p className="ps-small">فقط پایگاه داده همین مدل به داده نمونه و ساعت ثابت برمی‌گردد. مدل‌های دیگر و هر محیط غیرنمایشی تحت تأثیر نیستند.</p>
        <ResetForm phrase={`RESET MODEL ${MODEL_ID}`} />
      </Card>
      <Card title="نتیجه جلسه با بانک (یادداشت محلی)">
        <Action command="meeting.record" label="ثبت" fields={[{ name: 'outcome', label: 'نتیجه', type: 'select', options: [{ value: 'INTERESTED_IN_PILOT_DESIGN', label: 'علاقه‌مند به طراحی پایلوت' }, { value: 'REQUEST_REVISION', label: 'درخواست بازنگری' }, { value: 'DECLINE', label: 'عدم ادامه' }] }, { name: 'reasons', label: 'دلایل', type: 'textarea' }]} />
        <Table head={['زمان', 'نتیجه', 'دلایل']} rows={d.meetings.map((m: any) => [jdatetime(m.recorded_at), m.outcome, m.reasons])} empty="ثبت نشده." />
        <p className="ps-small ps-muted">این یادداشت تأیید حقوقی یا تعهد بانک نیست و به جایی ارسال نمی‌شود.</p>
      </Card>
    </div>
    </>}
    {show('applications', 'overview') && <Card title="درخواست‌های اعتبار (مشاهده؛ تصمیم با پی‌استار و بانک)">
      <p className="ps-small ps-muted">مدیر ارشد نمی‌تواند به‌جای پی‌استار یا بانک تصمیم بگیرد. بررسی مقدماتی در پنل «ادمین پی‌استار» و تصمیم نهایی در پنل «بانک» انجام می‌شود.</p>
      <Table head={['متقاضی', 'وضعیت', 'مسئول فعلی', 'پیشنهاد پی‌استار', 'سقف تأییدشده', 'به‌روزرسانی']} rows={d.apps.map((a: any) => [a.display_name, <Badge key="b" s={a.status} />,
        a.status === 'PAYSTAR_REVIEW' ? 'پی‌استار' : a.status === 'CREDITOR_REVIEW' ? a.creditor : ['DRAFT', 'IDENTITY_PENDING', 'FEE_PENDING', 'ASSESSMENT_PENDING', 'NEEDS_CORRECTION', 'APPROVED'].includes(a.status) ? 'مشتری' : '—',
        BigInt(a.recommended_limit_irr) ? <M key="r" v={a.recommended_limit_irr} /> : '—', a.approved_limit_irr ? <M key="l" v={a.approved_limit_irr} /> : '—', jdatetime(a.updated_at)])} />
    </Card>}
    {show('organizations') && <>
    <Card title="دعوت کاربر جدید (کارکنان)">
      <p className="ps-small ps-muted">نقش و سازمان باید با هم بخوانند: کلینیک ← کاربر کلینیک، بانک ← کاربر بانک، پی‌استار ← ادمین یا مدیر ارشد. کاربر بلافاصله در صفحه ورود ظاهر می‌شود. مشتریان از طریق لینک معرفی کلینیک ثبت‌نام می‌کنند (<a href="/r/DEMO-REFERRAL-TOKEN">ثبت‌نام مشتری جدید</a>).</p>
      <Action command="member.create" label="ایجاد کاربر" fields={[
        { name: 'display_name', label: 'نام و نام خانوادگی', placeholder: 'مثلاً نازنین فرهادی' },
        { name: 'role', label: 'نقش', type: 'select', options: [{ value: 'business-admin', label: 'کاربر کلینیک' }, { value: 'bank', label: 'کاربر بانک' }, { value: 'paystar-admin', label: 'ادمین پی‌استار' }, { value: 'super-admin', label: 'مدیر ارشد' }] },
        { name: 'organization_id', label: 'سازمان', type: 'select', options: d.orgs.filter((o: any) => o.status === 'ACTIVE').map((o: any) => ({ value: o.id, label: `${o.name} (${o.party_type === 'CLINIC' ? 'کلینیک' : o.party_type === 'BANK' ? 'بانک' : 'پی‌استار'})` })) },
        { name: 'scopes', label: 'حوزه‌های مجوز (فقط موارد مرتبط با نقش ذخیره می‌شود)', type: 'multicheck', options: SCOPE_OPTIONS },
      ]} confirm="کاربر با نقش و حوزه‌های انتخاب‌شده ایجاد و در صفحه ورود قابل انتخاب می‌شود." />
    </Card>
    <Card title="کاربران و دسترسی‌ها">
      <Table head={['کاربر', 'نقش', 'سازمان', 'حوزه‌ها', 'وضعیت', '']} rows={d.members.map((m: any) => [m.display_name, ROLE_FA[m.role] ?? m.role, m.org ?? '—', <span key="s" className="ps-id">{(m.scopes ?? []).join(', ')}</span>, <Badge key="b" s={m.status} />,
        m.status === 'ACTIVE' && m.role !== 'customer' && m.user_id !== actor.userId ? <Action key="r" command="member.revoke" label="لغو دسترسی" fixed={{ user_id: m.user_id }} tone="danger" inline /> : ''])} />
    </Card>
    <Card title="ثبت کلینیک جدید">
      <p className="ps-small ps-muted">کلینیک به‌صورت پیش‌نویس ثبت می‌شود و یک مدیر ارشد دیگر باید آن را فعال کند (کنترل دوگانه). پس از فعال‌سازی، کاتالوگ خدمات استاندارد برایش ساخته می‌شود و می‌توانید برایش کاربر بسازید.</p>
      <Action command="organization.create" label="ثبت پیش‌نویس" fields={[
        { name: 'name', label: 'نام کلینیک', placeholder: 'مثلاً کلینیک دندان‌پزشکی مهر' },
        { name: 'legal_identifier', label: 'شناسه حقوقی (نمایشی)', placeholder: 'DEMO-CLINIC-C', ltr: true },
        { name: 'slug', label: 'نشانی ویترین (انگلیسی)', placeholder: 'mehr', ltr: true },
      ]} />
      <Table head={['نام', 'نوع', 'وضعیت', 'شناسه حقوقی', '']} rows={d.orgs.map((o: any) => {
        const pend = d.orgApprovals.find((a: any) => a.resource_id === o.id);
        return [o.name, o.party_type === 'CLINIC' ? 'کلینیک' : o.party_type === 'BANK' ? 'بانک' : 'پی‌استار', <Badge key="b" s={o.status} />, <span key="l" className="ps-id">{o.legal_identifier_token}</span>,
          pend ? (pend.proposed_by === actor.userId ? <span key="w" className="ps-small ps-muted">در انتظار تأیید مدیر ارشد دیگر</span>
            : <Action key="a" command="organization.activate" label="فعال‌سازی" fixed={{ organization_id: o.id }} inline />) : ''];
      })} />
    </Card>
    </>}
    {show('policies') && <>
    <Card title="سیاست‌ها">
      <Table head={['نام', 'نسخه', 'وضعیت', 'اجرا از', 'قراردادهای منجمد', 'تأییدکننده متفاوت', 'پیکربندی']} rows={d.policies.map((p: any) => [p.name, fa(p.policy_version), <Badge key="b" s={p.status} />, jdate(p.effective_at), fa(p.contracts), p.approved_by && p.approved_by !== p.proposed_by ? 'بله' : 'خیر', <span key="c" className="ps-id">{JSON.stringify(p.configuration)}</span>])} />
      <p className="ps-small ps-muted">تأیید سیاست نمایشی است. فعال‌سازی عملیاتی بدون بسته انتشار حقوقی/بانکی امضاشده برابر POLICY_NOT_RELEASED است.</p>
    </Card>
    </>}
    {show('audit') && <>
    <Card title="ممیزی (آخرین ۴۰ رویداد؛ زنجیره هش)">
      <Table head={['زمان', 'کاربر', 'اقدام', 'منبع', 'هش']} rows={d.audit.map((a: any) => [jdatetime(a.created_at), a.display_name ?? 'سیستم', a.action.startsWith('denied:') ? <span key="x" className="ps-badge ps-badge--error">{a.action}</span> : a.action, `${a.resource_type} ${short(a.resource_id)}`, <span key="h" className="ps-id">{short(a.event_hash)}</span>])} />
    </Card>
    </>}
  </>;
}
