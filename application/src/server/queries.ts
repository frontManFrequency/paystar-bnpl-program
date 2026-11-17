/** Scoped read models. Every role reads purchases through the same statement() computation. */
import { Q, MODEL_ID } from './db';
import type { Actor } from './core';
import { statement } from './services';

export function canSeePurchase(actor: Actor, p: { customer_id: string; business_id: string; current_owner_id: string }) {
  switch (actor.role) {
    case 'customer': return p.customer_id === actor.customerId;
    case 'business-admin': return p.business_id === actor.orgId;
    case 'bank': return p.current_owner_id === actor.orgId;
    case 'paystar-admin': case 'super-admin': return true;
  }
  return false;
}

export async function scopedStatement(t: Q, actor: Actor, id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const s = await statement(t, id);
  if (!s || !canSeePurchase(actor, s.purchase)) return null;
  return s;
}

export interface TimelineRow { at: Date; kind: string; ref: string; detail: string; amount?: bigint | null }
/** Statement → installment → receipt → journal → reconciliation, joined by the same IDs. */
export async function timeline(t: Q, actor: Actor, purchaseId: string): Promise<TimelineRow[]> {
  const rows: TimelineRow[] = [];
  const p = await t.one('SELECT * FROM purchases WHERE id=$1', [purchaseId]);
  rows.push({ at: p.confirmed_at, kind: 'خرید تأیید شد', ref: p.id, detail: `مالک طلب: بانک از ابتدا · قرارداد ${p.contract_id.slice(0, 8)}` });
  for (const r of await t.q(`SELECT pr.*, pi.purpose FROM payment_receipts pr JOIN payment_intents pi ON pi.id=pr.intent_id WHERE pi.purchase_id=$1 OR pi.checkout_id=$2`, [purchaseId, p.checkout_id]))
    rows.push({ at: r.received_at, kind: `رسید پرداخت (${r.purpose === 'FIRST_INSTALLMENT' ? 'قسط اول' : 'قسط'})`, ref: r.provider_reference, detail: `وضعیت ${r.status} · مقصد: حساب وصول بانک`, amount: r.amount_irr });
  for (const pi of await t.q("SELECT * FROM payment_intents WHERE (purchase_id=$1 OR checkout_id=$2) AND status IN ('UNKNOWN','PENDING','FAILED')", [purchaseId, p.checkout_id]))
    rows.push({ at: pi.created_at, kind: 'درخواست پرداخت', ref: pi.provider_intent_ref, detail: `وضعیت ${pi.status}`, amount: pi.amount_irr });
  for (const s of await t.q('SELECT * FROM settlements WHERE purchase_id=$1', [purchaseId]))
    rows.push({ at: s.confirmed_at ?? s.created_at, kind: 'واریز بانک به کلینیک', ref: s.external_reference ?? s.id, detail: `وضعیت ${s.status}`, amount: s.amount_irr });
  for (const c of await t.q('SELECT e.*, c.sayad_id_token, c.expected_installment_sequence FROM check_events e JOIN checks c ON c.id=e.check_id WHERE c.purchase_id=$1 OR c.checkout_id=$2', [purchaseId, p.checkout_id]))
    rows.push({ at: c.effective_at, kind: `چک قسط ${c.expected_installment_sequence}: ${c.event_type}`, ref: c.sayad_id_token, detail: `مرجع ${c.external_reference}` });
  for (const r of await t.q('SELECT * FROM refunds WHERE purchase_id=$1', [purchaseId]))
    rows.push({ at: r.posted_at ?? r.created_at, kind: 'برگشت خدمت', ref: r.id, detail: `تجمعی ${r.cumulative_principal_irr} · وضعیت ${r.status}`, amount: r.wallet_entitlement_irr });
  for (const b of await t.q('SELECT * FROM bank_instructions WHERE purchase_id=$1', [purchaseId]))
    rows.push({ at: b.acknowledged_at ?? b.created_at, kind: `دستور بانکی ${b.instruction_type}`, ref: b.external_reference, detail: `وضعیت ${b.status} · مانده مورد انتظار ${b.expected_balance_irr ?? '—'} · تأییدشده بانک ${b.acknowledged_balance_irr ?? 'هنوز تأیید نشده'}` });
  if (actor.role !== 'customer' && actor.role !== 'business-admin') {
    for (const j of await t.q(`SELECT j.*, o.name AS book FROM journals j JOIN organizations o ON o.id=j.book_party_id WHERE j.source_id=$1 OR j.source_id IN (SELECT id FROM payment_receipts WHERE intent_id IN (SELECT id FROM payment_intents WHERE purchase_id=$1 OR checkout_id=$2)) OR j.source_id IN (SELECT id FROM refunds WHERE purchase_id=$1) OR j.source_id IN (SELECT id FROM settlements WHERE purchase_id=$1)`, [purchaseId, p.checkout_id]))
      rows.push({ at: j.posted_at, kind: 'سند حسابداری', ref: j.event_key, detail: `دفتر ${j.book}${j.book_party_id === p.current_owner_id ? ' (آینه خدمات‌دهی، دفتر رسمی نزد بانک)' : ''}` });
  }
  return rows.sort((a, b) => +new Date(a.at) - +new Date(b.at));
}

export async function journalLines(t: Q, eventKeys: string[]) {
  return t.q(`SELECT j.event_key, a.account_code, l.debit_irr, l.credit_irr FROM journal_lines l JOIN journals j ON j.id=l.journal_id JOIN ledger_accounts a ON a.id=l.account_id
     WHERE j.model_id=$1 AND j.event_key = ANY($2) ORDER BY j.event_key, l.debit_irr DESC`, [MODEL_ID, eventKeys]);
}
