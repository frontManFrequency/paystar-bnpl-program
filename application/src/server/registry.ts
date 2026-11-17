/** Command registry + dispatcher: verified actor → role/scope authorization → idempotent transaction → post-commit effects. */
import { randomBytes } from 'node:crypto';
import { APP_ENV, MODEL_ID, Q, fixture, resetDemo, tx } from './db';
import { Actor, AppError, Role, audit, fail, sha256, uuid } from './core';
import { toWire } from './kit';
import type { Effect } from './payments';
import * as A from './cmd-application';
import * as C from './cmd-checkout';
import * as S from './cmd-servicing';
import * as M from './cmd-admin';

type Handler = (t: Q, actor: Actor, input: any, ctx: { effects: Effect[] }) => Promise<any>;
interface Def { roles: Role[]; handler: Handler; label: string }

export const COMMANDS: Record<string, Def> = {
  'application.start': { roles: ['customer'], handler: (t, a, i) => A.startApplication(t, a, i), label: 'شروع درخواست اعتبار' },
  'application.terms': { roles: ['customer'], handler: A.setTerms, label: 'مبلغ و تعداد اقساط' },
  'application.identity': { roles: ['customer'], handler: A.identity, label: 'احراز هویت و رضایت‌ها' },
  'application.account': { roles: ['customer'], handler: A.account, label: 'تطبیق حساب' },
  'application.document': { roles: ['customer'], handler: A.uploadDocument, label: 'بارگذاری مدرک' },
  'application.submit_evidence': { roles: ['customer'], handler: A.submitEvidence, label: 'ارسال مدارک' },
  'application.pay_fee': { roles: ['customer'], handler: A.payFee, label: 'پرداخت هزینه استعلام' },
  'application.run_assessment': { roles: ['customer'], handler: A.runAssessment, label: 'درخواست گزارش اعتباری' },
  'application.resubmit': { roles: ['customer'], handler: A.resubmit, label: 'ارسال اصلاحات' },
  'review.paystar': { roles: ['paystar-admin'], handler: async (t, a, i) => { requireReview(a); return A.paystarReview(t, a, i); }, label: 'بررسی مقدماتی پی‌استار' },
  'decision.bank_final': { roles: ['bank'], handler: async (t, a, i) => { requireBank(a, 'underwriting'); return A.bankDecide(t, a, i); }, label: 'تصمیم نهایی بانک' },
  'line.sign': { roles: ['customer'], handler: A.signLine, label: 'امضای قرارداد اعتبار بانک' },
  'order.create': { roles: ['business-admin'], handler: async (t, a, i) => { requireOrders(a); return C.createOrder(t, a, i); }, label: 'ایجاد سفارش و پیش‌فاکتور' },
  'referral.create': { roles: ['business-admin'], handler: (t, a) => C.createReferral(t, a), label: 'ایجاد لینک معرفی' },
  'referral.revoke': { roles: ['business-admin'], handler: C.revokeReferral, label: 'لغو لینک معرفی' },
  'checkout.sign_contract': { roles: ['customer'], handler: C.signContract, label: 'امضای قرارداد خرید' },
  'checkout.register_checks': { roles: ['customer'], handler: C.registerChecks, label: 'ثبت چک‌ها' },
  'checkout.cancel': { roles: ['customer', 'business-admin'], handler: C.cancelCheckout, label: 'لغو پیش‌فاکتور' },
  'checks.bank_accept': { roles: ['bank'], handler: C.acceptChecks, label: 'پذیرش چک توسط بانک' },
  'checks.bank_release': { roles: ['bank'], handler: S.releaseSettledChecks, label: 'آزادسازی چک' },
  'payment.start': { roles: ['customer'], handler: C.startPayment, label: 'پرداخت' },
  'payment.inquire': { roles: ['customer', 'paystar-admin'], handler: C.inquire, label: 'استعلام پرداخت' },
  'payment.replay_webhook': { roles: ['paystar-admin'], handler: C.replay, label: 'بازپخش رویداد تکراری' },
  'disbursement.propose': { roles: ['bank'], handler: S.proposeDisbursement, label: 'پیشنهاد واریز به کلینیک' },
  'disbursement.approve': { roles: ['bank'], handler: S.approveDisbursement, label: 'تأیید واریز (کنترل دوم)' },
  'disbursement.inquire': { roles: ['bank', 'paystar-admin'], handler: S.inquireDisbursement, label: 'استعلام واریز' },
  'service.start': { roles: ['business-admin'], handler: C.serviceStart, label: 'شروع خدمت' },
  'service.complete': { roles: ['business-admin'], handler: C.serviceComplete, label: 'پایان خدمت' },
  'service.acknowledge': { roles: ['customer'], handler: C.serviceAcknowledge, label: 'تأیید دریافت خدمت' },
  'return.request': { roles: ['business-admin'], handler: S.requestReturn, label: 'درخواست برگشت' },
  'return.approve': { roles: ['business-admin'], handler: S.approveReturn, label: 'تأیید برگشت (کاربر دوم)' },
  'return.reject': { roles: ['business-admin'], handler: S.rejectReturn, label: 'رد برگشت' },
  'amendment.bank_ack': { roles: ['bank'], handler: S.acknowledgeAmendment, label: 'تأیید اصلاحیه بدهی' },
  'wallet.withdraw': { roles: ['customer'], handler: S.withdraw, label: 'برداشت از کیف بازپرداخت' },
  'wallet.inquire': { roles: ['customer', 'paystar-admin'], handler: S.inquireWithdrawal, label: 'استعلام برداشت' },
  'collections.log_contact': { roles: ['paystar-admin', 'bank'], handler: S.logContact, label: 'ثبت تماس' },
  'collections.record_recovery': { roles: ['bank'], handler: S.recordRecovery, label: 'ثبت اقدام وصول' },
  'collections.authorize_legal': { roles: ['bank'], handler: S.authorizeLegal, label: 'مجوز اقدام حقوقی' },
  'guarantee.propose_claim': { roles: ['bank'], handler: S.proposeGuaranteeClaim, label: 'پیشنهاد مطالبه ضمانت' },
  'guarantee.approve_claim': { roles: ['bank'], handler: S.approveGuaranteeClaim, label: 'تأیید مطالبه ضمانت' },
  'guarantee.pay_claim': { roles: ['business-admin'], handler: S.payGuaranteeClaim, label: 'پرداخت ضمانت' },
  'support.create': { roles: ['customer'], handler: S.createSupport, label: 'ثبت درخواست پشتیبانی' },
  'support.resolve': { roles: ['paystar-admin'], handler: S.resolveSupport, label: 'رسیدگی پشتیبانی' },
  'hardship.bank_decide': { roles: ['bank'], handler: S.decideHardship, label: 'تصمیم مهلت' },
  'recon.run': { roles: ['paystar-admin'], handler: (t, a) => M.runReconciliation(t, a), label: 'اجرای تطبیق' },
  'clock.advance': { roles: ['super-admin'], handler: M.advanceClock, label: 'جلو بردن ساعت نمایشی' },
  'ops.propose_pause': { roles: ['super-admin'], handler: M.proposePause, label: 'پیشنهاد توقف/ازسرگیری' },
  'ops.approve_pause': { roles: ['super-admin'], handler: M.approvePause, label: 'تأیید توقف/ازسرگیری' },
  'member.create': { roles: ['super-admin'], handler: M.createUser, label: 'دعوت کاربر' },
  'member.revoke': { roles: ['super-admin'], handler: M.revokeUser, label: 'لغو دسترسی' },
  'organization.create': { roles: ['super-admin'], handler: M.createOrganization, label: 'ثبت کلینیک (پیش‌نویس)' },
  'organization.activate': { roles: ['super-admin'], handler: async (t, a, i) => { const r = await M.activateOrganization(t, a, i); invalidateTenantCache(); return r; }, label: 'فعال‌سازی کلینیک' },
  'meeting.record': { roles: ['super-admin', 'paystar-admin'], handler: M.recordMeeting, label: 'ثبت نتیجه جلسه' },
};

function requireReview(a: Actor) { if (!a.scopes.includes('review')) fail('FORBIDDEN', 403); }
function requireBank(a: Actor, s: string) { if (!a.scopes.includes(s)) fail('FORBIDDEN', 403); }
function requireOrders(a: Actor) { if (!a.scopes.includes('orders')) fail('FORBIDDEN', 403, 'این کاربر کلینیک مجوز ایجاد سفارش ندارد.'); }

let clinicIds: string[] | null = null;
async function tenantScope(actor: Actor | null): Promise<string[]> {
  if (actor?.role === 'business-admin') return actor.orgId ? [actor.orgId] : [];
  // Fresh per request: clinics created/activated at runtime must be inside platform roles' RLS scope immediately.
  clinicIds = (await tx(null, (t) => t.q<{ id: string }>("SELECT id FROM organizations WHERE party_type='CLINIC'"))).map((r) => r.id);
  return clinicIds;
}
export function invalidateTenantCache() { clinicIds = null; }

export async function readScope<T>(actor: Actor | null, fn: (t: Q) => Promise<T>) {
  return tx({ tenantIds: await tenantScope(actor) }, fn);
}

export interface ExecResult { status: number; body: any }
export async function execute(name: string, input: any, actor: Actor | null, idemKey?: string | null): Promise<ExecResult> {
  const def = COMMANDS[name];
  try {
    if (!def) fail('UNKNOWN_COMMAND', 404);
    if (!actor) fail('UNAUTHENTICATED', 401, 'ابتدا وارد شوید.');
    if (!def!.roles.includes(actor!.role)) fail('FORBIDDEN', 403);
    // Malformed identifiers are indistinguishable from inaccessible ones (404), never a database error.
    for (const [k, v] of Object.entries(input ?? {}))
      if (k.endsWith('_id') && v !== '' && v !== null && v !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v))) fail('NOT_FOUND', 404, 'یافت نشد.', [{ field: k, code: 'INVALID_ID' }]);
    const effects: Effect[] = [];
    const requestHash = sha256(JSON.stringify(input ?? {}));
    const route = `cmd:${name}`;
    const out = await tx({ tenantIds: await tenantScope(actor) }, async (t) => {
      if (idemKey) {
        const prior = await t.one('SELECT * FROM idempotency_keys WHERE model_id=$1 AND actor_id=$2 AND route=$3 AND key=$4', [MODEL_ID, actor!.userId, route, idemKey]);
        if (prior) {
          if (prior.request_hash !== requestHash) fail('IDEMPOTENCY_CONFLICT', 409);
          return { replayed: true, body: prior.response_body };
        }
      }
      const result = toWire(await def!.handler(t, actor!, input ?? {}, { effects }));
      const reference = uuid();
      const body = { ok: true, command: name, reference, result };
      if (idemKey) await t.q(`INSERT INTO idempotency_keys(model_id,actor_id,route,key,request_hash,response_code,response_body,expires_at) VALUES ($1,$2,$3,$4,$5,200,$6, now()+interval '30 days')`,
        [MODEL_ID, actor!.userId, route, idemKey, requestHash, JSON.stringify(body)]);
      await audit(t, actor, name, 'command', null, { input: redact(input), result }, undefined);
      return { replayed: false, body };
    });
    if (!out.replayed) for (const e of effects) {
      try { await e(); } catch (err) { console.error('effect failed', name, err); }
    }
    return { status: 200, body: out.replayed ? { ...out.body, idempotent_replay: true } : out.body };
  } catch (e) {
    if (e instanceof AppError) {
      if (e.status === 403 || e.status === 401) {
        try { await tx(null, (t) => audit(t, actor, `denied:${name}`, 'command', null, { code: e.code }, e.message)); } catch { /* audit best-effort */ }
      }
      return { status: e.status, body: { error: { code: e.code, message: e.message, field_errors: e.fieldErrors, retryable: e.status === 409 || e.status === 503, correlation_id: uuid() } } };
    }
    console.error(e);
    const msg = (e as Error).message || '';
    const code = /UNBALANCED|IMMUTABLE|APPEND_ONLY|violates/.test(msg) ? 'INTEGRITY_GUARD' : 'INTERNAL';
    return { status: 500, body: { error: { code, message: code === 'INTEGRITY_GUARD' ? 'کنترل یکپارچگی پایگاه داده این تغییر را رد کرد.' : 'خطای داخلی؛ تغییری ثبت نشد.', field_errors: [], retryable: false, correlation_id: uuid() } } };
  }
}

function redact(input: any) {
  if (!input || typeof input !== 'object') return input;
  const { base64, card, otp, ...rest } = input;
  return { ...rest, ...(base64 ? { base64: '[file]' } : {}), ...(card ? { card: '[tokenized]' } : {}), ...(otp ? { otp: '[redacted]' } : {}) };
}

// ------------------------------------------------------------------ demo sessions
export async function demoLogin(key: string) {
  if (APP_ENV !== 'prototype') fail('FORBIDDEN', 403);
  const user = (fixture().demo_users as any[]).find((u) => u.key === key || u.user_id === key);
  let userId = user?.user_id as string | undefined;
  if (userId && !(await tx(null, (t) => t.one("SELECT 1 FROM memberships WHERE user_id=$1 AND status='ACTIVE'", [userId])))) fail('FORBIDDEN', 403, 'دسترسی این کاربر لغو شده است.');
  if (!userId) {
    // Users created later (self-registered customers, invited staff) are demo-selectable by id while their membership is active.
    const r = await tx(null, (t) => t.one("SELECT u.id FROM users u JOIN memberships m ON m.user_id=u.id WHERE u.id::text=$1 AND m.status='ACTIVE'", [key]));
    userId = r?.id;
  }
  if (!userId) fail('NOT_FOUND', 404, 'کاربر نمایشی یافت نشد.');
  const token = randomBytes(24).toString('base64url');
  await tx(null, async (t) => {
    await t.q("INSERT INTO sessions(model_id,user_id,session_hash,expires_at) VALUES ($1,$2,$3, now()+interval '7 days')", [MODEL_ID, userId, sha256(token)]);
    await audit(t, null, 'session.demo_login', 'user', userId!);
  });
  return token;
}

export async function actorFromToken(token: string | undefined | null): Promise<Actor | null> {
  if (!token) return null;
  return tx(null, async (t) => {
    const r = await t.one(`SELECT s.id AS session_id, u.id, u.display_name, m.role, m.organization_id, m.scopes, c.id AS customer_id
       FROM sessions s JOIN users u ON u.id=s.user_id JOIN memberships m ON m.user_id=u.id AND m.status='ACTIVE'
       LEFT JOIN customers c ON c.user_id=u.id
      WHERE s.model_id=$1 AND s.session_hash=$2 AND s.revoked_at IS NULL AND s.expires_at > now() AND u.status='ACTIVE' LIMIT 1`, [MODEL_ID, sha256(token)]);
    if (!r) return null;
    return { userId: r.id, displayName: r.display_name, role: r.role, orgId: r.organization_id, scopes: r.scopes ?? [], customerId: r.customer_id, sessionId: r.session_id } as Actor;
  });
}

export async function logout(token: string | undefined | null) {
  if (!token) return;
  await tx(null, (t) => t.q('UPDATE sessions SET revoked_at=now() WHERE session_hash=$1', [sha256(token)]));
}

export async function register(input: any) {
  try {
    const r = await tx(null, (t) => C.registerFromReferral(t, input));
    return { status: 200, body: { ok: true, result: r, token: await demoLogin(r.user_id) } };
  } catch (e) {
    if (e instanceof AppError) return { status: e.status, body: { error: { code: e.code, message: e.message, field_errors: e.fieldErrors } } };
    throw e;
  }
}

export async function reset(actor: Actor | null, phrase: string) {
  if (!actor || actor.role !== 'super-admin' || !actor.scopes.includes('demo')) fail('FORBIDDEN', 403);
  if (phrase !== `RESET MODEL ${MODEL_ID}`) fail('CONFIRMATION_REQUIRED', 422, `برای بازنشانی عبارت «RESET MODEL ${MODEL_ID}» را وارد کنید.`);
  await resetDemo();
  invalidateTenantCache();
}
