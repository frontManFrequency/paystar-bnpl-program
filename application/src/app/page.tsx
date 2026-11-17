import { fixture, tx } from '@/server/db';
import { currentActor } from '@/server/session';
import RoleSwitcher, { DemoUser } from '@/components/RoleSwitcher';
import { Card, Table, M } from '@/components/ui';
import { ROLE_FA, ROLE_HOME, jdatetime } from '@/lib/fmt';
import Link from 'next/link';

export const dynamic = 'force-dynamic';
const HINTS: Record<string, string> = {
  super: 'ساعت نمایشی، بازنشانی، توقف عملیات، ممیزی',
  'super-checker': 'کنترل دوم تصمیمات مدیریتی',
  ops: 'بررسی مقدماتی، پرداخت‌ها، تطبیق، پیگیری نرم',
  'ops-checker': 'کارشناس دوم پی‌استار',
  clinic: 'سفارش، خدمت، آغاز برگشت (کاربر اول)',
  'clinic-checker': 'تأیید برگشت (کاربر دوم کلینیک)',
  'other-clinic': 'کلینیک دیگر برای آزمون جداسازی',
  bank: 'تصمیم نهایی، پذیرش چک، پیشنهاد واریز، وصول',
  'bank-checker': 'تأیید دوم واریز، مجوز حقوقی، ضمانت',
  'customer-current': 'خرید ۴۰ میلیون تومانی پس از قسط اول',
  'customer-overdue': 'اقساط سررسید گذشته (DPD۶۱)',
  'customer-refunded': 'برگشت کامل؛ کیف بازپرداخت ۱۱٫۲ میلیون',
  'customer-correction': 'درخواست نیازمند مدرک درآمد',
  'customer-draft': 'مسیر تازه: از پیش‌نویس تا خرید',
  'customer-rejected': 'رد شده با تاریخ درخواست مجدد',
};

export default async function Home() {
  const f = fixture();
  const actor = await currentActor();
  const st = await tx(null, (t) => t.one('SELECT clock, fixture_version, seeded_at FROM app_demo_state WHERE id=1'));
  // Every active user in the database is selectable: seeded users, invited staff and self-registered customers.
  const keyOf = Object.fromEntries(f.demo_users.map((u: any) => [u.user_id, u.key]));
  const all = await tx(null, (t) => t.q("SELECT u.id, u.display_name, m.role, o.name org FROM users u JOIN memberships m ON m.user_id=u.id AND m.status='ACTIVE' LEFT JOIN organizations o ON o.id=m.organization_id ORDER BY u.created_at, u.display_name"));
  const users: DemoUser[] = all.map((u: any) => ({ key: keyOf[u.id] ?? u.id, label: u.display_name, role: u.role, roleFa: ROLE_FA[u.role],
    hint: HINTS[keyOf[u.id]] ?? (u.role === 'customer' ? 'مشتری ثبت‌نام‌شده' : `کاربر جدید · ${u.org ?? ''}`) }));
  return <>
    <div className="ps-page-header"><h1 className="ps-page-title">پی‌استار — مدل ۴: بانک، اعتباردهنده مشتری</h1><p className="ps-muted">یک کاربر را انتخاب کنید تا وارد فضای کاری او شوید. همه نقش‌ها روی یک پایگاه داده مشترک کار می‌کنند.</p></div>
    <section className="ps-form" aria-labelledby="roles-t">
      <h2 className="ps-section-title" id="roles-t">ورود به‌عنوان</h2>
      {actor && <div className="ps-alert ps-alert--success ps-alert--block">وارد شده‌اید: {ROLE_FA[actor.role]} — {actor.displayName} · <Link href={ROLE_HOME[actor.role]}>ورود به فضای کاری</Link></div>}
      <p className="ps-small ps-muted">تغییر نقش فقط نشست نمایشی را عوض می‌کند؛ مدل و تراکنش‌های ذخیره‌شده ثابت می‌مانند.</p>
      <RoleSwitcher users={users} current={actor ? (f.demo_users.find((u: any) => u.user_id === actor.userId)?.key ?? actor.userId) : null} />
    </section>
    <div className="ps-grid ps-grid--wide">
      <Card title="هویت مدل (ثابت در سرور)">
        <Table head={['بُعد', 'قاعده الزامی']} rows={[
          ['اعتباردهنده مشتری', 'بانک، از امضای قرارداد اعتبار'], ['تصمیم نهایی اعتبار', 'فقط بانک؛ پی‌استار پیشنهاد می‌دهد'],
          ['ذی‌نفع چک', 'بانک از زمان صدور'], ['پرداخت به کلینیک', 'خزانه بانک، کل مبلغ P'],
          ['مقصد اقساط', 'حساب وصول بانک؛ پی‌استار فقط رابط پرداخت'], ['کمیسیون', 'درآمد بانک؛ کارمزد خدمات پی‌استار جداگانه (۱٪)'],
          ['ریسک نکول', 'بانک، با ضمانت سقف‌دار اختیاری کلینیک'],
        ]} />
        <p className="ps-small ps-muted">ساعت نمایشی: {jdatetime(st.clock)} · نسخه داده نمونه {st.fixture_version} · پایگاه داده محلی روی دیسک (آفلاین)</p>
      </Card>
      <Card title="مثال استاندارد">
        <Table head={['مورد', 'مبلغ']} rows={[
          ['اصل خدمت', <M key="a" v="400000000" />], ['کمیسیون کل', <M key="b" v="48000000" />], ['هر یک از چهار قسط', <M key="c" v="112000000" />],
          ['مانده اصل پس از قسط اول', <M key="d" v="300000000" />], ['تسویه زودهنگام پس از قسط اول', <M key="e" v="336000000" />],
          ['هزینه استعلام (جدا)', <M key="f" v="500000" />], ['کارمزد خدمات پی‌استار از بانک (۱٪ × ۳۰۰م)', <M key="g" v="3000000" />],
        ]} />
        <p className="ps-small ps-muted">نرخ ۱۲٪ ثابت فرض آزمایشی است؛ نرخ مصوب بانک یا ادعای APR نیست.</p>
      </Card>
    </div>
    <Card title="مسیر پیشنهادی جلسه (۱۵ دقیقه)">
      <ol className="ps-small">
        <li><b>بانک (محمد حسینی)</b> → وام‌ها: مانده اصل ۳۰ میلیون، سه قسط ۱۱٫۲ میلیونی، چک‌ها به نام بانک.</li>
        <li><b>نیلوفر اکبری (مشتری تازه)</b>: احراز هویت (کد ۱۲۳۴۵۶)، کارت DEMO-CARD-1234، مدارک، هزینه، گزارش → <b>پی‌استار</b> تأیید مقدماتی → <b>بانک</b> درخواست اصلاح → مشتری اصلاح → <b>بانک</b> تأیید. تلاش پی‌استار برای تصمیم نهایی رد می‌شود.</li>
        <li>مشتری قرارداد اعتبار را امضا می‌کند → <b>کلینیک</b> سفارش ۴۰ میلیونی → مشتری قرارداد خرید و سه چک → <b>بانک</b> پذیرش چک → مشتری قسط اول → <b>بانک</b> پیشنهاد واریز و <b>بانک دوم</b> تأیید → کلینیک شروع خدمت.</li>
        <li><b>مریم رضایی</b> قسط دوم را می‌پردازد؛ مانده اصل ۳۰ → ۲۰ میلیون. <b>پی‌استار</b> → پرداخت‌ها → «بازپخش رویداد» بدون اثر مالی.</li>
        <li>استثناها: برگشت ۵۰٪ و کامل (کلینیک + کلینیک دوم)، پرداخت نامعلوم، ضمانت کلینیک بدون مجوز و سابقه وصول رد می‌شود.</li>
      </ol>
    </Card>
    <Card title="مقایسه چهار مدل (مرجع؛ این نمونه فقط مدل ۴ را اجرا می‌کند)">
      <Table head={['بُعد', 'مدل ۱', 'مدل ۲', 'مدل ۳', 'مدل ۴']} rows={[
        ['اعتباردهنده مشتری', 'پی‌استار', 'کلینیک فروشنده', 'پی‌استار، سپس بانک برای دارایی منتقل‌شده', 'بانک از انعقاد قرارداد'],
        ['ذی‌نفع چک', 'پی‌استار', 'کلینیک', 'پی‌استار، سپس دارنده بانکی تأییدشده', 'بانک از صدور'],
        ['وجه کلینیک', 'پرداخت پیشاپیش پی‌استار', 'تدریجی از مشتری', 'پی‌استار پیش از فروش', 'پرداخت پیشاپیش بانک'],
        ['رابطه بانک', 'اعتباردهنده تسهیلات پی‌استار', 'معمولاً ندارد', 'خریدار مطالبات', 'وام‌دهنده مشتری'],
        ['ریسک نکول', 'پی‌استار', 'کلینیک', 'بسته به حق رجوع', 'بانک + ضمانت صریح کلینیک'],
      ]} />
    </Card>
  </>;
}
