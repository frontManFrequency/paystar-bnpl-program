'use client';
/**
 * One form for the whole customer submission. It runs the same server commands as the
 * step-by-step forms, in order: start → identity+consents → account → documents → submit → fee → credit report.
 * Every step is validated, idempotent and audited on the server; the first failure stops the run.
 */
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import Icon from './Icon';

interface Props { applicationId: string | null; consents: { value: string; label: string; text: string }[]; feeToman: string; defaultAmountToman?: number; defaultCount?: number }
type StepState = 'wait' | 'run' | 'ok' | 'err';

const STEPS = [
  { key: 'start', label: 'ایجاد درخواست' },
  { key: 'terms', label: 'ثبت مبلغ و تعداد اقساط' },
  { key: 'identity', label: 'تأیید کد و ثبت رضایت‌ها' },
  { key: 'account', label: 'تطبیق کارت با هویت' },
  { key: 'docs', label: 'بارگذاری مدرک هویت و درآمد' },
  { key: 'submit', label: 'ارسال مدارک' },
  { key: 'fee', label: 'پرداخت هزینه استعلام' },
  { key: 'report', label: 'دریافت گزارش اعتباری و ارسال برای بررسی' },
];

async function fileToB64(f: File) {
  const buf = new Uint8Array(await f.arrayBuffer());
  let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

const COUNTS = [2, 3, 4, 6];
const FA = (n: number | bigint) => n.toLocaleString('fa-IR');

export default function QuickApply({ applicationId, consents, feeToman, defaultAmountToman = 40000000, defaultCount = 4 }: Props) {
  const [amountM, setAmountM] = useState(Math.round(defaultAmountToman / 1000000));
  const [count, setCount] = useState(defaultCount);
  const perPayment = Math.round((amountM * 1000000 * 1.12) / count);
  const router = useRouter();
  const [state, setState] = useState<Record<string, StepState>>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const steps = applicationId ? STEPS.filter((s) => s.key !== 'start') : STEPS;

  async function call(name: string, input: Record<string, unknown>) {
    const r = await fetch(`/api/v1/cmd/${name}`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify(input) });
    const j = await r.json();
    if (!r.ok) {
      const fields = (j.error?.field_errors ?? []).map((f: any) => f.field).join('، ');
      throw new Error(`${j.error?.message ?? 'خطا'}${fields ? ` (${fields})` : ''}`);
    }
    return j.result;
  }

  async function run(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const fd = new FormData(e.currentTarget);
    setBusy(true); setError(null); setState({});
    let id = applicationId;
    let current = '';
    const mark = (k: string, s: StepState) => setState((p) => ({ ...p, [k]: s }));
    try {
      for (const s of steps) {
        current = s.key; mark(s.key, 'run');
        if (s.key === 'start') id = (await call('application.start', {})).application_id;
        if (s.key === 'terms') await call('application.terms', { application_id: id, requested_limit_irr: String(amountM * 10000000), installment_count: count });
        if (s.key === 'identity') await call('application.identity', { application_id: id, otp: fd.get('otp'), consents: fd.getAll('consents') });
        if (s.key === 'account') await call('application.account', { application_id: id, card: fd.get('card') });
        if (s.key === 'docs') for (const category of ['IDENTITY', 'INCOME']) {
          const f = fd.get(`file_${category}`) as File | null;
          await call('application.document', f && f.size ? { application_id: id, category, mime_type: f.type, base64: await fileToB64(f) } : { application_id: id, category, sample: true });
        }
        if (s.key === 'submit') await call('application.submit_evidence', { application_id: id });
        if (s.key === 'fee') {
          const r = await call('application.pay_fee', { application_id: id, scenario: 'success' });
          void r;
        }
        if (s.key === 'report') await call('application.run_assessment', { application_id: id, scenario: 'normal' });
        mark(s.key, 'ok');
      }
      setDone(true);
    } catch (err) {
      mark(current, 'err');
      setError((err as Error).message);
    }
    setBusy(false);
    router.refresh();
  }

  if (done) return <div className="ps-alert ps-alert--success" role="status"><Icon name="check" /><div><p className="ps-alert__title">درخواست شما ثبت شد</p>
    <p className="ps-alert__msg">اکنون در صف بررسی پی‌استار است. پس از تأیید پی‌استار برای تصمیم نهایی به بانک می‌رود.</p></div></div>;
  return <form className="ps-form" onSubmit={run} noValidate>
    <fieldset className="ps-fieldset">
      <legend>مبلغ اعتبار و تعداد اقساط</legend>
      <div className="ps-grid ps-grid--wide">
        <div className="ps-field"><label className="ps-label" htmlFor="qa-amount">مبلغ اعتبار درخواستی (میلیون تومان) <span className="ps-req" aria-hidden="true">*</span></label>
          <input id="qa-amount" type="number" inputMode="numeric" min={1} max={40} step={1} value={amountM} className="ps-input ps-input--ltr"
            onChange={(e) => setAmountM(Math.max(1, Math.min(40, Math.round(Number(e.target.value) || 1))))} aria-describedby="qa-amount-h" />
          <input type="range" min={1} max={40} step={1} value={amountM} onChange={(e) => setAmountM(Number(e.target.value))} aria-label="مبلغ اعتبار" className="app-range" />
          <span className="ps-help" id="qa-amount-h">بین ۱ تا ۴۰ میلیون تومان. سقف نهایی را بانک تعیین می‌کند و از این مبلغ بیشتر نمی‌شود.</span></div>
        <div className="ps-field"><span className="ps-label" id="qa-count-l">تعداد اقساط هر خرید <span className="ps-req" aria-hidden="true">*</span></span>
          <div className="app-segment" role="radiogroup" aria-labelledby="qa-count-l">
            {COUNTS.map((n) => <button key={n} type="button" role="radio" aria-checked={count === n} className="app-segment__opt" onClick={() => setCount(n)}>{FA(n)} قسط</button>)}
          </div>
          <span className="ps-help">قسط اول هنگام خرید و بقیه ماهانه. کمیسیون ثابت ۱۲٪ است و به تعداد اقساط بستگی ندارد.</span></div>
      </div>
      <div className="ps-alert ps-alert--success ps-alert--block" aria-live="polite">با خرید کامل این مبلغ: {FA(count)} قسط حدود <strong>{FA(perPayment)} تومان</strong> · جمع {FA(Math.round(amountM * 1000000 * 1.12))} تومان (شامل ۱۲٪ کمیسیون)</div>
    </fieldset>
    <div className="ps-grid ps-grid--wide">
      <div className="ps-field"><label className="ps-label" htmlFor="qa-otp">کد پیامکی (۶ رقم) <span className="ps-req" aria-hidden="true">*</span></label>
        <input id="qa-otp" name="otp" inputMode="numeric" placeholder="123456" className="ps-input ps-input--ltr" required aria-describedby="qa-otp-h" />
        <span className="ps-help" id="qa-otp-h">در این محیط پیامک ارسال نمی‌شود؛ کد ۱۲۳۴۵۶ است.</span></div>
      <div className="ps-field"><label className="ps-label" htmlFor="qa-card">شماره کارت بانکی</label>
        <input id="qa-card" name="card" defaultValue="DEMO-CARD-1234" className="ps-input ps-input--ltr" aria-describedby="qa-card-h" />
        <span className="ps-help" id="qa-card-h">فقط ۴ رقم آخر نگه داشته می‌شود؛ CVV2 و رمز دریافت نمی‌شود.</span></div>
      <div className="ps-field"><span className="ps-label" id="qa-f1">مدرک هویتی (اختیاری)</span>
        <div className="ps-file"><input type="file" name="file_IDENTITY" accept="application/pdf,image/png,image/jpeg" aria-labelledby="qa-f1" /></div>
        <span className="ps-help">اگر فایلی انتخاب نشود، تصویر نمونه ثبت می‌شود.</span></div>
      <div className="ps-field"><span className="ps-label" id="qa-f2">مدرک درآمد (اختیاری)</span>
        <div className="ps-file"><input type="file" name="file_INCOME" accept="application/pdf,image/png,image/jpeg" aria-labelledby="qa-f2" /></div></div>
    </div>
    <fieldset className="ps-fieldset">
      <legend>رضایت‌ها (هر کدام جداگانه) <span className="ps-req" aria-hidden="true">*</span></legend>
      {consents.map((c) => <label key={c.value} className="ps-check"><input type="checkbox" name="consents" value={c.value} /> <span><strong>{c.label}</strong> <span className="ps-small ps-muted">— {c.text}</span></span></label>)}
    </fieldset>
    <div className="ps-alert" role="note"><Icon name="info" /><div><p className="ps-alert__msg">با ارسال، هزینه استعلام اعتبارسنجی <strong>{feeToman}</strong> پرداخت می‌شود. تصمیم نهایی اعتبار با بانک است و تأیید تضمین نمی‌شود.</p></div></div>
    <div className="ps-actions"><button className="ps-btn" disabled={busy} aria-busy={busy}>{busy ? 'در حال ارسال…' : 'ثبت درخواست اعتبار'}</button></div>
    {Object.keys(state).length > 0 && <ul className="ps-checklist" aria-live="polite">
      {steps.map((s) => { const v = state[s.key]; const cls = v === 'ok' ? 'is-done' : v === 'run' ? 'is-pending' : v === 'err' ? 'is-failed' : 'is-todo';
        return <li key={s.key} className={cls}><span className="ps-checklist__mark" aria-hidden="true">{v === 'ok' ? '✓' : v === 'run' ? '…' : v === 'err' ? '✗' : ''}</span>
          <span className="ps-checklist__text">{s.label}{v === 'err' && error && <small>{error}</small>}</span></li>; })}
    </ul>}
    {error && <div className="ps-alert ps-alert--error" role="alert"><Icon name="alert" /><div><p className="ps-alert__title">ارسال متوقف شد</p><p className="ps-alert__msg">{error}</p></div></div>}
  </form>;
}
