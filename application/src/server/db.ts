/**
 * Embedded PostgreSQL (PGlite 0.5.16) with an on-disk data directory per model.
 * One engine per process; every command runs inside a serialized transaction with
 * the non-owner runtime role and transaction-local model/tenant settings so RLS applies.
 */
import { PGlite, types } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
// @ts-ignore reference kit is plain ESM JavaScript
import { seedFixture } from '../../implementation-kit/seed.mjs';
import { applyMockNames } from './mockNames';

export const ROOT = process.env.PAYSTAR_ROOT || process.cwd();
// Product documents folder (one level above application/): schema.sql, prototype_content.json and each model folder's prototype_data.json.
export const DOCS_ROOT = process.env.PAYSTAR_DOCS || path.resolve(ROOT, '..');
export const MODEL_ID = Number(process.env.MODEL_ID || 4);
export const APP_ENV = process.env.APP_ENV || 'prototype';
export const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, '.data.nosync', `model${MODEL_ID}`);
const MODEL_FOLDERS: Record<number, string> = {
  1: 'model-1-paystar-creditor', 2: 'model-2-clinic-creditor', 3: 'model-3-receivables-sale', 4: 'model-4-bank-creditor',
};

export function fixturePath() { return path.join(DOCS_ROOT, MODEL_FOLDERS[MODEL_ID], 'prototype_data.json'); }
let fixtureCache: any;
export function fixture(): any {
  if (!fixtureCache) fixtureCache = JSON.parse(readFileSync(fixturePath(), 'utf8'));
  return fixtureCache;
}
let contentCache: any;
export function content(): any {
  if (!contentCache) contentCache = JSON.parse(readFileSync(path.join(DOCS_ROOT, 'prototype_content.json'), 'utf8'));
  return contentCache;
}

const parsers = {
  [types.INT8]: (v: string) => BigInt(v),
  [types.NUMERIC]: (v: string) => (/^-?\d+$/.test(v) ? BigInt(v) : v),
};
const serializers = {};

type Row = Record<string, any>;
export interface Q {
  q<T = Row>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T = any>(sql: string, params?: unknown[]): Promise<T>;
  exec(sql: string): Promise<void>;
}

const G = globalThis as any;
interface State { db?: PGlite; opening?: Promise<PGlite>; chain: Promise<unknown> }
const state: State = G.__paystarDb || (G.__paystarDb = { chain: Promise.resolve() });

async function open(): Promise<PGlite> {
  mkdirSync(DATA_DIR, { recursive: true });
  const db = await PGlite.create(DATA_DIR, { extensions: { btree_gist }, parsers, serializers } as any);
  const migrated = (await db.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public' AND table_name='app_demo_state'")).rows[0].n;
  if (!migrated) await migrateAndSeed(db);
  await runMigrations(db);
  return db;
}

export async function getDb(): Promise<PGlite> {
  if (state.db) return state.db;
  if (!state.opening) state.opening = open().then((db) => (state.db = db));
  return state.opening;
}

/** Serialize all transactions on this engine (one connection, no interleaving). */
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = state.chain.then(fn, fn);
  state.chain = run.catch(() => undefined);
  return run;
}

function wrap(t: { query: PGlite['query']; exec: PGlite['exec'] }): Q {
  return {
    async q(sql, params = []) { return (await t.query(sql, params as any[])).rows as any[]; },
    async one(sql, params = []) { return (await t.query(sql, params as any[])).rows[0] as any; },
    async exec(sql) { await t.exec(sql); },
  };
}

export interface TxScope { tenantIds?: string[] }
/** Run fn in one serialized transaction as runtime role with model/tenant RLS context. */
export async function tx<T>(scope: TxScope | null, fn: (t: Q) => Promise<T>): Promise<T> {
  const db = await getDb();
  return exclusive(() => db.transaction(async (t) => {
    await t.query("SELECT set_config('app.model_id',$1,true)", [String(MODEL_ID)]);
    if (scope) await t.query("SELECT set_config('app.tenant_ids',$1,true)", [JSON.stringify(scope.tenantIds ?? [])]);
    // System context (verified webhooks, scheduled jobs) operates across all clinic tenants of this model.
    else await t.query("SELECT set_config('app.tenant_ids',(SELECT COALESCE(jsonb_agg(id)::text,'[]') FROM organizations WHERE party_type='CLINIC' AND model_id=$1),true)", [MODEL_ID]);
    await t.exec('SET LOCAL ROLE paystar_runtime');
    return fn(wrap(t));
  }));
}

/** Owner-context transaction for migrations/seed/reset only. */
async function ownerTx<T>(db: PGlite, fn: (t: Q) => Promise<T>): Promise<T> {
  return db.transaction(async (t) => fn(wrap(t)));
}

export async function migrateAndSeed(db: PGlite) {
  if (APP_ENV !== 'prototype') throw new Error('PROTOTYPE_SEED_ONLY');
  await db.exec(readFileSync(path.join(DOCS_ROOT, 'schema.sql'), 'utf8'));
  await db.exec(readFileSync(path.join(ROOT, 'db', 'app.sql'), 'utf8'));
  await seed(db);
}

/** Idempotent schema migrations (db/migrations/*.sql, in name order), applied on every startup in owner context. */
async function runMigrations(db: PGlite) {
  const dir = path.join(ROOT, 'db', 'migrations');
  if (!existsSync(dir)) return;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) await db.exec(readFileSync(path.join(dir, f), 'utf8'));
}

async function seed(db: PGlite) {
  const f = fixture();
  if (f.model_id !== MODEL_ID) throw new Error('FIXTURE_MODEL_MISMATCH');
  await seedFixture(db, f, { environment: APP_ENV });
  await ownerTx(db, async (t) => {
    // Tenant-owned rows carry the clinic tenant so RLS isolates clinics (defense in depth).
    await t.exec("UPDATE orders SET tenant_id=business_id; UPDATE referrals SET tenant_id=business_id; UPDATE catalog_items SET tenant_id=business_id;");
    await applyMockNames(t);
    await t.q('INSERT INTO app_demo_state(id,model_id,clock,fixture_version) VALUES (1,$1,$2,$3)', [MODEL_ID, f.clock, f.schema_version]);
  });
}

const TRUNCATE_ORDER_SQL = "SELECT string_agg(format('%I',table_name),',') AS names FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'";

/** Restore this model's fixture and clock. TRUNCATE bypasses row triggers, so history is replaced wholesale only here. */
export async function resetDemo(): Promise<void> {
  if (APP_ENV !== 'prototype') throw new Error('PROTOTYPE_RESET_ONLY');
  const db = await getDb();
  await exclusive(async () => {
    const names = (await db.query<{ names: string }>(TRUNCATE_ORDER_SQL)).rows[0].names;
    await db.exec(`TRUNCATE ${names} CASCADE`);
    await seed(db);
  });
}

export async function closeDb() {
  if (state.db) { await state.db.close(); state.db = undefined; state.opening = undefined; }
}

/** Marks the data dir as in use by a server process so CLI reset refuses to touch it. */
export function writePidFile() {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(path.join(DATA_DIR, 'server.pid'), String(process.pid));
}
export function serverRunning(): number | null {
  const p = path.join(DATA_DIR, 'server.pid');
  if (!existsSync(p)) return null;
  const pid = Number(readFileSync(p, 'utf8'));
  try { process.kill(pid, 0); return pid; } catch { return null; }
}
