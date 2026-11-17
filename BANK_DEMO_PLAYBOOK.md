# Bank-manager demonstration and decision brief

This is a meeting script for the implemented prototypes, not a claim that the application is already complete. All accounts, transactions, rates and customer records in the demo are synthetic. No actual underwriting result, bank connection, commercial commitment or regulatory approval is implied. Visual design is deliberately outside this review; this document specifies the evidence to demonstrate.

## Meeting objective

Ask the bank to sponsor a controlled pilot design and appoint credit, operations, technology and legal owners. The meeting should establish whether the bank wants to pursue direct customer lending, funding PayStar, or purchasing originated receivables. It must not ask the manager to approve unreviewed legal terms or treat the demonstration as a signed lending agreement.

Default presentation order: Model 4 → model comparison → Model 1 → Model 3 → Model 2 → shared risk controls → proposed pilot. Model 4 comes first because it makes the bank's direct decision and creditor role easy to inspect. This is a presentation choice, not a regulatory or commercial recommendation that it is universally best. All four prototypes remain required.

Persian opening:

> «این نمونه نشان می‌دهد پی‌استار چگونه معرفی مشتری توسط کلینیک، تشکیل پرونده، تصمیم اعتباری، پرداخت و پیگیری اقساط را قابل مشاهده و قابل کنترل می‌کند. چهار ساختار همکاری را جدا کرده‌ایم تا دقیقاً روشن باشد طلب متعلق به چه کسی است، چک به نام چه کسی صادر می‌شود و ریسک نکول با کدام طرف است. داده‌ها و نرخ‌های این نمایش فرضی‌اند؛ هدف جلسه توافق بر مسیر بررسی یک پایلوت کنترل‌شده است.»

## Fifteen-minute walkthrough

| Time | Demonstrate | Required evidence | What the manager learns |
|---|---|---|---|
| 0–2 min | Model 4 bank overview; select the current demo customer | Creditor=bank; principal 40m toman; first payment 11.2m; remaining principal 30m; next three payments each 11.2m | Bank owns the loan from inception and can inspect it |
| 2–5 min | Fresh application from the seeded `draft` customer: PayStar prepares → bank requests correction → customer resubmits → bank approves | Saved decision history, correct return stage, approved ceiling; attempting PayStar final approval fails | Bank retains final credit authority |
| 5–7 min | Customer agreement/checks → first payment → bank clinic payout | Bank named in agreement and checks; first receipt is verified; full clinic payout is 40m toman; service not allowed before payout | Clear funds and security ownership |
| 7–9 min | Customer pays next installment; switch to bank statement without resetting | Remaining principal moves from 30m to 20m; one receipt and one principal release; duplicate callback changes nothing | Servicing and reconciliation are operational, not decorative |
| 9–11 min | Compare the other models using separate databases | Model 1 independent PayStar bank repayment; Model 3 owner/cash transfer distinction and recourse; Model 2 clinic decision/no bank loan queue | The bank can choose its actual contractual role |
| 11–13 min | Separate resettable refund/default scenarios | 50% return components; capped clinic guarantee cannot be enforced without authority/evidence; unknown payment is pending | Controls also work when a transaction goes wrong |
| 13–15 min | Pilot proposal and decision checklist | Explicit caps, responsible parties, legal/bank release requirements, next deliverables | A concrete next step rather than an unsupported production promise |

For a five-minute meeting, show Model 4 current statement, one bank decision, the four-model table and the requested pilot decision. Leave the longer exception walkthrough available on request. Do not rush through all five user roles as an unstructured feature tour.

## Exact money narrative

All exact values below are IRR unless labeled toman. The 12% flat commission is the selected demonstration assumption; it is not an approved bank price, an APR claim or a profitability forecast.

| Item | IRR | Toman |
|---|---:|---:|
| Financed service principal | 400,000,000 | 40,000,000 |
| Total commission over four payments | 48,000,000 | 4,800,000 |
| Each of four payments | 112,000,000 | 11,200,000 |
| Principal after first payment | 300,000,000 | 30,000,000 |
| Commission still scheduled after first payment | 36,000,000 | 3,600,000 |
| Remaining total after first payment | 336,000,000 | 33,600,000 |
| Separate assessment fee | 500,000 | 50,000 |
| Model 3 bank purchase cash after 3% face discount | 325,920,000 | 32,592,000 |
| Model 3 difference between acquired face and purchase price | 10,080,000 | 1,008,000 |
| Model 4 separate PayStar service fee, 1% of 300m net originated principal | 3,000,000 | 300,000 |

Do not call commission or the Model 3 purchase discount “net bank profit.” Credit losses, funding, operating costs, taxes and timing remain relevant. In Model 1 the synthetic facility schedule uses zero financing charge; the demonstration must label it a test input, never a bank revenue forecast. Model 2 subscription revenue is per active clinic month, not per financed purchase.

Persian distinction:

> «مبلغ فروش خدمت ۴۰ میلیون تومان است. قسط اول شامل ۱۰ میلیون تومان اصل و ۱٫۲ میلیون تومان کمیسیون نمونه است. بانک در مدل چهارم کل مبلغ خدمت را به کلینیک می‌پردازد؛ اصل پرداخت‌شده توسط مشتری بخشی از منابع همان تسویه است. پس از قسط اول، مانده اصل مشتری ۳۰ میلیون تومان است، نه ۴۰ میلیون.»

## Questions the application must answer with records

| Manager's concern | Show this record or behavior |
|---|---|
| Who is my borrower or debtor? | M1 facility debtor PayStar; M3 seller obligation and acquired customer debt separate; M4 customer borrower; M2 no bank-credit obligation |
| Who owns the check? | Current beneficiary plus original issuance and transfer evidence; not just the loan's owner label |
| What is PayStar allowed to decide? | Role authority table plus a rejected unauthorized action |
| What happens when a customer defaults? | DPD, customer/check recovery evidence, legal handoff, recourse mode and guarantee cap |
| Does a clinic guarantee eliminate bank loss? | No; show residual covered principal, percentage, unused cap, enforceability evidence and recovery order |
| What if the bank accepts a sale but has not paid? | Model 3 effective legal owner and separate purchase-price receivable |
| Can PayStar collect twice? | Provider-reference uniqueness, allocation history, check/online lock and duplicate callback result |
| What happens after a service return? | Customer component adjustment, current-owner compensation, refund wallet liability/backing and bank acknowledgment |
| How do I know the balances are real within the demo? | Statement → installment → payment receipt → journal → reconciliation record, using the same IDs |
| Can I see another bank/clinic's files? | Denied access to seeded unrelated clinic; bank sees only authorized cases/mandates |

## Pilot proposal to put in front of the bank

These are design assumptions for negotiation, not commitments already made: five clinics, up to 500 approved customers, 10,000,000,000 IRR total principal-plus-reservation exposure, 400,000,000 IRR maximum customer limit, 3,000,000,000 IRR clinic exposure cap, and four installments. Full product scope and obligations remain in the model PRD. PayStar's refund bridge has a separately tracked 1,000,000,000 IRR synthetic budget; bank/clinic funds are not PayStar operating cash.

Requested next step: bank names one accountable sponsor and its credit/operations/technology/legal contacts; parties select the contractual model for detailed pilot design; exchange integration and agreement requirements; validate pricing, guarantees, refunds and servicing; conduct sandbox acceptance; only then sign a limited live-pilot release. The application decision screen can record `INTERESTED_IN_PILOT_DESIGN`, `REQUEST_REVISION` or `DECLINE`, plus reasons. It must not mark a model legally approved based on this meeting outcome. This is a local meeting note, not an email or a commitment sent to others.

Suggested success criteria are already specified in PRD: cohort-based repayment quality, positive measured contribution after actual costs/losses, controlled liquidity, timely settlement and resolved reconciliation exceptions. These cannot be demonstrated by pretending synthetic scenario records are a real pilot cohort.

## Rehearsal and fallback

1. Use the final acceptance checklist before the meeting. Start all four instances, verify correct model labels and fixed demo clock, and preload the guided routes.
2. Keep source fixtures immutable. Presenter-only reset creates a fresh run from the relevant database; reset one model never resets the others. There is no cross-model transfer of a demo customer's loan.
3. Perform a complete rehearsal with browser refresh halfway through a payment and role switch. Values must survive both actions.
4. Keep local copies of the same generated customer statement, creditor timeline and model comparison as fallback. Label them snapshots with generation time; do not continue a disconnected demonstration as if actions are processing live.
5. If a bank/provider mock deliberately times out, explain and show pending/reconciliation behavior. Never force success to hide an error.
6. Open actual discussions about bank terms separately from the synthetic settings. Never claim lending permission, connected Sayad, guaranteed zero losses, signed bank commitment or instant credit for everyone.
