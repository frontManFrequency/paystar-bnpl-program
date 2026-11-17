import Link from 'next/link';
import { requirePageRole } from '@/server/session';
import { readScope } from '@/server/registry';
import { clock } from '@/server/core';
import { statement } from '@/server/services';
import { clinicCustomers } from '@/server/cmd-checkout';
import Action from '@/components/Action';
import { SectionTiles } from '@/components/AppShell';
import { Badge, Card, Kpi, M, Table, fa, jdate, jdatetime, short } from '@/components/ui';

export default async function BusinessView({ section }: { section: string }) {
  const show = (...k: string[]) => k.includes(section);
  const actor = await requirePageRole('business-admin');
  const org = actor.orgId!;
  const d = await readScope(actor, async (t) => {
    const now = await clock(t);
    const clinic = await t.one('SELECT * FROM organizations WHERE id=$1', [org]);
    const referrals = await t.q('SELECT * FROM referrals WHERE business_id=$1 ORDER BY created_at DESC', [org]);
    // Inviter sees pseudonymous name, stage and update time only — no documents, score, income or account data.
    const invited = await t.q(`SELECT u.display_name, a.status, a.updated_at FROM applications a JOIN referrals r ON r.id=a.referral_id JOIN customers c ON c.id=a.customer_id JOIN users u ON u.id=c.user_id WHERE r.business_id=$1 ORDER BY a.updated_at DESC`, [org]);
    const customers = (await clinicCustomers(t, org)).filter((c: any) => c.credit_line_id);
    const catalog = await t.q('SELECT * FROM catalog_items WHERE business_id=$1 ORDER BY price_irr', [org]);
    const orders = await t.q(`SELECT o.*, c.id checkout_id, c.status checkout_status, c.expires_at, u.display_name FROM orders o JOIN checkouts c ON c.order_id=o.id JOIN customers cu ON cu.id=o.customer_id JOIN users u ON u.id=cu.user_id WHERE o.business_id=$1 ORDER BY o.created_at DESC`, [org]);
    const purchases = []; for (const p of await t.q('SELECT id FROM purchases WHERE business_id=$1 ORDER BY confirmed_at DESC', [org])) purchases.push((await statement(t, p.id))!);
    const settlements = await t.q('SELECT * FROM settlements WHERE to_party_id=$1', [org]);
    const refunds = await t.q('SELECT r.*, u.display_name requester FROM refunds r JOIN purchases p ON p.id=r.purchase_id JOIN users u ON u.id=r.requested_by WHERE p.business_id=$1 ORDER BY r.created_at DESC', [org]);
    const guarantee = await t.one('SELECT g.*, b.name beneficiary FROM guarantees g JOIN organizations b ON b.id=g.beneficiary_id WHERE g.business_id=$1', [org]);
    const claims = guarantee ? await t.q('SELECT * FROM guarantee_claims WHERE guarantee_id=$1 ORDER BY created_at DESC', [guarantee.id]) : [];
    const amend = await t.q("SELECT b.purchase_id, b.status FROM bank_instructions b JOIN purchases p ON p.id=b.purchase_id WHERE p.business_id=$1 AND b.instruction_type='REFUND_AMENDMENT' AND b.status='PENDING'", [org]);
    return { now, clinic, referrals, invited, customers, catalog, orders, purchases, settlements, refunds, guarantee, claims, amend };
  });
  const gross = d.settlements.reduce((a: bigint, s: any) => a + BigInt(s.amount_irr), 0n);
  const received = d.settlements.filter((s: any) => s.status === 'CONFIRMED').reduce((a: bigint, s: any) => a + BigInt(s.amount_irr), 0n);
  const reimb = d.refunds.filter((r: any) => ['FUNDED', 'FUNDING_DELAYED'].includes(r.status)).reduce((a: bigint, r: any) => a + BigInt(r.principal_delta_irr), 0n);
  const overdue = d.purchases.filter((s: any) => s.dpd > 0);
  return <>
    {show('overview') && <>
    <p className="ps-small ps-muted">در مدل ۴، بانک اعتباردهنده و پرداخت‌کننده کل مبلغ خدمت به شماست. ارسال درخواست توسط پی‌استار به معنی واریز نیست؛ شروع خدمت فقط پس از تأیید واریز بانک.</p>
    <div className="ps-grid">
      <Kpi l="معرفی‌شدگان" v={fa(d.invited.length)} s={`فعال: ${fa(d.invited.filter((i: any) => i.status === 'ACTIVE').length)}`} />
      <Kpi l="مطالبه از بانک (ناخالص)" v={<M v={gross} />} />
      <Kpi l="دریافت‌شده از بانک" v={<M v={received} />} />
      <Kpi l="تعهد بازپرداخت اصل به بانک/پی‌استار (برگشت‌ها)" v={<M v={reimb} />} />
      <Kpi l="خریدهای دارای تأخیر" v={fa(overdue.length)} s="ریسک نکول با بانک است؛ ضمانت سقف‌دار جداگانه" />
    </div>

    </>}
    {show('overview') && <SectionTiles role="business-admin" counts={{ orders: fa(d.orders.length), purchases: fa(d.purchases.length), referrals: fa(d.invited.length) }} />}
    {show('orders') && <>
    <Card title="سفارش جدید و پیش‌فاکتور اقساطی">
      {d.customers.length ? <Action command="order.create" label="ایجاد پیش‌فاکتور و ارسال لینک پرداخت"
        fields={[{ name: 'customer_id', label: 'مشتری معرفی‌شده دارای اعتبار', type: 'select', options: d.customers.map((c: any) => ({ value: c.id, label: `${c.display_name} (${c.line_status})` })) },
          { name: 'catalog_item_id', label: 'خدمت', type: 'select', options: d.catalog.map((c: any) => ({ value: c.id, label: `${c.title} — ${BigInt(c.price_irr) / 10n} تومان` })) },
          { name: 'financed_principal_irr', label: 'مبلغ اقساطی P (ریال)؛ مابقی نقدی مستقیم به کلینیک', placeholder: 'خالی = کل قیمت' }]}
        confirm="اعتبار مشتری به مدت ۱۵ دقیقه رزرو می‌شود؛ قیمت از کاتالوگ معتبر بازمحاسبه می‌شود." /> : <p className="ps-small ps-muted">مشتری دارای اعتبار فعال که توسط این کلینیک معرفی شده باشد وجود ندارد.</p>}
      <Table head={['سفارش', 'مشتری', 'کل خدمت', 'اقساطی', 'نقدی', 'پیش‌فاکتور', 'انقضا', '']} rows={d.orders.map((o: any) => [o.external_reference, o.display_name, <M key="t" v={o.service_total_irr} />, <M key="p" v={o.financed_principal_irr} />, <M key="c" v={o.cash_contribution_irr} />, <Badge key="b" s={o.checkout_status} />, jdatetime(o.expires_at),
        ['RESERVED', 'CONTRACT_READY'].includes(o.checkout_status) ? <Action key="x" command="checkout.cancel" label="لغو" fixed={{ checkout_id: o.checkout_id }} inline tone="neutral" /> : ''])} />
    </Card>

    </>}
    {show('purchases') && <>
    <Card title="خریدها، ارائه خدمت و برگشت">
      {d.purchases.map((s: any) => {
        const reqs = d.refunds.filter((r: any) => r.purchase_id === s.purchase.id);
        const pendingReq = reqs.find((r: any) => r.status === 'REQUESTED');
        return <div key={s.purchase.id} className="ps-card">
          <h3>{s.purchase.customer_name} · <M v={s.totals.principal} /> <Badge s={s.purchase.status} /> <Badge s={s.purchase.service_status} /></h3>
          <p className="ps-small">اعتباردهنده: {s.purchase.creditor_name} · برگشت‌شده: <M v={s.purchase.returned_principal_irr} /> · <Link href={`/business/purchases/${s.purchase.id}`}>صورت‌حساب</Link>
            {d.amend.some((a: any) => a.purchase_id === s.purchase.id) && <> · <span className="ps-badge ps-badge--warning">اصلاحیه در انتظار تأیید بانک</span></>}</p>
          <div className="ps-actions">
            {['AWAITING_FUNDS', 'READY_FOR_SERVICE'].includes(s.purchase.service_status) && <Action command="service.start" label="شروع خدمت" fixed={{ purchase_id: s.purchase.id }} inline />}
            {s.purchase.service_status === 'STARTED' && <Action command="service.complete" label="ثبت پایان خدمت" fixed={{ purchase_id: s.purchase.id }} inline tone="neutral" />}
          </div>
          {pendingReq ? <div className="ps-alert ps-alert--block">درخواست برگشت تجمعی <M v={pendingReq.cumulative_principal_irr} /> توسط {pendingReq.requester} · بازپرداخت به مشتری <M v={pendingReq.wallet_entitlement_irr} /> — تأیید باید توسط کاربر دیگر کلینیک باشد.
            <div className="ps-actions"><Action command="return.approve" label="تأیید برگشت" fixed={{ refund_id: pendingReq.id }} inline /><Action command="return.reject" label="رد" fixed={{ refund_id: pendingReq.id }} inline tone="neutral" /></div></div>
            : BigInt(s.purchase.returned_principal_irr) < BigInt(s.purchase.principal_irr) && ['CONFIRMED', 'PARTIALLY_RETURNED', 'SETTLED'].includes(s.purchase.status) && <details className="ps-accordion"><summary>ثبت برگشت خدمت (کامل/جزئی)</summary>
              <Action command="return.request" label="ارسال درخواست برگشت" fixed={{ purchase_id: s.purchase.id }}
                fields={[{ name: 'return_principal_irr', label: 'مبلغ اصل برگشتی این نوبت (ریال)', defaultValue: String((BigInt(s.purchase.principal_irr) - BigInt(s.purchase.returned_principal_irr)) / 2n) }, { name: 'reason', label: 'دلیل و مستند', type: 'textarea' }]}
                confirm="پیش‌نمایش: مبالغ پرداخت‌شده به کیف مشتری برمی‌گردد و اقساط آتی به نسبت لغو می‌شوند. تأیید نهایی با کاربر دوم کلینیک است." /></details>}
          {reqs.length > 0 && <Table head={['تجمعی', 'این نوبت', 'کیف مشتری', 'وضعیت']} rows={reqs.map((r: any) => [<M key="c" v={r.cumulative_principal_irr} />, <M key="d" v={r.principal_delta_irr} />, <M key="w" v={r.wallet_entitlement_irr} />, <Badge key="b" s={r.status} />])} />}
        </div>;
      })}
      <a href="/api/v1/exports/orders">خروجی CSV (فقط خریدهای همین کلینیک)</a>
    </Card>

    </>}
    {show('referrals') && <>
    <Card title="معرفی و نمایشگاه">
      <Action command="referral.create" label="ساخت لینک معرفی جدید" tone="neutral" />
      <Table head={['لینک', 'انقضا', 'وضعیت', '']} rows={d.referrals.map((r: any) => [<span key="t" className="ps-id">{r.token_hash.startsWith('DEMO-') ? <Link href={`/r/${r.token_hash}`}>/r/{r.token_hash}</Link> : `hash ${short(r.token_hash)}`}</span>, jdate(r.expires_at), r.revoked_at ? 'لغوشده' : 'فعال',
        !r.revoked_at ? <Action key="a" command="referral.revoke" label="لغو" fixed={{ referral_id: r.id }} inline tone="neutral" /> : ''])} />
      <h3>وضعیت معرفی‌شدگان (بدون اطلاعات محرمانه)</h3>
      <Table head={['نام نمایشی', 'مرحله', 'به‌روزرسانی']} rows={d.invited.map((i: any) => [i.display_name, <Badge key="b" s={i.status} />, jdatetime(i.updated_at)])} />
      <h3>کاتالوگ</h3>
      <Table head={['خدمت', 'قیمت', 'به‌روزرسانی', 'وضعیت']} rows={d.catalog.map((c: any) => [c.title, <M key="m" v={c.price_irr} />, jdatetime(c.source_updated_at), +d.now - +new Date(c.source_updated_at) > 86400000 ? <span key="s" className="ps-badge ps-badge--error">قدیمی؛ غیرقابل خرید</span> : <span key="s" className="ps-badge ps-badge--success">تازه</span>])} />
      <p className="ps-small"><Link href={`/b/${d.clinic.slug}`}>ویترین اختصاصی /b/{d.clinic.slug}</Link></p>
    </Card>

    </>}
    {show('guarantee') && <>
    {d.guarantee && <Card title="ضمانت کلینیک به نفع بانک">
      <p className="ps-small">ذی‌نفع: {d.guarantee.beneficiary} · نوع: {d.guarantee.guarantee_type} · پوشش {fa(d.guarantee.coverage_bps / 100)}٪ اصل باقی‌مانده نکول‌شده · سقف <M v={d.guarantee.cap_irr} /> · استفاده‌شده <M v={d.guarantee.used_irr} /> · رزرو <M v={d.guarantee.reserved_claim_irr} /> · شرط: DPD60، پس از پیگیری مشتری و ارائه چک و ۱۵ روز وصول مستند، با مجوز حقوقی بانک. بدون جریمه و کارمزد.</p>
      <Table head={['مطالبه', 'مبلغ', 'وضعیت', '']} rows={d.claims.map((c: any) => [<span key="i" className="ps-id">{short(c.id)}</span>, <M key="m" v={c.requested_irr} />, <Badge key="b" s={c.status} />,
        c.status === 'SUBMITTED' ? <Action key="a" command="guarantee.pay_claim" label="پرداخت مطالبه" fixed={{ claim_id: c.id }} inline confirm="پرداخت ضمانت در سقف قرارداد؛ بدهی مشتری تسویه نمی‌شود." /> : ''])} empty="مطالبه‌ای ثبت نشده است." />
    </Card>}
    </>}
  </>;
}
