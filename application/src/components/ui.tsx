import type { ReactNode } from 'react';
import Link from 'next/link';
import { toman, rial, st, jdate, jdatetime, fa, short } from '@/lib/fmt';
import type { Statement } from '@/server/services';
import type { TimelineRow } from '@/server/queries';

const TONE: Record<string, string> = {
  PAID: 'ok', CONFIRMED: 'ok', ACTIVE: 'ok', READY_FOR_SERVICE: 'ok', IN_CUSTODY: 'ok', SUCCEEDED: 'ok', FUNDED: 'ok', RELEASED: 'ok', MATCHED: 'ok', APPROVED: 'ok', SETTLED: 'ok', COMPLETED: 'ok', RECOVERED: 'ok',
  OVERDUE: 'bad', REJECTED: 'bad', FAILED: 'bad', HELD: 'bad', EXCEPTIONS: 'bad', EXPIRED: 'bad', LEGAL_REVIEW: 'bad', LEGAL_ACTIVE: 'bad',
  UNKNOWN: 'warn', PENDING: 'warn', AWAITING_FUNDS: 'warn', NEEDS_CORRECTION: 'warn', PAYMENT_PENDING: 'warn', SUBMITTED: 'warn', EXTERNAL_PENDING: 'warn', REQUESTED: 'warn', RELEASE_PENDING: 'warn', UNAPPLIED: 'warn', APPROVED_PENDING_CONTRACT: 'warn', QUEUED: 'warn', CREDITOR_REVIEW: 'info', PAYSTAR_REVIEW: 'info',
};
const KIT: Record<string, string> = { ok: 'success', bad: 'error', warn: 'warning', info: 'info' };
export const Badge = ({ s }: { s: unknown }) => { const t = TONE[String(s)]; return <span className={`ps-badge${t ? ` ps-badge--${KIT[t]}` : ''}`}>{st(s)}</span>; };
/** Toman primary amount with exact rial in the accessible title. */
export const M = ({ v }: { v: unknown }) => { const t = toman(v); const i = t.lastIndexOf(' '); return i < 0 ? <span>{t}</span> : <span className="money" title={rial(v)}><span className="num">{t.slice(0, i)}</span> {t.slice(i + 1)}</span>; };
export const Kpi = ({ l, v, s }: { l: string; v: ReactNode; s?: ReactNode }) => <div className="ps-stat"><span className="ps-stat__label">{l}</span><span className="ps-stat__value">{v}</span>{s && <span className="ps-stat__caption">{s}</span>}</div>;
export const Empty = ({ children }: { children: ReactNode }) => <p className="ps-empty">{children}</p>;
export const Card = ({ title, children, id }: { title?: ReactNode; children: ReactNode; id?: string }) => <section className="ps-card" id={id}>{title && <h2 className="ps-card__title">{title}</h2>}{children}</section>;

export function Table({ head, rows, empty }: { head: ReactNode[]; rows: ReactNode[][]; empty?: string }) {
  return <div className="ps-table-wrap app-cards-sm"><table className="ps-table"><thead><tr>{head.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
    <tbody>{rows.length ? rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} data-label={typeof head[j] === 'string' ? (head[j] as string) : undefined}>{c}</td>)}</tr>)
      : <tr><td colSpan={head.length} className="ps-table__empty">{empty ?? 'موردی وجود ندارد.'}</td></tr>}</tbody></table></div>;
}

export function StatementView({ s, href }: { s: Statement; href?: string }) {
  const t = s.totals;
  return <>
    <div className="ps-grid">
      <Kpi l="اصل تأمین‌شده (P)" v={<M v={t.principal} />} s={`اعتباردهنده: ${s.purchase.creditor_name}`} />
      <Kpi l="کمیسیون کل (۱۲٪ ثابت نمایشی)" v={<M v={t.commission} />} />
      <Kpi l="مانده اصل" v={<M v={t.outstandingPrincipal} />} />
      <Kpi l="مانده کمیسیون" v={<M v={t.outstandingCommission} />} />
      <Kpi l="مبلغ تسویه زودهنگام" v={<M v={t.payoff} />} s="کمیسیون پرداخت‌شده دوباره دریافت نمی‌شود" />
      <Kpi l="سررسید گذشته" v={<M v={t.overdue} />} s={s.dpd ? `DPD ${fa(s.dpd)}` : 'بدون تأخیر'} />
    </div>
    <Table head={['قسط', 'سررسید (جلالی)', 'اصل', 'کمیسیون', 'پرداخت‌شده', 'لغوشده', 'بازگشت به کیف', 'مانده', 'وضعیت']}
      rows={s.installments.map((i) => [fa(i.sequence), <span key="d">{fa(i.due_local_date)}<div className="ps-small ps-muted ps-id">{new Date(i.due_at).toISOString().slice(0, 10)}</div></span>,
        <M key="p" v={i.principal_irr} />, <M key="c" v={i.commission_irr} />, <M key="pd" v={i.principal_paid_irr + i.commission_paid_irr} />,
        <M key="cn" v={i.principal_cancelled_irr + i.commission_cancelled_irr} />, <M key="rf" v={i.principal_refunded_irr + i.commission_refunded_irr} />,
        <M key="r" v={i.residual.total} />, <span key="s"><Badge s={i.projected} />{i.dpd > 0 && <span className="ps-small"> DPD {fa(i.dpd)}</span>}</span>])} />
    {href && <Link className="ps-btn ps-btn--secondary ps-btn--sm" style={{ alignSelf: 'flex-start' }} href={href}>صورت‌حساب کامل و ردگیری اسناد</Link>}
  </>;
}

export function TimelineView({ rows }: { rows: TimelineRow[] }) {
  return <Table head={['زمان', 'رویداد', 'مرجع', 'شرح', 'مبلغ']} rows={rows.map((r) => [jdatetime(r.at), r.kind, <span key="r" className="ps-id">{r.ref}</span>, r.detail, r.amount ? <M key="m" v={r.amount} /> : ''])} />;
}

export { toman, rial, st, jdate, jdatetime, fa, short };
