import type { ReactNode } from 'react';
import Link from 'next/link';
import { NAV } from '@/lib/nav';
import { ROLE_FA } from '@/lib/fmt';
import type { Actor } from '@/server/core';
import NavLinks, { Crumbs } from './NavLinks';
import Icon from './Icon';
import MobileNav from './MobileNav';
import { tx } from '@/server/db';
import { jdatetime } from '@/lib/fmt';

/** Role workspace frame (PayStar UI kit): sidebar navigation + page header with breadcrumbs. */
export default async function AppShell({ actor, orgName, children }: { actor: Actor; orgName?: string | null; children: ReactNode }) {
  const nav = NAV[actor.role];
  const st = await tx(null, (t) => t.one('SELECT clock FROM app_demo_state WHERE id=1'));
  return <div className="ps-layout">
    <nav className="ps-sidebar" aria-label="منوی اصلی">
      <div className="ps-sidebar__user">
        <span className="ps-avatar" aria-hidden="true">{actor.displayName.replace(/^دکتر /, '').slice(0, 1)}</span>
        <div><div className="ps-sidebar__user-name">{actor.displayName}</div><div className="ps-sidebar__user-role">{ROLE_FA[actor.role]}{orgName ? ` · ${orgName}` : ''}</div></div>
      </div>
      <NavLinks base={nav.base} items={nav.items} />
      <div className="ps-sidebar__footer"><Link className="ps-nav__link" href="/"><Icon name="swap" />تغییر نقش</Link></div>
    </nav>
    <main className="ps-main">
      <Crumbs base={nav.base} title={nav.title} items={nav.items} />
      {children}
    </main>
    <MobileNav base={nav.base} items={nav.items} tabs={nav.tabs} user={actor.displayName} role={ROLE_FA[actor.role]} org={orgName} clock={jdatetime(st.clock)} />
  </div>;
}

/** Dashboard navigation tiles for every section of the workspace. */
export function SectionTiles({ role, counts = {} }: { role: string; counts?: Record<string, ReactNode> }) {
  const nav = NAV[role];
  return <div className="ps-grid ps-grid--wide">{nav.items.filter((i) => i.key).map((i) => {
    const n = counts[i.key];
    const show = n !== undefined && n !== '۰' && n !== 0;
    return <Link key={i.key} href={`${nav.base}/${i.key}`} className="ps-tile">
      <span className="ps-tile__icon"><Icon name={i.icon} /></span>
      <span className="ps-tile__title">{i.label}</span>
      <span className="ps-tile__desc">{i.desc}</span>
      {show && <span className="ps-count" aria-label={`${n} مورد`}>{n}</span>}
    </Link>;
  })}</div>;
}
