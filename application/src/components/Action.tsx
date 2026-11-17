'use client';
/**
 * Every mutation: optional review step → single in-flight submit with Idempotency-Key →
 * durable reference or specific field errors (entered values preserved) → server data refresh.
 * Markup follows the PayStar UI kit (ps-form / ps-field / ps-btn / ps-confirm / ps-alert).
 */
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { toman, st } from '@/lib/fmt';
import Icon from './Icon';

export interface Field {
  name: string; label: string;
  type?: 'text' | 'select' | 'checkbox' | 'textarea' | 'file' | 'multicheck' | 'checks';
  options?: { value: string; label: string }[];
  defaultValue?: string; placeholder?: string; help?: string; ltr?: boolean;
  checks?: { sequence: number; total_irr: string; due: string }[];
}
export interface ActionProps {
  command: string; label: string; fixed?: Record<string, unknown>; fields?: Field[];
  confirm?: string; tone?: 'primary' | 'neutral' | 'danger'; inline?: boolean; scenarios?: { value: string; label: string }[];
}

const FIELD_FA: Record<string, string> = {
  REQUIRED: 'الزامی است', INVALID: 'نامعتبر است', AMOUNT_MISMATCH: 'مبلغ با قسط تطبیق ندارد', CREDITOR_MISMATCH: 'ذی‌نفع باید بانک باشد',
  INSUFFICIENT_CREDIT: 'اعتبار کافی نیست', MIN: 'کمتر از حداقل مجاز', INSUFFICIENT: 'بیش از موجودی قابل برداشت', OTP_INVALID: 'کد نادرست است',
  DUPLICATE: 'تکراری است', INVALID_MONEY: 'عدد صحیح ریالی وارد کنید', TYPE: 'نوع فایل مجاز نیست', SIZE: 'حجم فایل مجاز نیست',
};
const fe2fa = (c?: string) => (c ? FIELD_FA[c] ?? c : '');
const looksLtr = (f: Field) => f.ltr ?? /_irr$|card|otp|sayad|reference/.test(f.name);

function fmtVal(k: string, v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (k.endsWith('_irr') && /^-?\d+$/.test(String(v))) return toman(v);
  if (typeof v === 'object') return JSON.stringify(v);
  if (k === 'status' || k === 'service_status' || k === 'stage') return st(v);
  return String(v);
}

export default function Action(p: ActionProps) {
  const router = useRouter();
  const uid = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const keyRef = useRef<string>('');
  const [phase, setPhase] = useState<'edit' | 'review' | 'busy'>('edit');
  const [ok, setOk] = useState<{ reference: string; result: any } | null>(null);
  const [err, setErr] = useState<{ message: string; fields: Record<string, string> } | null>(null);

  async function collect(): Promise<Record<string, unknown>> {
    const fd = new FormData(formRef.current!);
    const input: Record<string, unknown> = { ...(p.fixed ?? {}) };
    for (const f of p.fields ?? []) {
      if (f.type === 'checkbox') input[f.name] = fd.get(f.name) === 'on';
      else if (f.type === 'multicheck') input[f.name] = fd.getAll(f.name).map(String);
      else if (f.type === 'file') {
        const file = fd.get(f.name) as File | null;
        if (file && file.size) {
          const buf = new Uint8Array(await file.arrayBuffer());
          let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
          input.base64 = btoa(bin); input.mime_type = file.type || 'application/octet-stream'; input.filename = file.name;
        }
      } else if (f.type === 'checks') {
        input.checks = (f.checks ?? []).map((c) => ({ sequence: c.sequence, sayad_id: String(fd.get(`sayad_${c.sequence}`) ?? ''), amount_irr: String(fd.get(`amount_${c.sequence}`) ?? ''), beneficiary: String(fd.get(`ben_${c.sequence}`) ?? '') }));
      } else input[f.name] = fd.get(f.name) ?? '';
    }
    if (p.scenarios) input.scenario = fd.get('scenario');
    return input;
  }

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (phase === 'busy') return;
    if (p.confirm && phase === 'edit') { setPhase('review'); return; }
    setPhase('busy'); setErr(null); setOk(null);
    if (!keyRef.current) keyRef.current = crypto.randomUUID();
    const input = await collect();
    try {
      const r = await fetch(`/api/v1/cmd/${p.command}`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': keyRef.current }, body: JSON.stringify(input) });
      const j = await r.json();
      if (!r.ok) {
        const fields: Record<string, string> = {};
        for (const fe of j.error?.field_errors ?? []) fields[fe.field] = fe.code;
        setErr({ message: j.error?.message ?? 'خطا', fields });
        if (r.status !== 409) keyRef.current = '';
      } else {
        setOk({ reference: j.reference, result: j.result });
        keyRef.current = '';
        setTimeout(() => router.refresh(), 150);
      }
    } catch {
      setErr({ message: 'ارتباط با سرور برقرار نشد؛ صفحه را تازه کنید (درخواست با همان کلید تکرارپذیر است).', fields: {} });
    }
    setPhase('edit');
  }

  // Newly revealed review/result content is brought fully on screen (on phones it could otherwise sit under the tab bar).
  const revealRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (phase === 'review' || ok || err) revealRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [phase, ok, err]);

  const fe = err?.fields ?? {};
  const btnClass = `ps-btn${p.inline ? ' ps-btn--sm' : ''}${p.tone === 'neutral' ? ' ps-btn--secondary' : p.tone === 'danger' ? ' ps-btn--danger' : ''}`;
  const id = (n: string) => `${uid}-${n}`;
  const fieldErr = (name: string) => fe[name] ?? Object.entries(fe).find(([k]) => k.startsWith(name + '.'))?.[1];

  const fields = (p.fields ?? []).map((f) => {
    const code = fieldErr(f.name);
    const errId = code ? id(f.name + '-err') : undefined;
    if (f.type === 'checkbox') return <div key={f.name} className="ps-field">
      <label className="ps-check"><input type="checkbox" name={f.name} defaultChecked={f.defaultValue === 'on'} aria-invalid={!!code} aria-describedby={errId} /> {f.label}</label>
      {code && <span className="ps-error-text" id={errId}>{fe2fa(code)}</span>}</div>;
    if (f.type === 'multicheck') return <fieldset key={f.name} className="ps-fieldset"><legend>{f.label}</legend>
      {f.options!.map((o) => <label key={o.value} className="ps-check"><input type="checkbox" name={f.name} value={o.value} /> {o.label}
        {fe[`consent.${o.value}`] && <span className="ps-error-text"> — الزامی</span>}</label>)}</fieldset>;
    if (f.type === 'checks') return <div key={f.name} className="ps-table-wrap"><table className="ps-table"><thead><tr><th>قسط</th><th>سررسید</th><th>شناسه صیاد</th><th>مبلغ چک (ریال)</th><th>ذی‌نفع</th></tr></thead><tbody>
      {f.checks!.map((c) => <tr key={c.sequence}><td>{c.sequence}</td><td>{c.due}</td>
        <td><input className="ps-input ps-input--ltr" name={`sayad_${c.sequence}`} defaultValue={`DEMO-SAYAD-${String(p.fixed?.checkout_id ?? '').slice(0, 8).toUpperCase()}-${c.sequence}`} aria-label={`شناسه صیاد قسط ${c.sequence}`} aria-invalid={!!fe[`check.${c.sequence}.sayad_id`]} />{fe[`check.${c.sequence}.sayad_id`] && <div className="ps-error-text">{fe2fa(fe[`check.${c.sequence}.sayad_id`])}</div>}</td>
        <td><input className="ps-input ps-input--ltr" name={`amount_${c.sequence}`} defaultValue={c.total_irr} aria-label="مبلغ" aria-invalid={!!fe[`check.${c.sequence}.amount_irr`]} />{fe[`check.${c.sequence}.amount_irr`] && <div className="ps-error-text">{fe2fa('AMOUNT_MISMATCH')}</div>}</td>
        <td><select className="ps-select" name={`ben_${c.sequence}`} aria-label="ذی‌نفع" aria-invalid={!!fe[`check.${c.sequence}.beneficiary`]}>{f.options!.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>{fe[`check.${c.sequence}.beneficiary`] && <div className="ps-error-text">{fe2fa('CREDITOR_MISMATCH')}</div>}</td></tr>)}
    </tbody></table></div>;
    const common = { id: id(f.name), name: f.name, 'aria-invalid': !!code, 'aria-describedby': errId ?? (f.help ? id(f.name + '-help') : undefined) };
    const control = f.type === 'select' ? <select className="ps-select" defaultValue={f.defaultValue} {...common}>{f.options!.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
      : f.type === 'textarea' ? <textarea className="ps-textarea" defaultValue={f.defaultValue} placeholder={f.placeholder} {...common} />
      : f.type === 'file' ? <div className="ps-file"><input type="file" accept="application/pdf,image/png,image/jpeg" {...common} /></div>
      : <input className={`ps-input${looksLtr(f) ? ' ps-input--ltr' : ''}`} defaultValue={f.defaultValue} placeholder={f.placeholder} {...common} />;
    if (p.inline) return <span key={f.name} className="ps-inline-field"><label className="ps-sr-only" htmlFor={id(f.name)}>{f.label}</label>{control}</span>;
    return <div key={f.name} className="ps-field">
      <label className="ps-label" htmlFor={id(f.name)}>{f.label}</label>{control}
      {f.help && !code && <span className="ps-help" id={id(f.name + '-help')}>{f.help}</span>}
      {code && <span className="ps-error-text" id={errId}>{fe2fa(code)}</span>}
    </div>;
  });

  const scenario = p.scenarios && (p.inline
    ? <span className="ps-inline-field"><label className="ps-sr-only" htmlFor={id('scenario')}>سناریوی شبیه‌ساز</label><select className="ps-select" id={id('scenario')} name="scenario">{p.scenarios.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select></span>
    : <div className="ps-field"><label className="ps-label" htmlFor={id('scenario')}>سناریوی شبیه‌ساز</label>
      <select className="ps-select" id={id('scenario')} name="scenario">{p.scenarios.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select>
      <span className="ps-help">نتیجه سرویس شبیه‌سازی‌شده را انتخاب کنید.</span></div>);

  return (
    <form ref={formRef} className={p.inline ? 'ps-inline-form' : 'ps-form'} onSubmit={submit} noValidate>
      {fields}{scenario}
      {phase === 'review'
        ? <div ref={revealRef} className="ps-confirm" role="status"><p className="ps-card__title">بررسی پیش از ارسال</p><p>{p.confirm}</p>
            <div className="ps-actions"><button type="submit" className="ps-btn">تأیید و ارسال</button><button type="button" className="ps-btn ps-btn--secondary" onClick={() => setPhase('edit')}>بازگشت و ویرایش</button></div></div>
        : <div className={p.inline ? '' : 'ps-actions'}><button type="submit" className={btnClass} disabled={phase === 'busy'} aria-busy={phase === 'busy'}>{phase === 'busy' ? 'در حال ثبت…' : p.label}</button></div>}
      {(err || ok) && <div ref={phase === 'review' ? undefined : revealRef} aria-live="polite" className={p.inline ? 'ps-inline-msg' : ''}>
        {err && <div className="ps-alert ps-alert--error" role="alert"><Icon name="alert" /><div><p className="ps-alert__title">ثبت نشد</p><p className="ps-alert__msg">{err.message}</p></div></div>}
        {ok && <div className="ps-alert ps-alert--success" role="status"><Icon name="check" /><div><p className="ps-alert__title">ثبت شد · مرجع <span className="ps-id">{ok.reference.slice(0, 8)}</span></p>
          {ok.result && typeof ok.result === 'object' && <p className="ps-alert__msg">{Object.entries(ok.result).filter(([k, v]) => !['quote', 'preview', 'basis'].includes(k) && (k === 'status' || k.endsWith('_irr')) && v !== null).slice(0, 4).map(([k, v]) => fmtVal(k, v)).join(' · ')}</p>}
          {ok.result?.url && <p className="ps-alert__msg">لینک: <a href={ok.result.url} target="_blank" className="ps-id">{ok.result.url}</a> (فقط همین یک بار نمایش داده می‌شود)</p>}</div></div>}
      </div>}
    </form>
  );
}
