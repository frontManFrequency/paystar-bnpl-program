'use client';
import { useEffect, useState } from 'react';
import Icon from './Icon';
export default function Register({ token }: { token: string }) {
  const [busy, setBusy] = useState(false); const [sfx, setSfx] = useState('');
  useEffect(() => setSfx(Math.random().toString(36).slice(2, 7)), []);
  const [err, setErr] = useState<{ m: string; f: Record<string, string> } | null>(null);
  const field = (name: string, label: string, input: React.ReactNode, help?: string) => <div className="ps-field">
    <label className="ps-label" htmlFor={`rg-${name}`}>{label}</label>{input}
    {help && !err?.f[name] && <span className="ps-help">{help}</span>}
    {err?.f[name] && <span className="ps-error-text">{err.f[name] === 'REQUIRED' ? 'الزامی است' : err.f[name] === 'AGE_18_70' ? 'سن باید ۱۸ تا ۷۰ سال باشد' : 'نامعتبر است'}</span>}</div>;
  return <form className="ps-form" noValidate onSubmit={async (e) => {
    e.preventDefault(); setBusy(true); setErr(null);
    const fd = new FormData(e.currentTarget);
    const r = await fetch('/api/v1/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, first_name: fd.get('first_name'), last_name: fd.get('last_name'), national_id: fd.get('national_id'), mobile: fd.get('mobile'), birth_date: fd.get('birth_date') }) });
    const j = await r.json();
    if (r.ok) location.href = '/account/application'; else { setErr({ m: j.error?.message, f: Object.fromEntries((j.error?.field_errors ?? []).map((x: any) => [x.field, x.code])) }); setBusy(false); }
  }}>
    <div className="ps-grid ps-grid--wide">
      {field('first_name', 'نام', <input className="ps-input" id="rg-first_name" name="first_name" placeholder="مثلاً سمیرا" aria-invalid={!!err?.f.first_name} />)}
      {field('last_name', 'نام خانوادگی', <input className="ps-input" id="rg-last_name" name="last_name" placeholder="مثلاً قاسمی" aria-invalid={!!err?.f.last_name} />)}
      {field('national_id', 'کد ملی', <input className="ps-input ps-input--ltr" id="rg-national_id" name="national_id" key={`n${sfx}`} defaultValue={sfx && `DEMO-NID-${sfx}`} aria-invalid={!!err?.f.national_id} />, 'در این محیط فقط شناسه DEMO پذیرفته می‌شود.')}
      {field('mobile', 'موبایل', <input className="ps-input ps-input--ltr" id="rg-mobile" name="mobile" key={`m${sfx}`} defaultValue={sfx && `DEMO-MOBILE-${sfx}`} aria-invalid={!!err?.f.mobile} />)}
      {field('birth_date', 'تاریخ تولد (میلادی)', <input className="ps-input ps-input--ltr" id="rg-birth_date" name="birth_date" defaultValue="1990-01-01" aria-invalid={!!err?.f.birth_date} />)}
    </div>
    <div className="ps-actions"><button className="ps-btn" disabled={busy} aria-busy={busy}>{busy ? 'در حال ثبت…' : 'ادامه'}</button></div>
    {err && <div className="ps-alert ps-alert--error" role="alert"><Icon name="alert" /><div><p className="ps-alert__msg">{err.m}</p></div></div>}
  </form>;
}
