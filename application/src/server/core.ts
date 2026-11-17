import { createHash, randomUUID } from 'node:crypto';
import { MODEL_ID, Q, content } from './db';

export type Role = 'super-admin' | 'paystar-admin' | 'business-admin' | 'customer' | 'bank';
export interface Actor {
  userId: string;
  displayName: string;
  role: Role;
  orgId: string | null;
  scopes: string[];
  customerId: string | null;
  sessionId: string;
}

export class AppError extends Error {
  constructor(public code: string, public status = 422, message?: string, public fieldErrors: { field: string; code: string }[] = []) {
    super(message || content().errors?.[code] || code);
  }
}
export const fail = (code: string, status = 422, message?: string, fieldErrors?: { field: string; code: string }[]): never => {
  throw new AppError(code, status, message, fieldErrors);
};

export function requireRole(actor: Actor | null, ...roles: Role[]): Actor {
  if (!actor) fail('UNAUTHENTICATED', 401, 'ابتدا وارد شوید.');
  if (!roles.includes(actor!.role)) fail('FORBIDDEN', 403);
  return actor!;
}
export function requireScope(actor: Actor, scope: string) {
  if (!actor.scopes.includes(scope)) fail('FORBIDDEN', 403, `دسترسی «${scope}» برای این کاربر تعریف نشده است.`);
}
export function assertChecker(makerId: string | null | undefined, checkerId: string) {
  if (!makerId || makerId === checkerId) fail('MAKER_CHECKER_REQUIRED', 409);
}

export const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
export const uuid = () => randomUUID();
export const big = (v: unknown): bigint => (typeof v === 'bigint' ? v : BigInt(v as any));

/** Money input from the wire: decimal integer string of rial, no exponent/decimal/negative. */
export function parseMoney(v: unknown, field = 'amount_irr'): bigint {
  const s = typeof v === 'number' ? String(v) : String(v ?? '').replace(/[,\s]/g, '');
  const norm = s.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  if (!/^(0|[1-9][0-9]*)$/.test(norm)) fail('INVALID_MONEY', 422, 'مبلغ باید عدد صحیح ریالی باشد.', [{ field, code: 'INVALID_MONEY' }]);
  return BigInt(norm);
}

// ---------------------------------------------------------------- clock
export async function clock(t: Q): Promise<Date> {
  const r = await t.one<{ clock: Date }>('SELECT clock FROM app_demo_state WHERE id=1');
  return new Date(r!.clock);
}
export const iso = (d: Date) => d.toISOString();
export const addMinutes = (d: Date, m: number) => new Date(+d + m * 60000);
export const addDays = (d: Date, n: number) => new Date(+d + n * 86400000);
const tehranDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' });
/** Local Tehran calendar date (Gregorian ISO) for an instant. */
export const tehranIso = (d: Date) => tehranDate.format(d);
export const dayDiff = (a: string, b: string) => Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000);

// ---------------------------------------------------------------- parties
let partyCache: Record<string, string> | null = null;
export async function parties(t: Q): Promise<{ paystar: string; bank: string }> {
  if (!partyCache) {
    const rows = await t.q<{ id: string; party_type: string }>("SELECT id,party_type FROM organizations WHERE party_type IN ('PAYSTAR','BANK') ORDER BY created_at");
    partyCache = {};
    for (const r of rows) if (!partyCache[r.party_type]) partyCache[r.party_type] = r.id;
  }
  return { paystar: partyCache.PAYSTAR, bank: partyCache.BANK };
}

// ---------------------------------------------------------------- audit / outbox
export async function audit(t: Q, actor: Actor | null, action: string, resourceType: string, resourceId: string | null, detail?: unknown, reason?: string) {
  const prev = await t.one<{ event_hash: string }>('SELECT event_hash FROM audit_events WHERE model_id=$1 ORDER BY created_at DESC, event_hash DESC LIMIT 1', [MODEL_ID]);
  const now = await clock(t);
  const afterHash = detail === undefined ? null : sha256(JSON.stringify(detail, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
  const eventHash = sha256([prev?.event_hash ?? '', actor?.userId ?? 'system', action, resourceType, resourceId ?? '', afterHash ?? '', iso(now), uuid()].join('|'));
  await t.q(`INSERT INTO audit_events(model_id,actor_id,action,resource_type,resource_id,after_hash,reason,correlation_id,previous_hash,event_hash)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [MODEL_ID, actor?.userId ?? null, action, resourceType, resourceId, afterHash, reason ?? null, uuid(), prev?.event_hash ?? null, eventHash]);
}

export async function outbox(t: Q, aggregateType: string, aggregateId: string, eventType: string, payload: Record<string, unknown>) {
  const v = await t.one<{ v: bigint }>('SELECT COALESCE(max(aggregate_version),0)+1 AS v FROM outbox_events WHERE model_id=$1 AND aggregate_type=$2 AND aggregate_id=$3', [MODEL_ID, aggregateType, aggregateId]);
  await t.q(`INSERT INTO outbox_events(model_id,aggregate_type,aggregate_id,aggregate_version,event_type,payload,correlation_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7)`, [MODEL_ID, aggregateType, aggregateId, v!.v, eventType, JSON.stringify(payload, (_k, x) => (typeof x === 'bigint' ? x.toString() : x)), uuid()]);
}

export async function notify(t: Q, userId: string, occurrenceKey: string, template: string, payload: Record<string, unknown>, sendAt?: Date) {
  const now = await clock(t);
  await t.q(`INSERT INTO notifications(model_id,user_id,channel,occurrence_key,template,payload,status,send_at)
     VALUES ($1,$2,'IN_APP',$3,$4,$5,'SIMULATED',$6) ON CONFLICT (model_id,user_id,channel,occurrence_key) DO NOTHING`,
    [MODEL_ID, userId, occurrenceKey, template, JSON.stringify(payload), iso(sendAt ?? now)]);
}

// ---------------------------------------------------------------- ledger
const ACCOUNT_TYPES: Record<string, string> = {
  CASH: 'ASSET', CUSTOMER_PRINCIPAL: 'ASSET', CUSTOMER_COMMISSION: 'ASSET', CLINIC_RECOVERY: 'ASSET', REFUND_BRIDGE_CASH: 'ASSET',
  PARTNER_RECOVERY: 'ASSET', WALLET_CASH: 'ASSET', GUARANTEE_RECOVERY_CLEARING: 'ASSET', SERVICE_FEE_RECEIVABLE: 'ASSET',
  CLINIC_PAYABLE: 'LIABILITY', DEFERRED_COMMISSION: 'LIABILITY', CUSTOMER_REFUND_PAYABLE: 'LIABILITY', DUE_TO_PAYSTAR: 'LIABILITY',
  UNAPPLIED_RECEIPTS: 'LIABILITY', WALLET_LIABILITY: 'LIABILITY',
  COMMISSION_REVENUE: 'INCOME', ASSESSMENT_REVENUE: 'INCOME', SERVICE_FEE_REVENUE: 'INCOME', OPENING_EQUITY: 'EQUITY',
};

export interface Line { code: string; debit?: bigint; credit?: bigint }
/**
 * Append a balanced journal (DRAFT → lines → POSTED). Idempotent by (book, eventKey): a repeated
 * economic event returns the existing journal and posts nothing.
 */
export async function post(t: Q, book: string, eventKey: string, sourceType: string, sourceId: string, lines: Line[]): Promise<{ id: string; duplicate: boolean }> {
  const existing = await t.one<{ id: string }>('SELECT id FROM journals WHERE model_id=$1 AND book_party_id=$2 AND event_key=$3', [MODEL_ID, book, eventKey]);
  if (existing) return { id: existing.id, duplicate: true };
  const live = lines.filter((l) => (l.debit ?? 0n) > 0n || (l.credit ?? 0n) > 0n);
  if (!live.length) return { id: '', duplicate: true };
  const { bank } = await parties(t);
  const mirror = book === bank;
  const now = await clock(t);
  const id = uuid();
  await t.q(`INSERT INTO journals(id,model_id,book_party_id,event_key,status,source_type,source_id) VALUES ($1,$2,$3,$4,'DRAFT',$5,$6)`, [id, MODEL_ID, book, eventKey, sourceType, sourceId]);
  for (const l of live) {
    let acc = await t.one<{ id: string }>('SELECT id FROM ledger_accounts WHERE model_id=$1 AND book_party_id=$2 AND account_code=$3 AND is_external_mirror=$4', [MODEL_ID, book, l.code, mirror]);
    if (!acc) {
      const type = ACCOUNT_TYPES[l.code];
      if (!type) throw new Error('UNKNOWN_ACCOUNT:' + l.code);
      acc = { id: uuid() };
      await t.q('INSERT INTO ledger_accounts(id,model_id,book_party_id,account_code,account_type,is_external_mirror,restricted) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [acc.id, MODEL_ID, book, l.code, type, mirror, l.code === 'WALLET_CASH']);
    }
    await t.q('INSERT INTO journal_lines(model_id,journal_id,account_id,debit_irr,credit_irr) VALUES ($1,$2,$3,$4,$5)', [MODEL_ID, id, acc.id, l.debit ?? 0n, l.credit ?? 0n]);
  }
  await t.q("UPDATE journals SET status='POSTED', posted_at=$2 WHERE id=$1", [id, iso(now)]);
  return { id, duplicate: false };
}

export async function accountBalance(t: Q, book: string, code: string): Promise<bigint> {
  const r = await t.one<{ b: bigint }>(`SELECT COALESCE(sum(l.debit_irr-l.credit_irr),0)::bigint AS b FROM journal_lines l
     JOIN ledger_accounts a ON a.id=l.account_id JOIN journals j ON j.id=l.journal_id
     WHERE a.model_id=$1 AND a.book_party_id=$2 AND a.account_code=$3 AND j.status='POSTED'`, [MODEL_ID, book, code]);
  return r!.b;
}

/** Optimistic concurrency: compare and bump row version. */
export async function bumpVersion(t: Q, table: string, id: string, expected?: number | string | bigint | null) {
  const r = await t.one<{ version: bigint }>(`SELECT version FROM ${table} WHERE id=$1 FOR UPDATE`, [id]);
  if (!r) fail('NOT_FOUND', 404, 'رکورد یافت نشد.');
  if (expected !== undefined && expected !== null && expected !== '' && BigInt(expected as any) !== r!.version) fail('INVALID_TRANSITION', 409);
  await t.q(`UPDATE ${table} SET version=version+1, updated_at=now() WHERE id=$1`, [id]);
}

export const sum = (xs: bigint[]) => xs.reduce((a, b) => a + b, 0n);
export const min = (...xs: bigint[]) => xs.reduce((a, b) => (a < b ? a : b));
export const max = (...xs: bigint[]) => xs.reduce((a, b) => (a > b ? a : b));
