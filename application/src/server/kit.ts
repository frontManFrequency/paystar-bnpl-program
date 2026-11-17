/** Typed facade over the tested reference kernel in implementation-kit (reused, not rewritten). */
// @ts-ignore plain ESM reference implementation
import * as domain from '../../implementation-kit/domain.mjs';
// @ts-ignore plain ESM reference implementation
import * as calendar from '../../implementation-kit/calendar.mjs';

export interface QuoteInstallment { sequence: number; principal: bigint; commission: bigint; total: bigint }
export interface Quote { principal: bigint; commission: bigint; total: bigint; installments: QuoteInstallment[] }
export const quote: (p: bigint, bps?: bigint) => Quote = (domain as any).quote;
export const roundHalfUp: (n: bigint, d: bigint) => bigint = (domain as any).roundHalfUp;
export const availableCredit: (a: { limit: bigint; outstanding: bigint; reserved?: bigint; held?: boolean; expired?: boolean }) => { available: bigint; spendable: bigint } = (domain as any).availableCredit;
export const allocatePayment: (amount: bigint, installments: { id: string; dueAt: string; sequence: number; principal: bigint; commission: bigint; penalty: bigint }[]) =>
  { allocations: { installmentId: string; component: 'principal' | 'commission' | 'penalty'; amount: bigint }[]; principalReleased: bigint; unapplied: bigint } = (domain as any).allocatePayment;
export interface RefundChange { installmentId: string; component: 'principal' | 'commission'; cancelDelta: bigint; refundDelta: bigint; targetCancel: bigint; targetRefund: bigint }
export const refundPlan: (a: { principal: bigint; commission: bigint; cumulativeReturn: bigint; installments: any[] }) =>
  { changes: RefundChange[]; walletDelta: bigint; principalReleased: bigint; cumulativePrincipal: bigint; cumulativeCommission: bigint } = (domain as any).refundPlan;
export const guaranteeClaim: (a: { residualPrincipal: bigint; coverageBps: bigint; cap: bigint; used?: bigint; reserved?: bigint; availableSecurity: bigint; dpd: number; recoveryDays: number; legalApproved: boolean }) => bigint = (domain as any).guaranteeClaim;
export const finalDecisionRole: (model: number) => string = (domain as any).finalDecisionRole;
export const affordability: (a: { income: bigint; externalObligations?: bigint; existingByMonth?: Record<string, bigint>; proposedByMonth?: Record<string, bigint> }) =>
  { allowed: boolean; monthlyCap: bigint; breaches: string[] } = (domain as any).affordability;
export const toWire: <T>(v: T) => any = (domain as any).toWire;

export interface DueDate { sequence: number; gregorian: string; jalali: string; dueAt: string }
export const monthlyDueDates: (origin: string, count?: number) => DueDate[] = (calendar as any).monthlyDueDates;
export const nextBusinessDate: (origin: string, o?: { holidays?: string[]; includeOrigin?: boolean }) => string = (calendar as any).nextBusinessDate;
export const jalaliParts: (iso: string) => { year: number; month: number; day: number } = (calendar as any).jalaliParts;

// ---------------------------------------------------------------------------------------------
// Customer-chosen installment count (2, 3, 4 or 6). These generalize the kernel's four-part
// functions using the kernel's own rounding/largest-remainder helpers; for n = 4 they return
// exactly what quote()/refundPlan() return (see tests/installments.test.ts).
// ---------------------------------------------------------------------------------------------
export const INSTALLMENT_COUNTS = [2, 3, 4, 6] as const;
const largestRemainder: (total: bigint, weights: bigint[]) => bigint[] = (domain as any).largestRemainder;

export function splitN(total: bigint, n: number): bigint[] {
  const k = BigInt(n);
  const base = total / k;
  return Array.from({ length: n }, (_, i) => (i < n - 1 ? base : total - base * (k - 1n)));
}

/** Flat commission (bps of principal) spread over n installments; first n-1 take floor(total/n), the last takes the remainder. */
export function quoteN(principal: bigint, n: number, commissionBps = 1200n): Quote {
  if (!INSTALLMENT_COUNTS.includes(n as any)) throw new Error('INVALID_INSTALLMENT_COUNT');
  if (principal <= 0n || commissionBps > 10000n) throw new Error('INVALID_QUOTE');
  const commission = roundHalfUp(principal * commissionBps, 10000n);
  const ps = splitN(principal, n), cs = splitN(commission, n);
  return { principal, commission, total: principal + commission, installments: ps.map((p, i) => ({ sequence: i + 1, principal: p, commission: cs[i], total: p + cs[i] })) };
}

/** Cumulative proportional return over any number of installments (same algorithm as the kernel's refundPlan). */
export function refundPlanN(a: { principal: bigint; commission: bigint; cumulativeReturn: bigint; installments: any[] }) {
  const p = a.principal, c = a.commission, r = a.cumulativeReturn;
  if (!p || r > p || a.installments.length < 2) throw new Error('INVALID_RETURN');
  const targetCommission = roundHalfUp(c * r, p);
  const totals = { principal: r, commission: targetCommission } as Record<string, bigint>;
  const changes: RefundChange[] = [];
  let walletDelta = 0n, principalReleased = 0n;
  for (const component of ['principal', 'commission'] as const) {
    const originals = a.installments.map((i) => BigInt(i[component].original));
    if (originals.reduce((x, y) => x + y, 0n) !== (component === 'principal' ? p : c)) throw new Error('SCHEDULE_MISMATCH');
    const targets = largestRemainder(totals[component], originals);
    a.installments.forEach((i, index) => {
      const x = i[component];
      const o = BigInt(x.original), paid = BigInt(x.paid), cancelled = BigInt(x.cancelled ?? 0n), refunded = BigInt(x.refunded ?? 0n);
      if (paid + cancelled > o || refunded > paid) throw new Error('INVALID_COMPONENT_BALANCE');
      const capacity = o - paid;
      const targetCancel = targets[index] < capacity ? targets[index] : capacity, targetRefund = targets[index] - targetCancel;
      const cancelDelta = targetCancel - cancelled, refundDelta = targetRefund - refunded;
      if (cancelDelta < 0n || refundDelta < 0n) throw new Error('RETURN_TARGET_REGRESSION');
      changes.push({ installmentId: i.id, component, cancelDelta, refundDelta, targetCancel, targetRefund });
      walletDelta += refundDelta; if (component === 'principal') principalReleased += cancelDelta;
    });
  }
  return { changes, walletDelta, principalReleased, cumulativePrincipal: r, cumulativeCommission: targetCommission };
}
