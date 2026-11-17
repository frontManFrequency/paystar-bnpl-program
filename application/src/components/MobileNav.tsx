'use client';
/**
 * Mobile navigation (≤768px): bottom tab bar with the role's main sections + «بیشتر» bottom sheet
 * holding the remaining sections, the user block, demo clock, role switch and logout.
 * Built from PayStar UI kit tokens; hidden on desktop where the sidebar is used.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { NavItem } from '@/lib/nav';
import Icon from './Icon';

const isActive = (path: string, base: string, key: string) => (key ? path === `${base}/${key}` || path.startsWith(`${base}/${key}/`) : path === base);

export default function MobileNav({ base, items, tabs, user, role, org, clock }: {
  base: string; items: NavItem[]; tabs: string[]; user: string; role: string; org?: string | null; clock: string;
}) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const moreBtn = useRef<HTMLButtonElement>(null);
  const tabItems = tabs.map((k) => items.find((i) => i.key === k)!).filter(Boolean);
  const rest = items.filter((i) => !tabs.includes(i.key));
  const moreActive = rest.some((i) => isActive(path, base, i.key));

  useEffect(() => { setOpen(false); }, [path]);
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    sheetRef.current?.querySelector<HTMLElement>('a,button')?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey); moreBtn.current?.focus(); };
  }, [open]);

  return <>
    <nav className="app-tabbar" aria-label="منوی اصلی">
      {tabItems.map((i) => {
        const on = isActive(path, base, i.key);
        return <Link key={i.key || 'home'} href={i.key ? `${base}/${i.key}` : base} className="app-tab" aria-current={on ? 'page' : undefined}>
          <Icon name={i.icon} /><span>{i.short ?? i.label}</span></Link>;
      })}
      <button ref={moreBtn} type="button" className="app-tab" aria-haspopup="dialog" aria-expanded={open} aria-current={moreActive ? 'page' : undefined} onClick={() => setOpen(true)}>
        <Icon name="list" /><span>بیشتر</span></button>
    </nav>
    {open && <div className="app-sheet-backdrop" onClick={() => setOpen(false)}>
      <div ref={sheetRef} className="app-sheet" role="dialog" aria-modal="true" aria-label="منوی بیشتر" onClick={(e) => e.stopPropagation()}>
        <div className="app-sheet__handle" aria-hidden="true" />
        <div className="ps-sidebar__user">
          <span className="ps-avatar" aria-hidden="true">{user.replace(/^دکتر /, '').slice(0, 1)}</span>
          <div><div className="ps-sidebar__user-name">{user}</div><div className="ps-sidebar__user-role">{role}{org ? ` · ${org}` : ''}</div></div>
        </div>
        <ul className="ps-nav">{rest.map((i) => <li key={i.key || 'home'}>
          <Link className="ps-nav__link" href={i.key ? `${base}/${i.key}` : base} aria-current={isActive(path, base, i.key) ? 'page' : undefined}>
            <Icon name={i.icon} /><span><span>{i.label}</span><span className="app-sheet__desc">{i.desc}</span></span></Link></li>)}</ul>
        <p className="ps-small ps-muted">ساعت نمایشی: {clock}</p>
        <div className="ps-actions">
          <Link className="ps-btn ps-btn--secondary" href="/"><Icon name="swap" />تغییر نقش</Link>
          <button type="button" className="ps-btn ps-btn--secondary" onClick={async () => { await fetch('/api/v1/session', { method: 'DELETE' }); location.href = '/'; }}><Icon name="logout" dir />خروج</button>
          <button type="button" className="ps-btn" onClick={() => setOpen(false)}>بستن</button>
        </div>
      </div>
    </div>}
  </>;
}
