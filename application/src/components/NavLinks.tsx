'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { NavItem } from '@/lib/nav';
import Icon from './Icon';

const active = (path: string, base: string, key: string) => (key ? path === `${base}/${key}` || path.startsWith(`${base}/${key}/`) : path === base);

export default function NavLinks({ base, items }: { base: string; items: NavItem[] }) {
  const path = usePathname();
  return <ul className="ps-nav">{items.map((i) => {
    const on = active(path, base, i.key);
    return <li key={i.key || 'home'}><Link href={i.key ? `${base}/${i.key}` : base} className="ps-nav__link" aria-current={on ? 'page' : undefined}>
      <Icon name={i.icon} />{i.label}</Link></li>;
  })}</ul>;
}

export function Crumbs({ base, title, items }: { base: string; title: string; items: NavItem[] }) {
  const path = usePathname();
  const rest = path.slice(base.length).split('/').filter(Boolean);
  const section = items.find((i) => i.key && i.key === rest[0]);
  const detail = rest[1] ? (rest[0] === 'checkout' ? 'پیش‌فاکتور خرید' : 'جزئیات') : null;
  return <div className="ps-page-header">
    <ol className="ps-breadcrumbs" aria-label="مسیر">
      <li><Link href={base}>{title}</Link></li>
      {section && (detail ? <li><Link href={`${base}/${section.key}`}>{section.label}</Link></li> : <li aria-current="page">{section.label}</li>)}
      {detail && <li aria-current="page">{detail} <span className="ps-id">{rest[1].slice(0, 8)}</span></li>}
    </ol>
    <h1 className="ps-page-title">{detail ?? section?.label ?? 'داشبورد'}</h1>
  </div>;
}
