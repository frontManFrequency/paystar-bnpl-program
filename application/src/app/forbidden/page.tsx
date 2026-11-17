import Link from 'next/link';
export default function Forbidden() {
  return <section className="ps-card"><h1>دسترسی مجاز نیست</h1><p>این صفحه در محدوده نقش فعلی شما نیست. بررسی در سرور انجام شد و هیچ داده‌ای نمایش داده نشد.</p><Link href="/">بازگشت و انتخاب نقش</Link></section>;
}
