/** Reusable seed importer. Pass a pg-compatible dedicated client or PGlite instance.
 * Only seed a fresh prototype database. Never silently upsert financial history.
 */
export async function seedFixture(db, fixture, {environment}={}) {
  if(environment!=='prototype'||fixture.simulation_only!==true)throw new Error('PROTOTYPE_SEED_ONLY');
  const meta=(await db.query("SELECT table_name,column_name,data_type FROM information_schema.columns WHERE table_schema='public' ORDER BY ordinal_position")).rows;
  const tables=new Map();for(const c of meta){if(!tables.has(c.table_name))tables.set(c.table_name,new Map());tables.get(c.table_name).set(c.column_name,c.data_type);}
  const identifier=x=>{if(!/^[a-z_][a-z0-9_]*$/.test(x))throw new Error('INVALID_IDENTIFIER');return '"'+x+'"';};
  for(const [table,rows] of Object.entries(fixture.rows)){
    if(!tables.has(table))throw new Error('UNKNOWN_FIXTURE_TABLE:'+table);
    const count=await db.query(`SELECT count(*)::int AS n FROM ${identifier(table)}`);
    if(count.rows[0].n)throw new Error('SEED_REQUIRES_EMPTY_DATABASE:'+table);
    for(const row of rows)if(row.model_id!==fixture.model_id)throw new Error('CROSS_MODEL_SEED');
  }
  await db.query('BEGIN');let inserted=0;
  try{
    await db.query('SET CONSTRAINTS ALL DEFERRED');
    for(const [table,rows] of Object.entries(fixture.rows))for(const original of rows){
      const row={...original};if(table==='journals')row.status='DRAFT';
      const keys=Object.keys(row),values=keys.map(k=>{
        if(!tables.get(table).has(k))throw new Error(`UNKNOWN_FIXTURE_COLUMN:${table}.${k}`);
        return ['json','jsonb'].includes(tables.get(table).get(k))&&row[k]!==null?JSON.stringify(row[k]):row[k];
      });
      try {await db.query(`INSERT INTO ${identifier(table)} (${keys.map(identifier).join(',')}) VALUES (${keys.map((_,i)=>'$'+(i+1)).join(',')})`,values);}
      catch(e){throw new Error(`SEED_ROW_FAILED:${table}:${row.id}: ${e.message}`,{cause:e});}
      inserted++;
    }
    for(const j of fixture.rows.journals)if(j.status==='POSTED')await db.query("UPDATE journals SET status='POSTED',posted_at=$2 WHERE id=$1",[j.id,j.posted_at]);
    await db.query('COMMIT');return {model:fixture.model_id,inserted};
  }catch(e){await db.query('ROLLBACK');throw e;}
}
