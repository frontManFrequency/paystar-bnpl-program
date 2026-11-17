'use client';
import { useState } from 'react';
import Icon from './Icon';
export interface DemoUser { key: string; label: string; role: string; roleFa: string; hint?: string }

const COLUMNS: { role: string; title: string; icon: string }[] = [
  { role: 'super-admin', title: 'مدیر ارشد', icon: 'settings' },
  { role: 'paystar-admin', title: 'ادمین پی‌استار', icon: 'audit' },
  { role: 'business-admin', title: 'کلینیک', icon: 'building' },
  { role: 'bank', title: 'بانک', icon: 'law' },
  { role: 'customer', title: 'مشتری', icon: 'users' },
];

export default function RoleSwitcher({ users, current }: { users: DemoUser[]; current?: string | null }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  async function go(key: string) {
    setBusy(key); setErr(null);
    const r = await fetch('/api/v1/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key }) });
    const j = await r.json();
    if (!r.ok) { setErr(j.error?.message ?? 'خطا'); setBusy(null); return; }
    location.href = j.home;
  }
  return <>
    {err && <div className="ps-alert ps-alert--error" role="alert"><Icon name="alert" /><div><p className="ps-alert__msg">{err}</p></div></div>}
    <div className="ps-roles">
      {COLUMNS.map((c) => {
        const list = users.filter((u) => u.role === c.role);
        return <div key={c.role} className="ps-role">
          <div className="ps-role__head"><Icon name={c.icon} />{c.title}</div>
          {list.map((u) => <button key={u.key} type="button" className="ps-role__user" disabled={!!busy} aria-busy={busy === u.key}
            aria-pressed={current === u.key} onClick={() => go(u.key)}><strong>{u.label}</strong>{u.hint && <span>{u.hint}</span>}</button>)}
          {c.role === 'customer' && <a className="ps-btn ps-btn--add" href="/r/DEMO-REFERRAL-TOKEN">+ ثبت‌نام مشتری جدید</a>}
        </div>;
      })}
    </div>
  </>;
}
