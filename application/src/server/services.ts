/** Shared read/compute services: one statement computation used by every role view. */
import { MODEL_ID, Q } from './db';
import { addDays, big, clock, dayDiff, iso, notify, outbox, parties, post, sum, tehranIso } from './core';
import { availableCredit } from './kit';

export interface InstallmentRow {
  id: string; purchase_id: string; sequence: number; due_at: Date; due_local_date: string;
  principal_irr: bigint; commission_irr: bigint; penalty_irr: bigint;
  principal_paid_irr: bigint; commission_paid_irr: bigint; penalty_paid_irr: bigint;
  principal_cancelled_irr: bigint; commission_cancelled_irr: bigint;
  principal_refunded_irr: bigint; commission_refunded_irr: bigint; status: string; schedule_version: number;
}

export function residual(i: InstallmentRow) {
  const principal = i.principal_irr - i.principal_paid_irr - i.principal_cancelled_irr;
  const commission = i.commission_irr - i.commission_paid_irr - i.commission_cancelled_irr;
  const penalty = i.penalty_irr - i.penalty_paid_irr;
  return { principal, commission, penalty, total: principal + commission + penalty };
}

/** Installment status is a projection of due date and component balances. */
export function projectStatus(i: InstallmentRow, now: Date): string {
  if (i.status === 'SUPERSEDED') return 'SUPERSEDED';
  const r = residual(i);
  const live = i.principal_irr - i.principal_cancelled_irr + i.commission_irr - i.commission_cancelled_irr;
  if (live === 0n) return 'CANCELLED';
  if (r.total === 0n) return 'PAID';
  if (new Date(i.due_at) < now) return 'OVERDUE';
  if (i.principal_paid_irr + i.commission_paid_irr > 0n) return 'PARTIALLY_PAID';
  if (tehranIso(new Date(i.due_at)) === tehranIso(now)) return 'DUE';
  return i.principal_cancelled_irr > 0n ? 'PARTIALLY_CANCELLED' : 'SCHEDULED';
}

export async function installments(t: Q, purchaseId: string): Promise<InstallmentRow[]> {
  return t.q<InstallmentRow>("SELECT * FROM installments WHERE purchase_id=$1 AND status<>'SUPERSEDED' ORDER BY due_at, sequence", [purchaseId]);
}

export async function refreshInstallmentStatuses(t: Q, purchaseId: string) {
  const now = await clock(t);
  for (const i of await installments(t, purchaseId)) {
    const s = projectStatus(i, now);
    if (s !== i.status) await t.q('UPDATE installments SET status=$2, version=version+1, updated_at=now() WHERE id=$1', [i.id, s]);
  }
}

export interface Statement {
  purchase: any; installments: (InstallmentRow & { residual: ReturnType<typeof residual>; projected: string; dpd: number })[];
  totals: { principal: bigint; commission: bigint; outstandingPrincipal: bigint; outstandingCommission: bigint; payoff: bigint; paidPrincipal: bigint; paidCommission: bigint; cancelledPrincipal: bigint; cancelledCommission: bigint; refundedPrincipal: bigint; refundedCommission: bigint; overdue: bigint };
  dpd: number;
}

export async function statement(t: Q, purchaseId: string): Promise<Statement | null> {
  const purchase = await t.one(`SELECT p.*, c.name AS clinic_name, o.name AS creditor_name, u.display_name AS customer_name, cu.user_id AS customer_user_id
     FROM purchases p JOIN organizations c ON c.id=p.business_id JOIN organizations o ON o.id=p.current_owner_id
     JOIN customers cu ON cu.id=p.customer_id JOIN users u ON u.id=cu.user_id WHERE p.id=$1`, [purchaseId]);
  if (!purchase) return null;
  const now = await clock(t);
  const today = tehranIso(now);
  const rows = (await installments(t, purchaseId)).map((i) => {
    const r = residual(i);
    const due = tehranIso(new Date(i.due_at));
    const overdue = r.total > 0n && new Date(i.due_at) < now;
    return { ...i, residual: r, projected: projectStatus(i, now), dpd: overdue ? Math.max(0, dayDiff(today, due)) : 0 };
  });
  const totals = {
    principal: purchase.principal_irr as bigint, commission: purchase.commission_irr as bigint,
    outstandingPrincipal: sum(rows.map((r) => r.residual.principal)),
    outstandingCommission: sum(rows.map((r) => r.residual.commission)),
    payoff: sum(rows.map((r) => r.residual.total)),
    paidPrincipal: sum(rows.map((r) => r.principal_paid_irr)), paidCommission: sum(rows.map((r) => r.commission_paid_irr)),
    cancelledPrincipal: sum(rows.map((r) => r.principal_cancelled_irr)), cancelledCommission: sum(rows.map((r) => r.commission_cancelled_irr)),
    refundedPrincipal: sum(rows.map((r) => r.principal_refunded_irr)), refundedCommission: sum(rows.map((r) => r.commission_refunded_irr)),
    overdue: sum(rows.filter((r) => r.dpd > 0).map((r) => r.residual.total)),
  };
  return { purchase, installments: rows, totals, dpd: Math.max(0, ...rows.map((r) => r.dpd)) };
}

export interface LineState { line: any; available: bigint; spendable: bigint; blockedReasons: string[]; expired: boolean; overdue: boolean }
export async function lineState(t: Q, lineId: string): Promise<LineState | null> {
  const line = await t.one('SELECT * FROM credit_lines WHERE id=$1', [lineId]);
  if (!line) return null;
  const now = await clock(t);
  const expired = new Date(line.expires_at) <= now;
  const od = await t.one<{ n: number }>(`SELECT count(*)::int AS n FROM installments i JOIN purchases p ON p.id=i.purchase_id
     WHERE p.customer_id=$1 AND i.status<>'SUPERSEDED' AND i.due_at < $2
       AND (i.principal_irr-i.principal_paid_irr-i.principal_cancelled_irr)+(i.commission_irr-i.commission_paid_irr-i.commission_cancelled_irr)+(i.penalty_irr-i.penalty_paid_irr) > 0`, [line.customer_id, iso(now)]);
  const overdue = (od?.n ?? 0) > 0;
  const blockedReasons: string[] = [];
  if (line.status === 'APPROVED_PENDING_CONTRACT') blockedReasons.push('قرارداد بانک هنوز امضا نشده است');
  if (line.status === 'HELD') blockedReasons.push(`توقف مصرف: ${line.hold_reason ?? ''}`);
  if (expired) blockedReasons.push('اعتبار تأیید یا ارزیابی منقضی شده است؛ تمدید مدارک لازم است');
  if (overdue) blockedReasons.push('قسط سررسید گذشته پرداخت نشده است');
  const { available, spendable } = availableCredit({
    limit: big(line.limit_irr), outstanding: big(line.outstanding_principal_irr), reserved: big(line.reserved_principal_irr),
    held: line.status !== 'ACTIVE' || overdue, expired,
  });
  return { line, available, spendable, blockedReasons, expired, overdue };
}

// ------------------------------------------------------------------ scheduled jobs
async function recordJob(t: Q, type: string, key: string, payload: object) {
  const now = await clock(t);
  await t.q(`INSERT INTO jobs(model_id,job_key,job_type,payload,run_at,status,attempts) VALUES ($1,$2,$3,$4,$5,'DONE',1)
     ON CONFLICT (model_id,job_key) DO UPDATE SET attempts=jobs.attempts+1, payload=EXCLUDED.payload, updated_at=now()`, [MODEL_ID, key, type, JSON.stringify(payload), iso(now)]);
}

/** Reservation expiry: release credit and exposure; never revive later. */
export async function expireReservations(t: Q) {
  const now = await clock(t);
  const rows = await t.q(`SELECT c.id, c.credit_line_id, c.principal_irr, o.business_id FROM checkouts c JOIN orders o ON o.id=c.order_id
     WHERE c.status IN ('RESERVED','CONTRACT_READY','PAYMENT_PENDING') AND c.expires_at <= $1 FOR UPDATE OF c`, [iso(now)]);
  for (const c of rows) {
    await t.q("UPDATE checkouts SET status='EXPIRED', version=version+1, updated_at=now() WHERE id=$1", [c.id]);
    const r = await t.one("UPDATE reservations SET status='EXPIRED', version=version+1, updated_at=now() WHERE checkout_id=$1 AND status='ACTIVE' RETURNING principal_irr", [c.id]);
    if (r) await releaseReservedExposure(t, c.credit_line_id, c.business_id, big(r.principal_irr));
    await t.q("UPDATE orders SET status='EXPIRED', version=version+1, updated_at=now() WHERE id=(SELECT order_id FROM checkouts WHERE id=$1)", [c.id]);
    await outbox(t, 'checkout', c.id, 'credit.reservation_expired.v1', { checkout_id: c.id });
  }
  await recordJob(t, 'RESERVATION_EXPIRY', `RESERVATION_EXPIRY:${iso(now)}`, { expired: rows.length });
  return rows.length;
}

export async function releaseReservedExposure(t: Q, lineId: string, businessId: string, p: bigint) {
  await t.q('UPDATE credit_lines SET reserved_principal_irr=reserved_principal_irr-$2, version=version+1, updated_at=now() WHERE id=$1', [lineId, p]);
  await t.q("UPDATE exposure_buckets SET reserved_irr=reserved_irr-$2, version=version+1, updated_at=now() WHERE model_id=$1 AND ((scope_type='PROGRAM' AND scope_key='ALL') OR (scope_type='CLINIC' AND scope_key=$3))", [MODEL_ID, p, businessId]);
}

/** Exposure moves from outstanding back to capacity by principal actually repaid/cancelled. */
export async function releaseOutstanding(t: Q, lineId: string, businessId: string, p: bigint) {
  if (p <= 0n) return;
  await t.q('UPDATE credit_lines SET outstanding_principal_irr=outstanding_principal_irr-$2, version=version+1, updated_at=now() WHERE id=$1', [lineId, p]);
  await t.q("UPDATE exposure_buckets SET outstanding_irr=GREATEST(0,outstanding_irr-$2), version=version+1, updated_at=now() WHERE model_id=$1 AND ((scope_type='PROGRAM' AND scope_key='ALL') OR (scope_type='CLINIC' AND scope_key=$3))", [MODEL_ID, p, businessId]);
}

const REMINDER_OFFSETS = [-3, -1, 0, 1, 3, 7];

/** Daily delinquency: installment projection, DPD, line hold/cure, reminders, collection stage and DPD30 bank handoff. */
export async function runDelinquency(t: Q) {
  const now = await clock(t);
  const today = tehranIso(now);
  const { bank } = await parties(t);
  const purchases = await t.q("SELECT p.id, p.customer_id, p.credit_line_id, p.current_owner_id, cu.user_id FROM purchases p JOIN customers cu ON cu.id=p.customer_id WHERE p.status IN ('CONFIRMED','PARTIALLY_RETURNED')");
  for (const p of purchases) {
    await refreshInstallmentStatuses(t, p.id);
    const st = (await statement(t, p.id))!;
    const disputed = await t.one<{ n: number }>("SELECT count(*)::int n FROM support_cases WHERE purchase_id=$1 AND case_type='PAYMENT_DISPUTE' AND status='OPEN'", [p.id]);
    for (const i of st.installments) {
      if (i.residual.total === 0n || disputed?.n) continue;
      const due = tehranIso(new Date(i.due_at));
      for (const off of REMINDER_OFFSETS) {
        const day = new Date(Date.parse(due + 'T00:00:00Z') + off * 86400000).toISOString().slice(0, 10);
        if (day > today) continue;
        if (day < tehranIso(addDays(now, -30))) continue;
        await notify(t, p.user_id, `REMIND:${i.id}:${off}`, 'installment_reminder', { offset: off, installment: i.sequence }, new Date(day + 'T05:30:00Z'));
      }
    }
    const dpd = st.dpd;
    const existing = await t.one('SELECT * FROM collection_cases WHERE purchase_id=$1 ORDER BY created_at DESC LIMIT 1', [p.id]);
    if (dpd >= 1) {
      const stage = dpd >= 30 ? 'LEGAL_REVIEW' : dpd >= 8 ? 'SOFT' : 'MONITORING';
      if (!existing || existing.stage === 'CLOSED') {
        const ops = await t.one<{ id: string }>("SELECT u.id FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.role='paystar-admin' ORDER BY u.created_at LIMIT 1");
        await t.q(`INSERT INTO collection_cases(model_id,purchase_id,creditor_id,assigned_to,stage,dpd,evidence) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [MODEL_ID, p.id, p.current_owner_id, stage === 'LEGAL_REVIEW' ? null : ops?.id ?? null, stage, dpd, JSON.stringify({ opened_by: 'DELINQUENCY_JOB', demo: true })]);
      } else {
        const rank: Record<string, number> = { MONITORING: 0, SOFT: 1, LEGAL_REVIEW: 2, LEGAL_ACTIVE: 3, RECOVERY: 4 };
        const next = (rank[stage] ?? 0) > (rank[existing.stage] ?? 0) ? stage : existing.stage;
        const evidence = { ...(existing.evidence ?? {}) };
        if (next === 'LEGAL_REVIEW' && existing.stage !== 'LEGAL_REVIEW') {
          Object.assign(evidence, { handoff_to_creditor: bank, handoff_at: iso(now), bundle: ['debt_statement', 'verified_payments', 'contract', 'security_chain', 'contact_history'] });
        }
        await t.q('UPDATE collection_cases SET dpd=$2, stage=$3, evidence=$4, version=version+1, updated_at=now() WHERE id=$1', [existing.id, dpd, next, JSON.stringify(evidence)]);
      }
      await t.q("UPDATE credit_lines SET status='HELD', hold_reason='OVERDUE', version=version+1, updated_at=now() WHERE id=$1 AND status='ACTIVE'", [p.credit_line_id]);
    } else if (existing && existing.stage !== 'CLOSED' && st.totals.overdue === 0n) {
      await t.q("UPDATE collection_cases SET dpd=0, stage='CLOSED', version=version+1, updated_at=now() WHERE id=$1", [existing.id]);
    }
  }
  await cureHolds(t);
  await recordJob(t, 'DELINQUENCY', `DELINQUENCY:${today}`, { purchases: purchases.length });
}

/** Release OVERDUE holds once no overdue components remain; expired approvals do not reactivate. */
export async function cureHolds(t: Q) {
  const now = await clock(t);
  for (const l of await t.q("SELECT id FROM credit_lines WHERE status='HELD' AND hold_reason='OVERDUE'")) {
    const s = (await lineState(t, l.id))!;
    if (!s.overdue) {
      await t.q("UPDATE credit_lines SET status=$2, hold_reason=NULL, version=version+1, updated_at=now() WHERE id=$1",
        [l.id, new Date(s.line.expires_at) > now ? 'ACTIVE' : 'EXPIRED']);
    }
  }
}

/** A fee charged without a delivered credit report within 48 hours is refunded once to the customer refund wallet. */
export async function assessmentTimeouts(t: Q) {
  const now = await clock(t);
  const { paystar } = await parties(t);
  const apps = await t.q(`SELECT a.id, a.customer_id, pi.id AS intent_id, pi.amount_irr, pr.received_at FROM applications a
      JOIN payment_intents pi ON pi.application_id=a.id AND pi.purpose='ASSESSMENT_FEE' AND pi.status='SUCCEEDED'
      JOIN payment_receipts pr ON pr.intent_id=pi.id
     WHERE a.status='EXTERNAL_PENDING' AND a.resume_stage='ASSESSMENT_PENDING' AND pr.received_at <= $1`, [iso(addDays(now, -2))]);
  for (const a of apps) {
    const j = await post(t, paystar, `FEE_REFUND:${a.intent_id}`, 'ASSESSMENT_FEE_REFUND', a.intent_id, [
      { code: 'ASSESSMENT_REVENUE', debit: big(a.amount_irr) }, { code: 'WALLET_LIABILITY', credit: big(a.amount_irr) }]);
    if (j.duplicate) continue;
    await post(t, paystar, `FEE_REFUND_FUND:${a.intent_id}`, 'ASSESSMENT_FEE_REFUND', a.intent_id, [
      { code: 'WALLET_CASH', debit: big(a.amount_irr) }, { code: 'CASH', credit: big(a.amount_irr) }]);
    const w = await t.one('SELECT id FROM wallets WHERE customer_id=$1', [a.customer_id]);
    await t.q('UPDATE wallets SET liability_irr=liability_irr+$2, funded_irr=funded_irr+$2, version=version+1, updated_at=now() WHERE id=$1', [w!.id, a.amount_irr]);
    await t.q(`INSERT INTO wallet_entries(model_id,wallet_id,entry_type,amount_irr,event_key,journal_id) VALUES ($1,$2,'FEE_REFUND',$3,$4,$5)`, [MODEL_ID, w!.id, a.amount_irr, `FEE_REFUND:${a.intent_id}`, j.id]);
    await t.q('UPDATE payment_intents SET status=$2, version=version+1, updated_at=now() WHERE id=$1', [a.intent_id, 'REFUNDED']);
    await outbox(t, 'application', a.id, 'assessment.fee_refunded.v1', { application_id: a.id });
  }
}

export async function runAllJobs(t: Q) {
  await expireReservations(t);
  await assessmentTimeouts(t);
  await runDelinquency(t);
}
