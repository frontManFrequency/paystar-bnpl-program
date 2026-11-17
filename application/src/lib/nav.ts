/** Sidebar navigation per role workspace. `key` is the URL segment under the role base. */
export interface NavItem { key: string; label: string; icon: string; desc: string; short?: string }
/** `tabs`: keys shown in the mobile bottom tab bar (the rest go into the «بیشتر» sheet). */
export interface RoleNav { base: string; title: string; items: NavItem[]; tabs: string[] }

export const NAV: Record<string, RoleNav> = {
  customer: { base: '/account', title: 'حساب مشتری', tabs: ['', 'application', 'purchases', 'wallet'], items: [
    { key: '', short: 'خانه', label: 'داشبورد', icon: 'home', desc: 'خلاصه وضعیت و اقدام بعدی' },
    { key: 'application', short: 'درخواست', label: 'درخواست اعتبار', icon: 'doc', desc: 'احراز هویت، مدارک، هزینه و تصمیم' },
    { key: 'credit', label: 'اعتبار من', icon: 'credit', desc: 'سقف، مانده و قرارداد بانک' },
    { key: 'purchases', short: 'خریدها', label: 'خریدها و اقساط', icon: 'list', desc: 'پیش‌فاکتورها، پرداخت و صورت‌حساب' },
    { key: 'wallet', short: 'کیف', label: 'کیف بازپرداخت', icon: 'wallet', desc: 'وجوه برگشتی و برداشت' },
    { key: 'support', label: 'پشتیبانی', icon: 'help', desc: 'اختلاف، مهلت و اعتراض' },
    { key: 'notifications', label: 'اعلان‌ها', icon: 'bell', desc: 'یادآوری‌ها و پیام‌ها' },
  ] },
  'business-admin': { base: '/business', title: 'پنل کلینیک', tabs: ['', 'orders', 'purchases', 'referrals'], items: [
    { key: '', short: 'خانه', label: 'داشبورد', icon: 'home', desc: 'خلاصه تسویه و معرفی' },
    { key: 'orders', short: 'سفارش', label: 'سفارش‌ها', icon: 'plus', desc: 'سفارش جدید و پیش‌فاکتور' },
    { key: 'purchases', short: 'خریدها', label: 'خریدها و خدمت', icon: 'list', desc: 'شروع خدمت و برگشت' },
    { key: 'referrals', short: 'معرفی', label: 'معرفی و کاتالوگ', icon: 'link', desc: 'لینک معرفی، معرفی‌شدگان، ویترین' },
    { key: 'guarantee', label: 'ضمانت', icon: 'shield', desc: 'ضمانت به نفع بانک و مطالبات' },
  ] },
  'paystar-admin': { base: '/ops', title: 'عملیات پی‌استار', tabs: ['', 'applications', 'payments', 'collections'], items: [
    { key: '', short: 'خانه', label: 'داشبورد', icon: 'home', desc: 'شاخص‌های عملیات' },
    { key: 'applications', short: 'بررسی', label: 'بررسی درخواست‌ها', icon: 'doc', desc: 'بررسی مقدماتی و ارسال به بانک' },
    { key: 'purchases', label: 'خریدها', icon: 'list', desc: 'ردگیری خریدها' },
    { key: 'payments', short: 'پرداخت', label: 'پرداخت‌ها', icon: 'swap', desc: 'نامعلوم، تکراری، اعمال‌نشده' },
    { key: 'settlements', label: 'تسویه کلینیک', icon: 'send', desc: 'واریز بانک به کلینیک' },
    { key: 'refunds', label: 'برگشت و کیف', icon: 'refresh', desc: 'برگشت‌ها، کیف و برداشت' },
    { key: 'collections', short: 'پیگیری', label: 'پیگیری', icon: 'clock', desc: 'پیگیری نرم تا DPD29' },
    { key: 'support', label: 'پشتیبانی', icon: 'help', desc: 'اختلاف و اعتراض' },
    { key: 'recon', label: 'تطبیق', icon: 'layers', desc: 'تطبیق روزانه حساب‌ها' },
  ] },
  bank: { base: '/bank', title: 'پنل بانک', tabs: ['', 'applications', 'disbursements', 'loans'], items: [
    { key: '', short: 'خانه', label: 'داشبورد', icon: 'home', desc: 'خلاصه سبد وام' },
    { key: 'applications', short: 'تصمیم', label: 'تصمیم اعتباری', icon: 'doc', desc: 'تأیید، اصلاح یا رد نهایی' },
    { key: 'checks', label: 'پذیرش چک', icon: 'check', desc: 'چک‌های صادرشده به نام بانک' },
    { key: 'disbursements', short: 'واریز', label: 'واریز به کلینیک', icon: 'send', desc: 'پیشنهاد و تأیید دوگانه' },
    { key: 'loans', short: 'وام‌ها', label: 'وام‌ها', icon: 'list', desc: 'سبد وام و صورت‌حساب‌ها' },
    { key: 'amendments', label: 'اصلاحیه‌ها', icon: 'refresh', desc: 'اصلاح بدهی پس از برگشت' },
    { key: 'collections', label: 'وصول و ضمانت', icon: 'law', desc: 'اقدام حقوقی و ضمانت کلینیک' },
    { key: 'hardship', label: 'درخواست مهلت', icon: 'pause', desc: 'تصمیم مهلت پرداخت' },
    { key: 'invoices', label: 'صورت‌حساب کارمزد', icon: 'receipt', desc: 'کارمزد خدمات پی‌استار' },
  ] },
  'super-admin': { base: '/admin', title: 'مدیریت ارشد', tabs: ['', 'applications', 'operations', 'organizations'], items: [
    { key: '', short: 'خانه', label: 'داشبورد', icon: 'home', desc: 'سلامت عملیات' },
    { key: 'applications', short: 'درخواست‌ها', label: 'درخواست‌های اعتبار', icon: 'doc', desc: 'وضعیت همه درخواست‌ها (فقط مشاهده)' },
    { key: 'operations', short: 'عملیات', label: 'کنترل عملیات', icon: 'settings', desc: 'ساعت، توقف، بازنشانی، جلسه' },
    { key: 'organizations', short: 'کاربران', label: 'سازمان‌ها و کاربران', icon: 'users', desc: 'ساخت کاربر، کلینیک و مدیریت دسترسی' },
    { key: 'policies', label: 'سیاست‌ها', icon: 'doc', desc: 'نسخه‌های سیاست' },
    { key: 'audit', label: 'ممیزی', icon: 'audit', desc: 'رویدادهای ممیزی' },
  ] },
};
