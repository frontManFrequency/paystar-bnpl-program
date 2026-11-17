import { redirect } from 'next/navigation';
import { requirePageRole } from '@/server/session';
import StatementDetail from '@/components/StatementDetail';

export const dynamic = 'force-dynamic';
const DETAIL: Record<string, string> = { customer: '/account/purchases', 'business-admin': '/business/purchases', 'paystar-admin': '/ops/purchases', bank: '/bank/loans' };
/** Legacy URL: role users go to the statement nested in their own workspace. */
export default async function StatementPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePageRole('customer', 'business-admin', 'paystar-admin', 'bank', 'super-admin');
  const { id } = await params;
  if (DETAIL[actor.role]) redirect(`${DETAIL[actor.role]}/${id}`);
  return <StatementDetail id={id} actor={actor} />;
}
