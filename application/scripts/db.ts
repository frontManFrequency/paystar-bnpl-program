// CLI: migrate / seed / reset the Model 4 on-disk database when no server process holds it.
import path from 'node:path';
import { rmSync, existsSync } from 'node:fs';
const [cmd = 'migrate', model = '4'] = process.argv.slice(2);
const root = path.resolve(import.meta.dirname, '..');
process.env.MODEL_ID = model;
process.env.PAYSTAR_ROOT = root;
process.env.DATA_DIR ||= path.join(root, '.data.nosync', `model${model}`);
const DB = await import('../src/server/db');
const pid = DB.serverRunning();
if (pid) { console.error(`Model ${model} server (pid ${pid}) holds ${DB.DATA_DIR}. Stop it or use the in-app reset (/admin).`); process.exit(1); }
if (cmd === 'reset' && existsSync(DB.DATA_DIR)) rmSync(DB.DATA_DIR, { recursive: true, force: true });
const db = await DB.getDb(); // creates schema + seed on first open
if (cmd === 'seed' || cmd === 'migrate' || cmd === 'reset') {
  const r = await db.query<{ n: number }>('SELECT count(*)::int n FROM purchases');
  const c = await db.query<{ clock: Date }>('SELECT clock FROM app_demo_state');
  console.log(`${cmd}: model ${model} ready at ${DB.DATA_DIR} · purchases=${r.rows[0].n} · demo clock=${new Date(c.rows[0].clock).toISOString()}`);
}
await DB.closeDb();
