# PayStar BNPL — Model 4 prototype (bank as creditor)

A local, offline Persian RTL web app for Model 4: the bank makes the final credit decision, is the creditor and check beneficiary from the start, pays the clinic and receives the installments. All data, providers, signatures, checks and payments are simulated.

## Folder layout
- `application/` (this folder): the app, its tests and scripts, `CLAUDE.md` and the build documents. Run every command from here.
- The folder above holds the product documents: `PRD.md`, `business-model.md`, `BANK_DEMO_PLAYBOOK.md`, the four `model-*` folders, `schema.sql`, `openapi.json` and `prototype_content.json`. The app reads the schema, the sample data and the Persian content from there (override with `PAYSTAR_DOCS=/path`).

## Requirements
- Node.js 22+ (tested on 24.8). No PostgreSQL server, Docker or internet is needed at runtime.
- Data is stored in embedded PostgreSQL (PGlite 0.5.16) on disk at `.data/model4/`. It persists across restarts.

## First-time setup (needs internet once, for `npm install`)
```sh
npm install
npm run build
npm run start:model4        # http://localhost:3104
```
On first start the database is created from `schema.sql` and seeded from `model-4-bank-creditor/prototype_data.json`.
For development with hot reload, use `npm run dev:model4` instead.

## Commands
| Command | What it does |
|---|---|
| `npm run start:model4` / `npm run dev:model4` | Run Model 4 on port 3104 |
| `npm run db:migrate` / `npm run db:seed` | Create and seed the on-disk DB (server must be stopped) |
| `npm run demo:reset` | Delete and reseed the Model 4 DB (server must be stopped). While running, use **/admin → بازنشانی** with phrase `RESET MODEL 4` |
| `npm test` | Reference money/calendar tests + Model 4 integration tests (temporary DB) |
| `npm run test:e2e` | HTTP end-to-end checks against a running server (resets the demo DB) |
| `node scripts/walkthrough.mjs` | Full fresh-customer journey over HTTP (leaves data modified; reset afterwards) |

## Using it
Open http://localhost:3104 and choose a demo role. The home page lists every seeded user and the 15-minute meeting route.
- Demo OTP: `123456`. Demo card: `DEMO-CARD-1234`. Upload any small PNG/JPG/PDF.
- Mock outcomes (success / unknown / failed / duplicate callback) are selected in each payment form.
- **/admin → ساعت نمایشی** advances the demo clock. This runs reservation expiry, fee refunds, delinquency, reminders and the DPD30 bank handoff.

## Layout
- `src/server/`: domain commands, ledger, webhooks, jobs and authorization. It reuses `implementation-kit/domain.mjs` and `calendar.mjs` unchanged.
- `src/app/`: each role workspace (`/account`, `/business`, `/ops`, `/bank`, `/admin`) is an app with a sidebar (`src/lib/nav.ts`, `src/components/AppShell.tsx`). It has a dashboard, one page per sidebar section, and nested detail pages such as `/bank/loans/[id]`, `/ops/purchases/[id]`, `/account/purchases/[id]` and `/account/checkout/[id]`. Each workspace's sections come from its `view.tsx`. Public pages are `/showcase`, `/b/[slug]` and `/r/[token]`; the API is under `/api/v1/*`.
- `db/app.sql`: demo-controller tables and the non-owner `paystar_runtime` role. Row-level security (RLS) applies to every request.

## Display names
People, clinics, the bank and services use realistic but fictional Persian names, applied at seed time from `src/server/mockNames.ts`. The source fixture is not modified. To change a name, edit that file and reset the demo. Identifiers such as `DEMO-NID-*`, `DEMO-CARD-*` and `DEMO-SAYAD-*` intentionally keep the `DEMO` prefix: the simulated providers accept only those values, so a real identity can never be processed.

## Design system
The UI uses the PayStar UI kit in `paystar-ui-kit/`. `src/app/layout.tsx` imports `paystar-ui.css` and its local IRANYekanX fonts, so the UI still works offline. All markup uses the kit's `ps-` classes. `src/app/globals.css` holds only a few layout helpers, and icons are inline SVG in the kit's stroke style (`src/components/Icon.tsx`). Updating `paystar-ui-kit/paystar-ui.css` restyles the app after a rebuild. Dark mode follows the OS setting.

## Browser tests (local Chrome, no download)
- `npm run test:browser`: clicks through the credit workflow in real Chrome (register → request → PayStar → bank → sign → credit available).
- `npm run screens`: saves screenshots of each workspace to `/tmp/shots`.

## iCloud Drive
This folder sits inside iCloud-synced Documents. The database and build output live in `.data.nosync/` and `.next.nosync/`, which iCloud does not sync, so it cannot create "… 2" conflict copies inside them. The old `.data/` folder is unused and can be deleted.
