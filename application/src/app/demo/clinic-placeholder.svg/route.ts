/** Generated clinic placeholder image (no external assets). */
export function GET() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><rect width="320" height="180" fill="#e6f0ee"/><circle cx="160" cy="80" r="42" fill="#fff" stroke="#2f6f62" stroke-width="4"/><path d="M140 68c0-12 8-18 20-18s20 6 20 18c0 10-4 16-6 28-2 10-4 14-7 14s-3-10-7-10-4 10-7 10-5-4-7-14c-2-12-6-18-6-28z" fill="#2f6f62"/><text x="160" y="160" font-family="Tahoma, sans-serif" font-size="14" text-anchor="middle" fill="#2f6f62">کلینیک دندان‌پزشکی</text></svg>`;
  return new Response(svg, { headers: { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=86400' } });
}
