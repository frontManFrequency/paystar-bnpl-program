import type { ReactNode } from 'react';
import { requirePageRole } from '@/server/session';
import { tx } from '@/server/db';
import AppShell from '@/components/AppShell';

export const dynamic = 'force-dynamic';
export default async function Layout({ children }: { children: ReactNode }) {
  const actor = await requirePageRole('bank');
  const org = actor.orgId ? await tx(null, (t) => t.one('SELECT name FROM organizations WHERE id=$1', [actor.orgId])) : null;
  return <AppShell actor={actor} orgName={org?.name}>{children}</AppShell>;
}
