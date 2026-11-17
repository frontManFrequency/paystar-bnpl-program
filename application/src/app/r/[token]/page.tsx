import { tx } from '@/server/db';
import { clock } from '@/server/core';
import { findReferral } from '@/server/cmd-checkout';
import Register from '@/components/Register';
import { Card, M } from '@/components/ui';

export const dynamic = 'force-dynamic';
export default async function Referral({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const r = await tx(null, async (t) => { const ref = await findReferral(t, decodeURIComponent(token)); return { ref, now: await clock(t), bank: (await t.one("SELECT name FROM organizations WHERE party_type='BANK' LIMIT 1"))?.name }; });
  const valid = r.ref && !r.ref.revoked_at && new Date(r.ref.expires_at) > r.now && r.ref.clinic_status === 'ACTIVE';
  if (!valid) return <Card title="لینک معرفی معتبر نیست"><p>این لینک نامعتبر، منقضی یا لغو شده است و به کلینیک دیگری نسبت داده نمی‌شود. لطفاً برای لینک جدید با کلینیک تماس بگیرید.</p></Card>;
  return <>
    <h1>خرید اقساطی خدمات {r.ref.clinic}</h1>
    <Card title="شرایط پیش از ثبت‌نام">
      <ul className="ps-small">
        <li>اعتباردهنده و طرف قرارداد اعتبار: <b>{r.bank}</b> (نه پی‌استار). تصمیم نهایی با بانک است و تأیید تضمین نمی‌شود.</li>
        <li>نمونه: خدمت <M v="400000000" /> در ۴ قسط <M v="112000000" /> (اول هنگام خرید، سپس ماهانه)؛ کمیسیون ثابت نمایشی ۱۲٪.</li>
        <li>هزینه استعلام اعتبارسنجی: <M v="500000" /> (جدا؛ در صورت عدم تحویل گزارش ظرف ۴۸ ساعت بازگردانده می‌شود).</li>
        <li>فقط شناسه، تماس، حساب تأییدشده، مدارک درآمد و مبلغ خدمت جمع‌آوری می‌شود؛ اطلاعات پزشکی خیر.</li>
      </ul>
    </Card>
    <Card title="شروع ثبت‌نام (فقط شناسه‌های نمایشی DEMO)"><Register token={decodeURIComponent(token)} /></Card>
  </>;
}
