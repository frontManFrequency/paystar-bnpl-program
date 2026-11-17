import '../../paystar-ui-kit/paystar-ui.css';
import './globals.css';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { currentActor } from '@/server/session';
import { tx, MODEL_ID } from '@/server/db';
import { jdatetime, ROLE_FA } from '@/lib/fmt';
import Logout from '@/components/Logout';
import Icon from '@/components/Icon';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'پی‌استار — مدل ۴: بانک اعتباردهنده' };
export const viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#006d5c' };

export default async function Layout({ children }: { children: ReactNode }) {
  const actor = await currentActor();
  const st = await tx(null, (t) => t.one('SELECT clock, originations_paused FROM app_demo_state WHERE id=1'));
  return (
    <html lang="fa" dir="rtl">
      <body>
        <div className="ps-notice" role="note"><Icon name="warn" /><span className="app-long">محیط شبیه‌سازی: داده‌ها، امضاها، چک‌ها و پرداخت‌ها ساختگی‌اند و هیچ تراکنش، پیامک یا استعلام واقعی انجام نمی‌شود.</span><span className="app-short">محیط شبیه‌سازی — داده‌ها و تراکنش‌ها واقعی نیستند</span></div>
        <header className="ps-topbar">
          <Link href="/" className="ps-topbar__brand" style={{ color: 'inherit', textDecoration: 'none' }}>پی‌استار · مدل {MODEL_ID}</Link>
          <span className="ps-chip app-hide-sm" style={{ background: 'var(--ps-success-bg)', color: 'var(--ps-success-text)' }}>اعتباردهنده: بانک</span>
          {st.originations_paused && <span className="ps-chip" style={{ background: 'var(--ps-error-bg)', color: 'var(--ps-error-text)' }}>خرید جدید متوقف</span>}
          <div className="ps-topbar__end">
            <span className="ps-small ps-muted app-hide-sm">ساعت نمایشی: {jdatetime(st.clock)}</span>
            {actor ? <>
              <span>{actor.displayName} <span className="ps-small ps-muted">({ROLE_FA[actor.role]})</span></span>
              <Link href="/" className="ps-small">تغییر نقش</Link>
              <Logout />
            </> : <Link href="/" className="ps-btn ps-btn--sm">ورود</Link>}
          </div>
        </header>
        <div className="ps-container">{children}</div>
      </body>
    </html>
  );
}
