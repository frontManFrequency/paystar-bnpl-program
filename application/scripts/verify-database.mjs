import {readFile,mkdtemp,rm} from 'node:fs/promises';import {existsSync} from 'node:fs';import {tmpdir} from 'node:os';import {resolve,join} from 'node:path';import {pathToFileURL} from 'node:url';import assert from 'node:assert/strict';
import {seedFixture} from '../implementation-kit/seed.mjs';
const root=resolve(import.meta.dirname,'..');
const docs=resolve(root,'..'); // product documents: schema.sql and model-*/prototype_data.json
const cached=join(root,'.cache','pglite-0.5.16');
const moduleRoot=process.env.PGLITE_PACKAGE_DIR||(existsSync(join(cached,'package.json'))?cached:undefined);
const {PGlite}=await import(moduleRoot?pathToFileURL(join(moduleRoot,'dist/index.js')).href:'@electric-sql/pglite');
const {btree_gist}=await import(moduleRoot?pathToFileURL(join(moduleRoot,'dist/contrib/btree_gist.js')).href:'@electric-sql/pglite/contrib/btree_gist');
const folders=['model-1-paystar-creditor','model-2-clinic-creditor','model-3-receivables-sale','model-4-bank-creditor'];
const report={engine:'PGlite 0.5.16 / embedded PostgreSQL; not a multi-process server test',models:[],assertions:0};
function ok(value,message){assert.ok(value,message);report.assertions++;}
async function reject(db,sql,args,code){await assert.rejects(()=>db.query(sql,args),e=>e.code===code);report.assertions++;}
for(const folder of folders){
 const fixture=JSON.parse(await readFile(join(docs,folder,'prototype_data.json'),'utf8'));const dataDir=await mkdtemp(join(tmpdir(),'paystar-db-audit-'));let db;
 try{
 db=await PGlite.create(dataDir,{extensions:{btree_gist}});await db.exec(await readFile(join(docs,'schema.sql'),'utf8'));
 const result=await seedFixture(db,fixture,{environment:'prototype'});
 ok((await db.query('SELECT count(*)::int n FROM purchases')).rows[0].n===fixture.rows.purchases.length,'purchase count');
 const balance=(await db.query('SELECT sum(debit_irr-credit_irr)::text balance FROM journal_lines')).rows[0];ok(balance.balance==='0','balanced aggregate ledger');
 const debt=(await db.query("SELECT sum(principal_irr-principal_paid_irr-principal_cancelled_irr)::text balance FROM installments WHERE status <> 'SUPERSEDED'")).rows[0];ok(debt.balance===fixture.expected.model_program_outstanding_irr,'seeded debt equals expected exposure');
 const badBooks=(await db.query('SELECT count(*)::int n FROM journal_lines l JOIN journals j ON l.journal_id=j.id JOIN ledger_accounts a ON l.account_id=a.id WHERE a.book_party_id<>j.book_party_id')).rows[0];ok(badBooks.n===0,'same book');
 const j=fixture.rows.journals[0],l=fixture.rows.journal_lines[0];
 await reject(db,"UPDATE journals SET source_type='TAMPER' WHERE id=$1",[j.id],'P0001');
 await reject(db,'DELETE FROM journal_lines WHERE id=$1',[l.id],'P0001');
 const c=fixture.rows.credit_lines[0];await reject(db,'UPDATE credit_lines SET limit_irr=-1 WHERE id=$1',[c.id],'23514');
 const owner=fixture.rows.ownership_history[0];
 await reject(db,"INSERT INTO ownership_history(model_id,purchase_id,owner_id,valid_from,valid_to,evidence_hash) VALUES($1,$2,$3,$4,$5,'DUPLICATE')",[fixture.model_id,owner.purchase_id,owner.owner_id,owner.valid_from,owner.valid_to],'23P01');
 const receipt=fixture.rows.payment_receipts[0];await reject(db,'UPDATE payment_receipts SET model_id=$2 WHERE id=$1',[receipt.id,fixture.model_id===4?1:fixture.model_id+1],'23503');
 const check=fixture.rows.checks.find(c=>c.status==='IN_CUSTODY');
 await reject(db,"INSERT INTO checks(model_id,checkout_id,expected_installment_sequence,purchase_id,installment_id,sayad_id_token,issuer_customer_id,beneficiary_id,custodian_id,amount_irr,maturity_date,status) SELECT model_id,checkout_id,expected_installment_sequence,purchase_id,installment_id,sayad_id_token||'-DUP',issuer_customer_id,beneficiary_id,custodian_id,amount_irr,maturity_date,status FROM checks WHERE id=$1",[check.id],'23505');
 const order=fixture.rows.orders[0];await db.query('UPDATE orders SET tenant_id=business_id WHERE id=$1',[order.id]);
 // Runtime role must have actual RLS applied; owner/migration connection alone proves nothing.
 await db.exec('CREATE ROLE paystar_runtime; GRANT USAGE ON SCHEMA public TO paystar_runtime; GRANT SELECT ON ALL TABLES IN SCHEMA public TO paystar_runtime;');
 await db.query('SET ROLE paystar_runtime');await db.query("SELECT set_config('app.model_id',$1,false)",[String(fixture.model_id)]);await db.query("SELECT set_config('app.tenant_ids','[]',false)");
 ok((await db.query('SELECT count(*)::int n FROM purchases')).rows[0].n===fixture.rows.purchases.length,'runtime sees authorized model shared rows');
 ok((await db.query('SELECT count(*)::int n FROM orders WHERE id=$1',[order.id])).rows[0].n===0,'empty tenant scope cannot read tenant-owned order');
 await db.query("SELECT set_config('app.tenant_ids',$1,false)",[JSON.stringify([order.business_id])]);
 ok((await db.query('SELECT count(*)::int n FROM orders WHERE id=$1',[order.id])).rows[0].n===1,'authorized clinic tenant can read its order');
 const otherClinic=fixture.rows.organizations.find(o=>o.party_type==='CLINIC'&&o.id!==order.business_id);
 await db.query("SELECT set_config('app.tenant_ids',$1,false)",[JSON.stringify([otherClinic.id])]);
 ok((await db.query('SELECT count(*)::int n FROM orders WHERE id=$1',[order.id])).rows[0].n===0,'unrelated clinic tenant cannot read order');
 await db.query("SELECT set_config('app.model_id',$1,false)",[String(fixture.model_id===4?1:fixture.model_id+1)]);
 ok((await db.query('SELECT count(*)::int n FROM purchases')).rows[0].n===0,'RLS hides other model');await db.query('RESET ROLE');
 await db.close();db=await PGlite.create(dataDir,{extensions:{btree_gist}});
 ok((await db.query('SELECT count(*)::int n FROM purchases')).rows[0].n===fixture.rows.purchases.length,'on-disk persistence after reopen');
 report.models.push({...result,status:'PASS'});
 } finally {if(db)await db.close();await rm(dataDir,{recursive:true,force:true});}
}
console.log(JSON.stringify(report,null,2));
