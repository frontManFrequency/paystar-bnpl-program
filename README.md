# Paystar BNPL Program

This repository contains the internal business and product documentation for Paystar's buy-now-pay-later (BNPL) program.

It is a documentation repository, not an application codebase. It does not contain production services, deployment configuration, customer data, credentials, or executable implementation.

## Documents

| Document | Purpose |
| --- | --- |
| [PRD.md](./PRD.md) | Product requirements, customer journeys, operating rules, functional expectations, and decisions still needed before implementation. |
| [business-model.md](./business-model.md) | Business Model Canvas, customer and partner value propositions, operating model, channels, costs, revenue hypotheses, risks, and open commercial decisions. |

The documents are currently maintained in Persian. They are the working source of truth for discovery and stakeholder alignment; implementation teams should not treat them as a substitute for approved technical, legal, financial, or contractual specifications.

## Program overview

Paystar is being considered as a four-installment credit-purchase experience for customers of participating merchants:

- A partner bank assesses the customer, approves the credit limit, and provides financing.
- Paystar is responsible for the customer experience, application workflow, purchase experience, installment management, operational coordination, and related support.
- Participating merchants accept BNPL purchases and support the agreed settlement and return processes.
- The customer is the formal borrower under the bank agreement, subject to confirmation of the final contractual structure.

The initial model assumes that customers can use an approved limit across participating merchants, with each purchase having its own four-installment schedule. Fees, settlement, penalties, return handling, eligibility rules, and money movement remain subject to business, legal, banking, and operational decisions recorded in the documents.

## How to read the documents

The documents distinguish between:

- **Confirmed** — agreed for the current product understanding, but not necessarily a signed bank, legal, or commercial commitment.
- **Proposed** — a working recommendation that requires stakeholder approval.
- **Open** — information or a decision is still missing.
- **Example** — illustrative only; it must not be interpreted as a current commercial promise or network claim.

Open items should be resolved before implementation commitments are made. In particular, confirm the financing and settlement structure, fees and installment calculations, eligibility and credit decisioning, penalties, returns and wallet withdrawals, merchant onboarding, legal and regulatory requirements, and success metrics.

## Intended use

Use this repository to:

- align product, business, operations, banking, merchant, and legal stakeholders;
- track the current product understanding and business hypotheses;
- identify decisions and dependencies before technical design;
- prepare later implementation specifications and delivery plans.

When a decision changes, update the relevant document and record the decision clearly. Keep sensitive credentials, personal information, customer records, bank information, and confidential contracts out of this repository unless an approved repository policy explicitly permits them.

## Status

This repository is an internal working space. The documents are not a public product promise, a final legal agreement, a credit policy, or an implementation-ready technical specification.
