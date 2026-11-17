import Catalog from '@/components/Catalog';
export const dynamic = 'force-dynamic';
export default async function Store({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <><h1>ویترین اختصاصی کلینیک</h1><Catalog slug={slug} /></>;
}
