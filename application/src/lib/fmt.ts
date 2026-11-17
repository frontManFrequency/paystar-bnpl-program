/** Display helpers: Persian digits, toman primary with exact rial secondary, Jalali dates. Pure and client-safe. */
const FA = '۰۱۲۳۴۵۶۷۸۹';
export const fa = (s: string | number | bigint) => String(s).replace(/\d/g, (d) => FA[Number(d)]);
function group(s: string) { return s.replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
/** Exact rial (integer string/bigint) → "۱۱٬۲۰۰٬۰۰۰ تومان". Toman = rial / 10; a non-zero remainder is shown exactly. */
export function toman(v: unknown) {
  if (v === null || v === undefined || v === '') return '—';
  const r = BigInt(String(v));
  const neg = r < 0n; const a = neg ? -r : r;
  const t = a / 10n, rem = a % 10n;
  return (neg ? '−' : '') + fa(group(t.toString()) + (rem ? `.${rem}` : '')).replace(/,/g, '٬') + ' تومان';
}
export const rial = (v: unknown) => (v === null || v === undefined ? '—' : fa(group(BigInt(String(v)).toString())).replace(/,/g, '٬') + ' ریال');
const jal = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { timeZone: 'Asia/Tehran', year: 'numeric', month: 'long', day: 'numeric' });
const jalT = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
const greg = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' });
export const jdate = (d: unknown) => (d ? jal.format(new Date(d as any)) : '—');
export const jdatetime = (d: unknown) => (d ? jalT.format(new Date(d as any)) : '—');
export const gdate = (d: unknown) => (d ? greg.format(new Date(d as any)) : '');
export const short = (id: unknown) => (id ? String(id).slice(0, 8) : '—');

export const STATUS: Record<string, string> = {
  DRAFT: 'پیش‌نویس', IDENTITY_PENDING: 'در انتظار احراز هویت و مدارک', FEE_PENDING: 'در انتظار پرداخت هزینه استعلام', ASSESSMENT_PENDING: 'در انتظار اعتبارسنجی',
  EXTERNAL_PENDING: 'در انتظار سرویس بیرونی', PAYSTAR_REVIEW: 'بررسی مقدماتی پی‌استار', CREDITOR_REVIEW: 'بررسی نهایی بانک', NEEDS_CORRECTION: 'نیازمند اصلاح',
  REJECTED: 'رد شده', APPROVED: 'سقف تأیید شده (در انتظار قرارداد)', APPROVED_PENDING_CONTRACT: 'تأیید شده؛ در انتظار امضای قرارداد بانک', ACTIVE: 'فعال', HELD: 'مصرف متوقف',
  EXPIRED: 'منقضی', CANCELLED: 'لغو شده', CONFIRMED: 'تأیید شده', AWAITING_FUNDS: 'در انتظار واریز بانک به کلینیک', READY_FOR_SERVICE: 'آماده ارائه خدمت',
  STARTED: 'خدمت شروع شده', COMPLETED: 'خدمت انجام شده', OVERDUE: 'سررسید گذشته', PAID: 'پرداخت شده', DUE: 'سررسید امروز', SCHEDULED: 'زمان‌بندی‌شده',
  PARTIALLY_PAID: 'پرداخت جزئی', PARTIALLY_CANCELLED: 'بخشی لغو شده', SUPERSEDED: 'جایگزین شده', PENDING: 'در انتظار', UNKNOWN: 'در انتظار تأیید', SUCCEEDED: 'موفق',
  FAILED: 'ناموفق', REFUNDED: 'بازگردانده شد', RESERVED: 'اعتبار رزرو شد', CONTRACT_READY: 'قرارداد و چک آماده', PAYMENT_PENDING: 'در انتظار نتیجه پرداخت',
  REGISTERED: 'ثبت‌شده (در انتظار پذیرش بانک)', IN_CUSTODY: 'در امانت بانک', RELEASE_PENDING: 'در انتظار آزادسازی', RELEASED: 'آزاد شد', QUEUED: 'در صف',
  SUBMITTED: 'ارسال‌شده', REQUESTED: 'درخواست‌شده', FUNDED: 'وجه آماده برداشت', FUNDING_DELAYED: 'تأخیر در تأمین وجه', POSTED: 'ثبت شد', RETURNED: 'برگشت کامل',
  PARTIALLY_RETURNED: 'برگشت جزئی', SETTLED: 'تسویه کامل', MONITORING: 'پایش', SOFT: 'پیگیری نرم', LEGAL_REVIEW: 'ارجاع به حقوقی بانک', LEGAL_ACTIVE: 'اقدام حقوقی مجاز',
  RECOVERY: 'وصول', CLOSED: 'بسته', OPEN: 'باز', RESOLVED: 'حل شده', ELIGIBLE: 'واجد شرایط', RECOVERED: 'وصول شد', UNAPPLIED: 'وجه اعمال‌نشده (قابل بازگشت)',
  PARTIALLY_UNAPPLIED: 'بخشی اعمال‌نشده', MATCHED: 'تطبیق کامل', EXCEPTIONS: 'دارای مغایرت', APPROVED_PENDING_AMENDMENT: 'تأیید؛ در انتظار الحاقیه', CHECKOUT_SENT: 'لینک پرداخت ارسال شد', ASSESSMENT_FEE: 'هزینه استعلام', FIRST_INSTALLMENT: 'قسط اول', INSTALLMENT: 'قسط',
};
export const st = (s: unknown) => STATUS[String(s)] ?? String(s ?? '—');
export const ROLE_FA: Record<string, string> = { 'super-admin': 'مدیر ارشد', 'paystar-admin': 'کارشناس پی‌استار', 'business-admin': 'کلینیک', customer: 'مشتری', bank: 'بانک' };
export const ROLE_HOME: Record<string, string> = { 'super-admin': '/admin', 'paystar-admin': '/ops', 'business-admin': '/business', customer: '/account', bank: '/bank' };
