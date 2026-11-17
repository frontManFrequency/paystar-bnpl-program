/** The n-installment generalizations must equal the tested four-part kernel for n = 4, and conserve every rial for 2/3/6. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quote, quoteN, refundPlan, refundPlanN, INSTALLMENT_COUNTS } from '../src/server/kit';

const wire = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x));

test('quoteN(P, 4) equals the kernel quote for many amounts', () => {
  for (const p of [10000000n, 400000000n, 123456780n, 99999990n, 10000010n, 333333330n]) assert.equal(wire(quoteN(p, 4)), wire(quote(p, 1200n)));
});

test('quoteN conserves principal and commission for every allowed count; commission is a flat 12%', () => {
  for (const n of INSTALLMENT_COUNTS) for (const p of [10000000n, 400000000n, 123456780n, 70000000n]) {
    const q = quoteN(p, n);
    assert.equal(q.installments.length, n);
    assert.equal(q.installments.reduce((a, i) => a + i.principal, 0n), p);
    assert.equal(q.installments.reduce((a, i) => a + i.commission, 0n), q.commission);
    assert.equal(q.commission, (p * 1200n + 5000n) / 10000n);
  }
  assert.deepEqual(quoteN(400000000n, 6).installments.map((i) => i.total.toString()), ['74666666', '74666666', '74666666', '74666666', '74666666', '74666670']);
  assert.throws(() => quoteN(400000000n, 5));
});

function sched(p: bigint, n: number, paidFirst: boolean) {
  const q = quoteN(p, n);
  return q.installments.map((i, k) => ({ id: `i${k + 1}`,
    principal: { original: i.principal, paid: paidFirst && k === 0 ? i.principal : 0n, cancelled: 0n, refunded: 0n },
    commission: { original: i.commission, paid: paidFirst && k === 0 ? i.commission : 0n, cancelled: 0n, refunded: 0n } }));
}

test('refundPlanN equals the kernel refundPlan for four installments', () => {
  for (const r of [100000000n, 200000000n, 400000000n, 123450000n]) {
    const a = { principal: 400000000n, commission: 48000000n, cumulativeReturn: r, installments: sched(400000000n, 4, true) };
    assert.equal(wire(refundPlanN(a)), wire(refundPlan(a)));
  }
});

test('refundPlanN: full return after first payment refunds the first payment and cancels the rest, for every count', () => {
  for (const n of INSTALLMENT_COUNTS) {
    const q = quoteN(400000000n, n);
    const plan = refundPlanN({ principal: 400000000n, commission: q.commission, cumulativeReturn: 400000000n, installments: sched(400000000n, n, true) });
    assert.equal(plan.walletDelta, q.installments[0].total, `n=${n}`);
    assert.equal(plan.principalReleased, 400000000n - q.installments[0].principal, `n=${n}`);
  }
});
