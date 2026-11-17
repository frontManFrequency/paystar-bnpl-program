'use client';
import { useState } from 'react';
export default function ResetForm({ phrase }: { phrase: string }) {
  const [v, setV] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  return <form className="ps-form" onSubmit={async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    const r = await fetch('/api/v1/demo/reset', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phrase: v }) });
    if (r.ok) location.href = '/'; else { setErr((await r.json()).error?.message ?? 'خطا'); setBusy(false); }
  }}>
    <div className="ps-field"><label className="ps-label" htmlFor="reset-phrase">برای تأیید بنویسید: <span className="ps-id">{phrase}</span></label>
      <input id="reset-phrase" value={v} onChange={(e) => setV(e.target.value)} className="ps-input ps-input--ltr" /></div>
    <div className="ps-actions"><button className="ps-btn ps-btn--danger" disabled={busy || v !== phrase} aria-busy={busy}>{busy ? 'در حال بازنشانی…' : 'بازنشانی مدل'}</button></div>
    {err && <span className="ps-error-text">{err}</span>}
  </form>;
}
