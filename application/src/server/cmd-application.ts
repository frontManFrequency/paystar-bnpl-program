/** Registration, evidence, assessment and model-4 decision authority (PayStar recommends, bank decides). */
import { MODEL_ID, Q, content, fixture } from './db';
import { Actor, parseMoney, addDays, audit, big, bumpVersion, clock, fail, iso, min, notify, outbox, parties, sha256, uuid } from './core';
import { finalDecisionRole, INSTALLMENT_COUNTS } from './kit';
import { Effect, mockPaymentProvider, newIntentRef } from './payments';

export interface Ctx { effects: Effect[] }

async function ownApplication(t: Q, actor: Actor, id: string) {
  const app = await t.one('SELECT * FROM applications WHERE id=$1 FOR UPDATE', [id]);
  if (!app || app.customer_id !== actor.customerId) fail('NOT_FOUND', 404, 'درخواست یافت نشد.');
  return app;
}
async function setStatus(t: Q, id: string, status: string, extra: Record<string, unknown> = {}) {
  const sets = Object.keys(extra).map((k, i) => `${k}=$${i + 3}`);
  await t.q(`UPDATE applications SET status=$2${sets.length ? ',' + sets.join(',') : ''}, version=version+1, updated_at=now() WHERE id=$1`, [id, status, ...Object.values(extra)]);
  await outbox(t, 'application', id, 'application.status_changed.v1', { application_id: id, status });
}
async function notifyCustomer(t: Q, customerId: string, key: string) {
  const c = await t.one('SELECT user_id FROM customers WHERE id=$1', [customerId]);
  await notify(t, c!.user_id, key, 'status_changed', {});
}

/** Customer-chosen terms: requested credit (rial, 1–40m toman in 1m-toman steps) and installment count (2, 3, 4 or 6). */
export function parseTerms(input: any) {
  const errs: { field: string; code: string }[] = [];
  const raw = String(input.requested_limit_irr ?? '').replace(/[,\s]/g, '').replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
  const amount = /^\d+$/.test(raw) ? BigInt(raw) : -1n;
  if (amount < 10000000n || amount > 400000000n || amount % 10000000n !== 0n) errs.push({ field: 'requested_limit_irr', code: 'INVALID_AMOUNT' });
  const count = Number(input.installment_count);
  if (!INSTALLMENT_COUNTS.includes(count as any)) errs.push({ field: 'installment_count', code: 'INVALID' });
  if (errs.length) fail('INVALID_TERMS', 422, 'مبلغ اعتبار باید بین ۱ تا ۴۰ میلیون تومان (مضرب ۱ میلیون) و تعداد اقساط ۲، ۳، ۴ یا ۶ باشد.', errs);
  return { amount, count };
}
const TERMS_EDITABLE = ['DRAFT', 'IDENTITY_PENDING', 'FEE_PENDING', 'ASSESSMENT_PENDING', 'EXTERNAL_PENDING', 'NEEDS_CORRECTION'];
export async function setTerms(t: Q, actor: Actor, input: any) {
  const app = await ownApplication(t, actor, input.application_id);
  if (!TERMS_EDITABLE.includes(app.status)) fail('INVALID_TRANSITION', 409, 'پس از ارسال برای بررسی، مبلغ و تعداد اقساط قابل تغییر نیست.');
  const { amount, count } = parseTerms(input);
  await t.q('UPDATE applications SET requested_limit_irr=$2, installment_count=$3, version=version+1, updated_at=now() WHERE id=$1', [app.id, amount, count]);
  return { requested_limit_irr: amount, installment_count: count };
}

/** Start a new credit application (one open application and one open line per customer and creditor). */
export async function startApplication(t: Q, actor: Actor, input: any = {}) {
  const now = await clock(t);
  const open = await t.one("SELECT id, status FROM applications WHERE customer_id=$1 AND status NOT IN ('REJECTED','CANCELLED','EXPIRED','ACTIVE')", [actor.customerId]);
  if (open) fail('APPLICATION_OPEN', 409, 'یک درخواست باز دارید؛ همان را ادامه دهید.');
  const line = await t.one("SELECT id FROM credit_lines WHERE customer_id=$1 AND status IN ('ACTIVE','HELD','APPROVED_PENDING_CONTRACT') AND expires_at > $2", [actor.customerId, iso(now)]);
  if (line) fail('LINE_ACTIVE', 409, 'اعتبار فعال دارید؛ درخواست جدید پس از انقضای اعتبار فعلی ممکن است.');
  const last = await t.one('SELECT * FROM applications WHERE customer_id=$1 ORDER BY created_at DESC LIMIT 1', [actor.customerId]);
  if (last?.status === 'REJECTED' && last.reapply_at && new Date(last.reapply_at) > now) fail('REAPPLY_TOO_EARLY', 422, `درخواست مجدد از ${new Date(last.reapply_at).toISOString().slice(0, 10)} ممکن است.`);
  const { bank } = await parties(t);
  const referral = last?.referral_id ?? (await t.one('SELECT id FROM referrals WHERE revoked_at IS NULL ORDER BY created_at LIMIT 1')).id;
  const policy = await t.one("SELECT id FROM policies WHERE status='APPROVED' ORDER BY policy_version DESC LIMIT 1");
  const id = uuid();
  const terms = input && input.requested_limit_irr !== undefined ? parseTerms(input) : null;
  await t.q(`INSERT INTO applications(id,model_id,customer_id,referral_id,creditor_id,policy_id,status,expires_at,previous_application_id,requested_limit_irr,installment_count) VALUES ($1,$2,$3,$4,$5,$6,'DRAFT',$7,$8,$9,$10)`,
    [id, MODEL_ID, actor.customerId, referral, bank, policy.id, iso(addDays(now, 30)), last?.id ?? null, terms?.amount ?? null, terms?.count ?? 4]);
  await outbox(t, 'application', id, 'application.created.v1', { application_id: id });
  return { application_id: id, status: 'DRAFT' };
}

export const REQUIRED_CONSENTS = ['IDENTITY', 'ACCOUNT', 'CREDIT_REPORT', 'DATA_PROCESSING'];

export async function identity(t: Q, actor: Actor, input: any) {
  const app = await ownApplication(t, actor, input.application_id);
  if (!['DRAFT', 'IDENTITY_PENDING'].includes(app.status)) fail('INVALID_TRANSITION', 409);
  if (String(input.otp ?? '').trim() !== fixture().otp_code) fail('OTP_INVALID', 422, 'کد تأیید نادرست است.', [{ field: 'otp', code: 'OTP_INVALID' }]);
  const given: string[] = input.consents ?? [];
  const missing = REQUIRED_CONSENTS.filter((p) => !given.includes(p));
  if (missing.length) fail('CONSENT_REQUIRED', 422, 'همه رضایت‌های الزامی باید جداگانه پذیرفته شوند.', missing.map((m) => ({ field: `consent.${m}`, code: 'REQUIRED' })));
  const now = await clock(t);
  for (const purpose of [...given]) {
    const c = (content().consents as any[]).find((x) => x.purpose === purpose);
    if (!c) continue;
    const have = await t.one('SELECT id FROM consents WHERE customer_id=$1 AND purpose=$2 AND text_version=$3 AND withdrawn_at IS NULL', [app.customer_id, purpose, c.version]);
    if (!have) await t.q('INSERT INTO consents(model_id,customer_id,purpose,text_version,text_hash,given_at,proof) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [MODEL_ID, app.customer_id, purpose, c.version, sha256(c.text), iso(now), JSON.stringify({ demo: true, session: actor.sessionId })]);
  }
  const cust = await t.one('SELECT * FROM customers WHERE id=$1 FOR UPDATE', [app.customer_id]);
  const nid: string = cust.identity_details?.national_id ?? '';
  if (!nid.startsWith('DEMO-NID-')) fail('LIVE_IDENTITY_REJECTED', 422, 'در محیط نمایشی فقط شناسه‌های DEMO پذیرفته می‌شود.');
  // Mock identity adapter: deterministic MATCH unless the presenter selects the mismatch scenario.
  const result = input.scenario === 'kyc_mismatch' ? 'MISMATCH' : 'MATCH';
  await t.q('UPDATE customers SET kyc_status=$2, kyc_verified_at=$3, version=version+1, updated_at=now() WHERE id=$1',
    [cust.id, result === 'MATCH' ? 'VERIFIED' : 'MISMATCH', result === 'MATCH' ? iso(now) : null]);
  if (app.status === 'DRAFT') await setStatus(t, app.id, 'IDENTITY_PENDING');
  return { identity: result, evidence_reference: result === 'MATCH' ? 'MOCK-KYC-MATCH' : null, reason_code: result === 'MISMATCH' ? 'IDENTITY_MISMATCH' : null };
}

function luhn(d: string) {
  let s = 0;
  for (let i = 0; i < d.length; i++) { let n = Number(d[d.length - 1 - i]); if (i % 2) { n *= 2; if (n > 9) n -= 9; } s += n; }
  return s % 10 === 0;
}
export async function account(t: Q, actor: Actor, input: any) {
  const app = await ownApplication(t, actor, input.application_id);
  if (!['IDENTITY_PENDING', 'NEEDS_CORRECTION'].includes(app.status)) fail('INVALID_TRANSITION', 409);
  const raw = String(input.card ?? '').replace(/[\s-]/g, '').toUpperCase();
  const demo = /^DEMOCARD\d{4}$/.test(raw);
  if (!demo && !(/^\d{16}$/.test(raw) && luhn(raw))) fail('INVALID_CARD', 422, 'شماره کارت نامعتبر است (نمونه: DEMO-CARD-1234).', [{ field: 'card', code: 'INVALID' }]);
  const last4 = raw.slice(-4);
  const now = await clock(t);
  const cust = await t.one('SELECT user_id, kyc_status FROM customers WHERE id=$1', [app.customer_id]);
  if (cust!.kyc_status !== 'VERIFIED') fail('IDENTITY_NOT_VERIFIED', 422, 'ابتدا احراز هویت را کامل کنید.');
  // Mock account adapter: tokenizes and discards the PAN; only token + last four are stored.
  const token = 'MOCK-ACCT-' + sha256(actor.userId + raw).slice(0, 16);
  const existing = await t.one('SELECT id FROM bank_accounts WHERE model_id=$1 AND provider_token=$2', [MODEL_ID, token]);
  if (!existing) {
    const hasAny = await t.one('SELECT id FROM bank_accounts WHERE owner_user_id=$1 AND owner_match', [cust!.user_id]);
    await t.q(`INSERT INTO bank_accounts(model_id,owner_user_id,provider_token,iban_encrypted,bank_name,card_last4,owner_match,verified_at,cooling_until) VALUES ($1,$2,$3,$4,$5,$6,true,$7,$8)`,
      [MODEL_ID, cust!.user_id, token, `enc:DEMO-IBAN-IR00000000000000000000${last4}`, 'بانک سیمرغ', last4, iso(now), iso(hasAny ? addDays(now, 1) : now)]);
  }
  return { owner_match: true, card_last4: last4, iban_masked: `IR**…${last4}`, bank_name: 'بانک سیمرغ' };
}

export async function uploadDocument(t: Q, actor: Actor, input: any) {
  const app = await ownApplication(t, actor, input.application_id);
  if (['ACTIVE', 'REJECTED', 'CANCELLED', 'EXPIRED', 'APPROVED'].includes(app.status)) fail('INVALID_TRANSITION', 409);
  const category = String(input.category);
  if (!['IDENTITY', 'INCOME'].includes(category)) fail('INVALID_CATEGORY', 422, 'نوع مدرک نامعتبر است.', [{ field: 'category', code: 'INVALID' }]);
  if (input.sample) { input.mime_type = 'image/png'; input.base64 = content().mock_document_asset.base64; }
  const mime = String(input.mime_type);
  if (!['application/pdf', 'image/jpeg', 'image/png'].includes(mime)) fail('INVALID_FILE_TYPE', 422, 'فقط PDF، JPG یا PNG مجاز است.', [{ field: 'file', code: 'TYPE' }]);
  const bytes = Buffer.from(String(input.base64 ?? ''), 'base64');
  if (bytes.length < 1 || bytes.length > 10 * 1024 * 1024) fail('INVALID_FILE_SIZE', 422, 'حجم فایل باید حداکثر ۱۰ مگابایت باشد.', [{ field: 'file', code: 'SIZE' }]);
  const count = await t.one<{ n: number }>('SELECT count(*)::int n FROM documents WHERE application_id=$1', [app.id]);
  if (count!.n >= 10) fail('TOO_MANY_FILES', 422, 'حداکثر ۱۰ فایل برای هر درخواست مجاز است.');
  // Mock scanner: the EICAR test marker is quarantined, everything else is clean.
  const scan = bytes.toString('latin1').includes('EICAR') ? 'QUARANTINED' : 'CLEAN';
  const id = uuid();
  await t.q('INSERT INTO app_uploads(id,model_id,bytes) VALUES ($1,$2,$3)', [id, MODEL_ID, bytes]);
  await t.q(`INSERT INTO documents(id,model_id,application_id,customer_id,category,object_key,content_hash,mime_type,size_bytes,scan_status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [id, MODEL_ID, app.id, app.customer_id, category, `upload/${id}`, sha256(bytes), mime, bytes.length, scan]);
  return { document_id: id, scan_status: scan, content_hash: sha256(bytes) };
}

export async function submitEvidence(t: Q, actor: Actor, input: any) {
  const app = await ownApplication(t, actor, input.application_id);
  if (app.status !== 'IDENTITY_PENDING') fail('INVALID_TRANSITION', 409);
  const cust = await t.one('SELECT * FROM customers WHERE id=$1', [app.customer_id]);
  const errs: { field: string; code: string }[] = [];
  if (cust.kyc_status !== 'VERIFIED') errs.push({ field: 'identity', code: 'NOT_VERIFIED' });
  if (!(await t.one('SELECT id FROM bank_accounts WHERE owner_user_id=$1 AND owner_match AND verified_at IS NOT NULL', [cust.user_id]))) errs.push({ field: 'account', code: 'NOT_VERIFIED' });
  for (const c of ['IDENTITY', 'INCOME'])
    if (!(await t.one("SELECT id FROM documents WHERE application_id=$1 AND category=$2 AND scan_status='CLEAN'", [app.id, c]))) errs.push({ field: `document.${c}`, code: 'REQUIRED' });
  if (errs.length) fail('EVIDENCE_INCOMPLETE', 422, 'مدارک یا تطبیق‌ها کامل نیست.', errs);
  await setStatus(t, app.id, 'FEE_PENDING');
  return { status: 'FEE_PENDING' };
}

export async function payFee(t: Q, actor: Actor, input: any, ctx: Ctx) {
  const app = await ownApplication(t, actor, input.application_id);
  if (app.status !== 'FEE_PENDING') fail('INVALID_TRANSITION', 409);
  const open = await t.one("SELECT id,status FROM payment_intents WHERE application_id=$1 AND purpose='ASSESSMENT_FEE' AND status IN ('PENDING','UNKNOWN','SUCCEEDED')", [app.id]);
  if (open?.status === 'SUCCEEDED') fail('FEE_ALREADY_PAID', 409, 'هزینه استعلام قبلاً پرداخت شده و دوباره دریافت نمی‌شود.');
  if (open) fail('EXTERNAL_PENDING', 409, 'پرداخت قبلی در انتظار نتیجه است؛ ابتدا استعلام کنید.');
  const { paystar } = await parties(t);
  const now = await clock(t);
  const fee = big(fixture().rows.policies[0].configuration.assessment_fee_irr);
  const id = uuid();
  await t.q(`INSERT INTO payment_intents(id,model_id,customer_id,application_id,creditor_id,purpose,amount_irr,provider,provider_intent_ref,status,expires_at)
     VALUES ($1,$2,$3,$4,$5,'ASSESSMENT_FEE',$6,'mock',$7,'PENDING',$8)`, [id, MODEL_ID, app.customer_id, app.id, paystar, fee, newIntentRef(input.scenario), iso(addDays(now, 1))]);
  ctx.effects.push(() => mockPaymentProvider(id));
  return { intent_id: id, amount_irr: fee };
}

const BAND_CAP: Record<string, bigint> = { A: 400000000n, B: 400000000n, C: 200000000n, D: 0n, UNKNOWN: 100000000n };
/** A-18 generalized to n installments: each payment ≈ P × 1.12 / n must fit the 30% monthly capacity. */
export function recommendLimit(band: string, income: bigint, obligations: bigint, n = 4) {
  const capacity = (income * 30n) / 100n - obligations;
  if (capacity <= 0n || band === 'D') return 0n;
  const affordable = (BigInt(n) * capacity * 100n) / 112n;
  const raw = min(400000000n, BAND_CAP[band] ?? 0n, affordable);
  return (raw / 10000000n) * 10000000n;
}

export async function runAssessment(t: Q, actor: Actor, input: any) {
  const app = await ownApplication(t, actor, input.application_id);
  const retry = app.status === 'EXTERNAL_PENDING' && app.resume_stage === 'ASSESSMENT_PENDING';
  if (app.status !== 'ASSESSMENT_PENDING' && !retry) fail('INVALID_TRANSITION', 409);
  if (!(await t.one("SELECT id FROM consents WHERE customer_id=$1 AND purpose='CREDIT_REPORT' AND withdrawn_at IS NULL", [app.customer_id]))) fail('CONSENT_REQUIRED', 422);
  if (!(await t.one("SELECT id FROM payment_intents WHERE application_id=$1 AND purpose='ASSESSMENT_FEE' AND status IN ('SUCCEEDED','REFUNDED')", [app.id]))) fail('FEE_REQUIRED', 422, 'پرداخت هزینه استعلام باید پیش از درخواست گزارش تأیید شود.');
  const now = await clock(t);
  if (input.scenario === 'timeout') {
    if (!retry) await setStatus(t, app.id, 'EXTERNAL_PENDING', { resume_stage: 'ASSESSMENT_PENDING' });
    return { status: 'EXTERNAL_PENDING', message: 'گزارش اعتبارسنجی هنوز دریافت نشده است؛ پس از ۴۸ ساعت هزینه بازگردانده می‌شود.' };
  }
  const cust = await t.one('SELECT * FROM customers WHERE id=$1', [app.customer_id]);
  const nid: string = cust.identity_details?.national_id ?? '';
  const band = nid.includes('rejected') ? 'D' : 'A';
  const ref = `MOCK-CREDIT-${app.id.slice(0, 8)}-${uuid().slice(0, 6)}`;
  await t.q(`INSERT INTO assessments(model_id,application_id,provider_reference,risk_band,existing_obligations_irr,report_hash,assessed_at,expires_at,features) VALUES ($1,$2,$3,$4,0,$5,$6,$7,$8)`,
    [MODEL_ID, app.id, ref, band, sha256(ref), iso(now), iso(addDays(now, 30)), JSON.stringify({ income_verified: true, bounced_check: false, demo: true })]);
  // Recommendation never exceeds what the customer asked for.
  const computed = recommendLimit(band, big(cust.verified_monthly_income_irr), big(cust.external_monthly_obligations_irr), Number(app.installment_count ?? 4));
  const rec = app.requested_limit_irr ? min(computed, big(app.requested_limit_irr)) : computed;
  await setStatus(t, app.id, 'PAYSTAR_REVIEW', { recommended_limit_irr: rec, resume_stage: null });
  return { status: 'PAYSTAR_REVIEW', risk_band: band, recommended_limit_irr: rec };
}

export async function resubmit(t: Q, actor: Actor, input: any) {
  const app = await ownApplication(t, actor, input.application_id);
  if (app.status !== 'NEEDS_CORRECTION') fail('INVALID_TRANSITION', 409);
  const dec = await t.one("SELECT * FROM decisions WHERE application_id=$1 AND outcome='CORRECTION' ORDER BY created_at DESC LIMIT 1", [app.id]);
  const missing: { field: string; code: string }[] = [];
  for (const f of (dec?.field_errors ?? []) as { field: string }[]) {
    if (f.field === 'income_document' || f.field === 'identity_document') {
      const cat = f.field === 'income_document' ? 'INCOME' : 'IDENTITY';
      const doc = await t.one("SELECT id FROM documents WHERE application_id=$1 AND category=$2 AND scan_status='CLEAN' AND created_at > $3", [app.id, cat, dec.created_at]);
      if (!doc) missing.push({ field: f.field, code: 'NEW_DOCUMENT_REQUIRED' });
    }
  }
  if (missing.length) fail('CORRECTION_INCOMPLETE', 422, 'فقط موارد درخواست‌شده را تکمیل کنید؛ هنوز مدرک جدید بارگذاری نشده است.', missing);
  const stage = app.resume_stage || 'PAYSTAR_REVIEW';
  await setStatus(t, app.id, stage, { resume_stage: null, correction_due_at: null });
  if (stage === 'CREDITOR_REVIEW') await submitToBank(t, app.id, app.creditor_id, 'RESUBMISSION');
  return { status: stage };
}

async function submitToBank(t: Q, appId: string, bankId: string, kind: string) {
  await t.q(`INSERT INTO bank_instructions(model_id,bank_id,application_id,instruction_type,external_reference,status,payload_hash) VALUES ($1,$2,$3,'APPLICATION_SUBMISSION',$4,'SUBMITTED',$5)`,
    [MODEL_ID, bankId, appId, `PS-APP-${appId.slice(0, 8)}-${uuid().slice(0, 6)}`, sha256(`${kind}:${appId}`)]);
}

function decisionInput(input: any) {
  const outcome = String(input.outcome);
  if (!['APPROVE', 'REJECT', 'CORRECTION'].includes(outcome)) fail('INVALID_OUTCOME', 400);
  const reason = String(input.reason_code || (outcome === 'APPROVE' ? 'MEETS_POLICY' : '')).trim();
  const msg = String(input.customer_message || '').trim();
  if (outcome !== 'APPROVE' && (!reason || !msg)) fail('REASON_REQUIRED', 422, 'دلیل و پیام قابل ارائه به مشتری الزامی است.', [{ field: 'customer_message', code: 'REQUIRED' }]);
  const fields: string[] = Array.isArray(input.fields) ? input.fields : String(input.fields ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (outcome === 'CORRECTION' && !fields.length) fail('FIELDS_REQUIRED', 422, 'برای درخواست اصلاح، فیلد/مدرک دقیق را مشخص کنید.', [{ field: 'fields', code: 'REQUIRED' }]);
  return { outcome, reason, msg: msg || 'درخواست شما در این مرحله تأیید شد', fields };
}

/** PayStar preliminary review: a recommendation only — never a final credit decision in Model 4. */
export async function paystarReview(t: Q, actor: Actor, input: any) {
  const app = await t.one('SELECT * FROM applications WHERE id=$1 FOR UPDATE', [input.application_id]);
  if (!app) fail('NOT_FOUND', 404);
  if (app.status !== 'PAYSTAR_REVIEW') fail('INVALID_TRANSITION', 409, app.status === 'CREDITOR_REVIEW' ? 'تصمیم نهایی در مدل ۴ فقط با بانک است.' : undefined);
  await bumpVersion(t, 'applications', app.id, input.version);
  const d = decisionInput(input);
  const now = await clock(t);
  await t.q(`INSERT INTO decisions(model_id,application_id,actor_id,stage,outcome,reason_code,customer_message,field_errors) VALUES ($1,$2,$3,'PAYSTAR_REVIEW',$4,$5,$6,$7)`,
    [MODEL_ID, app.id, actor.userId, d.outcome, d.reason, d.msg, JSON.stringify(d.fields.map((f) => ({ field: f, code: 'REQUIRED' })))]);
  if (d.outcome === 'APPROVE') {
    await setStatus(t, app.id, 'CREDITOR_REVIEW');
    await submitToBank(t, app.id, app.creditor_id, 'SUBMISSION');
  } else if (d.outcome === 'CORRECTION') await setStatus(t, app.id, 'NEEDS_CORRECTION', { resume_stage: 'PAYSTAR_REVIEW', correction_due_at: iso(addDays(now, 14)) });
  else await setStatus(t, app.id, 'REJECTED', { reapply_at: iso(addDays(now, 90)) });
  await notifyCustomer(t, app.customer_id, `APP:${app.id}:${d.outcome}:${iso(now)}`);
  return { status: d.outcome === 'APPROVE' ? 'CREDITOR_REVIEW' : d.outcome === 'CORRECTION' ? 'NEEDS_CORRECTION' : 'REJECTED' };
}

/** Bank final decision — the only path to an approved Model 4 limit. */
export async function bankDecide(t: Q, actor: Actor, input: any) {
  if (finalDecisionRole(MODEL_ID) !== actor.role) fail('FORBIDDEN', 403, 'تصمیم نهایی اعتبار در مدل ۴ فقط با بانک است.');
  const app = await t.one('SELECT * FROM applications WHERE id=$1 FOR UPDATE', [input.application_id]);
  if (!app || app.creditor_id !== actor.orgId) fail('NOT_FOUND', 404);
  if (app.status !== 'CREDITOR_REVIEW') fail('INVALID_TRANSITION', 409);
  await bumpVersion(t, 'applications', app.id, input.version);
  const d = decisionInput(input);
  const now = await clock(t);
  let limit: bigint | null = null;
  if (d.outcome === 'APPROVE') {
    limit = parseMoney(input.limit_irr || String(app.recommended_limit_irr), 'limit_irr');
    if (limit <= 0n || limit > big(app.recommended_limit_irr) || limit % 10000000n !== 0n)
      fail('INVALID_LIMIT', 422, 'سقف باید مضرب ۱ میلیون تومان و حداکثر برابر پیشنهاد پی‌استار باشد.', [{ field: 'limit_irr', code: 'INVALID' }]);
  }
  await t.q(`INSERT INTO decisions(model_id,application_id,actor_id,stage,outcome,reason_code,customer_message,field_errors,approved_limit_irr) VALUES ($1,$2,$3,'CREDITOR_REVIEW',$4,$5,$6,$7,$8)`,
    [MODEL_ID, app.id, actor.userId, d.outcome, d.reason, d.msg, JSON.stringify(d.fields.map((f) => ({ field: f, code: 'REQUIRED' }))), limit]);
  await t.q("UPDATE bank_instructions SET status=$2, acknowledged_at=$3, version=version+1, updated_at=now() WHERE application_id=$1 AND instruction_type='APPLICATION_SUBMISSION' AND status='SUBMITTED'",
    [app.id, d.outcome === 'APPROVE' ? 'CONFIRMED' : d.outcome, iso(now)]);
  if (d.outcome === 'APPROVE') {
    await setStatus(t, app.id, 'APPROVED', { approved_limit_irr: limit });
    await t.q(`INSERT INTO credit_lines(model_id,customer_id,application_id,creditor_id,limit_irr,status,expires_at,installment_count) VALUES ($1,$2,$3,$4,$5,'APPROVED_PENDING_CONTRACT',$6,$7)`,
      [MODEL_ID, app.customer_id, app.id, app.creditor_id, limit, iso(addDays(now, 90)), app.installment_count ?? 4]);
  } else if (d.outcome === 'CORRECTION') await setStatus(t, app.id, 'NEEDS_CORRECTION', { resume_stage: 'CREDITOR_REVIEW', correction_due_at: iso(addDays(now, 14)) });
  else await setStatus(t, app.id, 'REJECTED', { reapply_at: iso(addDays(now, 90)) });
  await notifyCustomer(t, app.customer_id, `APP:${app.id}:BANK:${d.outcome}:${iso(now)}`);
  await outbox(t, 'application', app.id, 'application.decisioned.v1', { outcome: d.outcome, by: 'BANK' });
  return { status: d.outcome === 'APPROVE' ? 'APPROVED' : d.outcome === 'CORRECTION' ? 'NEEDS_CORRECTION' : 'REJECTED', approved_limit_irr: limit };
}

/** Customer signs the bank framework credit agreement; only then the line becomes spendable. */
export async function signLine(t: Q, actor: Actor, input: any) {
  const line = await t.one('SELECT * FROM credit_lines WHERE id=$1 FOR UPDATE', [input.credit_line_id]);
  if (!line || line.customer_id !== actor.customerId) fail('NOT_FOUND', 404);
  if (line.status !== 'APPROVED_PENDING_CONTRACT') fail('INVALID_TRANSITION', 409);
  if (!input.accept) fail('SIGNATURE_REQUIRED', 422, 'برای امضا، متن قرارداد را تأیید کنید.', [{ field: 'accept', code: 'REQUIRED' }]);
  const now = await clock(t);
  const policy = await t.one("SELECT * FROM policies WHERE status='APPROVED' ORDER BY policy_version DESC LIMIT 1");
  const terms = { kind: 'BANK_FRAMEWORK_CREDIT', borrower: line.customer_id, lender: line.creditor_id, limit_irr: String(line.limit_irr), commission_bps: 1200, installments: Number(line.installment_count ?? 4), policy: policy.id, simulation: true };
  await t.q(`INSERT INTO contracts(model_id,application_id,creditor_id,policy_id,contract_type,document_hash,status,signed_at,signature_evidence,terms_snapshot) VALUES ($1,$2,$3,$4,'BANK_FRAMEWORK',$5,'SIGNED',$6,$7,$8)`,
    [MODEL_ID, line.application_id, line.creditor_id, policy.id, sha256(JSON.stringify(terms)), iso(now), JSON.stringify({ demo: true, otp: 'MOCK-SIGN', signers: [line.customer_id, line.creditor_id] }), JSON.stringify(terms)]);
  await t.q("UPDATE credit_lines SET status='ACTIVE', version=version+1, updated_at=now() WHERE id=$1", [line.id]);
  await setStatus(t, line.application_id, 'ACTIVE');
  await audit(t, actor, 'contract.signed', 'credit_line', line.id, terms);
  return { status: 'ACTIVE' };
}
