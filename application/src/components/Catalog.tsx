import Link from 'next/link';
import { tx } from '@/server/db';
import { clock } from '@/server/core';
import { M } from '@/components/ui';

export default async function Catalog({ slug }: { slug?: string }) {
  const d = await tx(null, async (t) => ({ now: await clock(t), items: await t.q(`SELECT c.*, o.name clinic, o.slug FROM catalog_items c JOIN organizations o ON o.id=c.business_id WHERE o.status='ACTIVE' ${slug ? 'AND o.slug=$1' : ''} ORDER BY c.price_irr`, slug ? [slug] : []) }));
  const fresh = d.items.filter((i: any) => i.available && +d.now - +new Date(i.source_updated_at) <= 86400000);
  if (!fresh.length) return <p className="ps-empty">خدمت قابل خرید با قیمت تازه یافت نشد.</p>;
  return <div className="ps-grid ps-grid--wide">{fresh.map((i: any) => <article key={i.id} className="ps-product">
    <img className="ps-product__img" src={i.image_url} alt="" />
    <div className="ps-product__body">
      <span className="ps-product__title">{i.title}</span>
      <span className="ps-product__price"><M v={i.price_irr} /></span>
      <span className="ps-small ps-muted">{i.clinic} · ۴ قسط حدود <M v={(BigInt(i.price_irr) * 112n / 100n / 4n).toString()} /></span>
      <Link className="ps-small" href={`/b/${i.slug}`}>ویترین کلینیک</Link>
    </div>
  </article>)}</div>;
}
