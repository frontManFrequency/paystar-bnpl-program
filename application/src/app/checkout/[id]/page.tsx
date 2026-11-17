import { redirect } from 'next/navigation';
export default async function Old({ params }: { params: Promise<{ id: string }> }) { redirect(`/account/checkout/${(await params).id}`); }
