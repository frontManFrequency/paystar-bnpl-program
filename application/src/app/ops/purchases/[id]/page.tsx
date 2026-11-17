import StatementDetail from '@/components/StatementDetail';
import { requirePageRole } from '@/server/session';

export const dynamic = 'force-dynamic';
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePageRole('paystar-admin');
  const { id } = await params;
  return <StatementDetail id={id} actor={actor} back="/ops/purchases" />;
}
