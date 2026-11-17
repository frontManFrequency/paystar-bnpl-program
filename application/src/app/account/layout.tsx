import type { ReactNode } from 'react';
import { requirePageRole } from '@/server/session';
import AppShell from '@/components/AppShell';

export const dynamic = 'force-dynamic';
export default async function Layout({ children }: { children: ReactNode }) {
  const actor = await requirePageRole('customer');
  return <AppShell actor={actor}>{children}</AppShell>;
}
