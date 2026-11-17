#!/usr/bin/env python3
"""Validate PayStar documentation, API references and synthetic financial rowsets.
Uses only Python standard library. Does not execute PostgreSQL or test an app.
"""
from pathlib import Path
import json, re, sys, datetime
from collections import defaultdict
ROOT=Path(__file__).resolve().parent.parent  # product documents folder (this script lives in application/)
APP=Path(__file__).resolve().parent
errors=[]; checks=0

def check(condition,message):
    global checks
    checks+=1
    if not condition:errors.append(message)

sql=(ROOT/'schema.sql').read_text()
tables={}
for name,body in re.findall(r'CREATE TABLE (\w+) \(\n(.*?)\n\);',sql,re.S):
    fields={}
    for line in body.splitlines():
        match=re.match(r'\s{2}([a-z_][a-z_0-9]*) (uuid|smallint|integer|bigint|text|char\(\d+\)|timestamptz|date|boolean|jsonb)(.*)',line)
        if match:fields[match[1]]=(match[2],match[3])
    tables[name]=fields
refs=re.findall(r'ALTER TABLE (\w+) ADD FOREIGN KEY \((\w+),model_id\) REFERENCES (\w+)\(id,model_id\)',sql)
check(len(tables)>=60,'Schema table coverage below expected baseline')
api=json.loads((ROOT/'openapi.json').read_text());ops=[]
def walk(obj):
    if isinstance(obj,dict):
        if '$ref' in obj:
            loc=obj['$ref'];check(loc.startswith('#/'),'Nonlocal API schema reference '+loc)
            if loc.startswith('#/'):
                target=api
                try:
                    for part in loc[2:].split('/'):target=target[part]
                except (KeyError,TypeError):check(False,'Broken API reference '+loc)
        for v in obj.values():walk(v)
    elif isinstance(obj,list):
        for v in obj:walk(v)
walk(api)
for path,methods in api['paths'].items():
    for method,op in methods.items():
        ops.append(op['operationId'])
        declared={p['name'] for p in op.get('parameters',[]) if p.get('in')=='path'}
        check(declared==set(re.findall(r'{(\w+)}',path)),'API path parameters '+path)
        check('x-roles' in op,'Missing role contract '+path)
check(len(ops)==len(set(ops)),'Duplicate operation IDs')
roles=['super-admin','paystar-admin','business-admin','customer','bank']
summary=[]
for folder in sorted(ROOT.glob('model-*')):
    if not folder.is_dir():continue
    for file in ['PRD.md','TAD.md','database_structure.md','Userflow.md','prototype_data.json']:
        check((folder/file).exists(),f'Missing {folder.name}/{file}')
    flow=(folder/'Userflow.md').read_text()
    for role in roles:check(f'## {role}\n' in flow,f'Missing dedicated role {folder.name}/{role}')
    for file in folder.glob('*.md'):
        txt=file.read_text()
        check(not re.search(r'\b(TODO|TBD|FIXME)\b',txt),f'Unresolved placeholder {file}')
        for link in re.findall(r'\]\(([^)]+)\)',txt):
            if '://' in link or link.startswith('#'):continue
            target=(file.parent/link.split('#')[0]).resolve()
            check(target.exists(),f'Broken local link {file.name}: {link}')
    data=json.loads((folder/'prototype_data.json').read_text());model=data['model_id'];rows=data['rows']
    check(data['simulation_only'] is True,f'M{model} not marked simulation')
    check(set(rows)==set(tables),f'M{model} missing/extra rowset tables')
    by_table={t:{r['id']:r for r in rs} for t,rs in rows.items()}
    allids=[]
    for tab,rs in rows.items():
        for r in rs:
            allids.append(r['id']);check(r['model_id']==model,f'M{model} crossed model row')
            for col,value in r.items():
                check(col in tables[tab],f'M{model} unknown field {tab}.{col}')
                if col.endswith('_irr') and value is not None:check(isinstance(value,str) and re.fullmatch(r'[0-9]+',value) is not None,f'M{model} invalid money {tab}.{col}')
            for col,(typ,rest) in tables[tab].items():
                if 'NOT NULL' in rest and 'DEFAULT' not in rest:check(col in r and r[col] is not None,f'M{model} missing required {tab}.{col}')
    check(len(allids)==len(set(allids)),f'M{model} duplicate fixture UUID')
    for src,col,dst in refs:
        for r in rows[src]:
            if r.get(col) is not None:check(r[col] in by_table[dst],f'M{model} broken FK {src}.{col} -> {dst}: {r[col]}')
    check(set(u['role'] for u in data['demo_users'])==set(roles),f'M{model} demo roles incomplete')
    for r in rows['policies']+rows['refunds']+rows['approvals']+rows['guarantee_claims']:
        if r.get('approved_by'):check(r['approved_by']!=r.get('proposed_by',r.get('requested_by')),f'M{model} self-approved action')
    for journal in rows['journals']:
        lines=[x for x in rows['journal_lines'] if x['journal_id']==journal['id']]
        check(len(lines)>=2,f'M{model} journal without lines')
        check(sum(int(x['debit_irr']) for x in lines)==sum(int(x['credit_irr']) for x in lines),f'M{model} unbalanced journal {journal["event_key"]}')
        for line in lines:
            check((int(line['debit_irr'])==0)!=(int(line['credit_irr'])==0),f'M{model} invalid journal direction')
            check(by_table['ledger_accounts'][line['account_id']]['book_party_id']==journal['book_party_id'],f'M{model} wrong journal book')
    total=0
    for p in rows['purchases']:
        ins=[i for i in rows['installments'] if i['purchase_id']==p['id']]
        check(len(ins)==4 and sorted(i['sequence'] for i in ins)==[1,2,3,4],f'M{model} not four installments')
        check(sum(int(i['principal_irr']) for i in ins)==int(p['principal_irr']),f'M{model} principal schedule total')
        check(sum(int(i['commission_irr']) for i in ins)==int(p['commission_irr']),f'M{model} commission schedule total')
        bal=sum(int(i['principal_irr'])-int(i['principal_paid_irr'])-int(i['principal_cancelled_irr']) for i in ins)
        total+=bal
        line=by_table['credit_lines'][p['credit_line_id']]
        check(bal==int(line['outstanding_principal_irr']),f'M{model} credit line projection mismatch')
        for i in ins:
            for c in ['principal','commission']:
                check(int(i[c+'_paid_irr'])+int(i[c+'_cancelled_irr'])<=int(i[c+'_irr']),f'M{model} overallocated {c}')
                check(int(i[c+'_refunded_irr'])<=int(i[c+'_paid_irr']),f'M{model} refund exceeds paid')
        owners=[h for h in rows['ownership_history'] if h['purchase_id']==p['id']]
        current=[h for h in owners if h.get('valid_to') is None]
        check(len(current)==1 and current[0]['owner_id']==p['current_owner_id'],f'M{model} current owner mismatch')
        ordered=sorted(owners,key=lambda h:h['valid_from'])
        for a,b in zip(ordered,ordered[1:]):check(a.get('valid_to') is not None and a['valid_to']<=b['valid_from'],f'M{model} overlapping owners')
        checks_p=[c for c in rows['checks'] if c['purchase_id']==p['id']]
        check(len(checks_p)==3,f'M{model} missing checks')
        for c in checks_p:check(c['beneficiary_id']==p['current_owner_id'],f'M{model} wrong check holder')
        party=by_table['organizations'][p['current_owner_id']]['party_type']
        check(party==('CLINIC' if model==2 else 'BANK' if model==4 else 'PAYSTAR' if model==1 else party),f'M{model} wrong creditor')
        app=by_table['applications'][line['application_id']]
        contract=by_table['contracts'][p['contract_id']]
        check(contract['creditor_id']==p['originator_id'],f'M{model} initial contract creditor mismatch')
        if model!=2:
            settle=next(s for s in rows['settlements'] if s['purchase_id']==p['id'] and s['kind']=='CLINIC_PAYOUT')
            check(int(settle['amount_irr'])==int(p['principal_irr']),f'M{model} clinic not paid full P')
            check(settle['confirmed_at']<=p['service_evidence']['started_at'],f'M{model} service before clinic funds')
        if p['status']=='RETURNED':check(bal==0,f'M{model} returned debt not cancelled')
    check(total==int(data['expected']['model_program_outstanding_irr']),f'M{model} exposure total mismatch')
    for receipt in rows['payment_receipts']:
        allocations=[a for a in rows['payment_allocations'] if a['receipt_id']==receipt['id']]
        check(sum(int(a['amount_irr']) for a in allocations)<=int(receipt['amount_irr']),f'M{model} excess receipt allocations')
    for wallet in rows['wallets']:
        check(0<=int(wallet['held_irr'])<=int(wallet['funded_irr'])<=int(wallet['liability_irr']),f'M{model} invalid wallet projection')
    if model==1:
        check(len(rows['facilities'])==1 and len(rows['facility_dues'])==5,'M1 facility missing')
        check(sum(int(d['principal_irr']) for d in rows['facility_dues'])==int(rows['facilities'][0]['principal_outstanding_irr']),'M1 lender schedule mismatch')
    if model==2:check(not rows['facilities'] and not rows['sale_lots'] and not rows['bank_instructions'],'M2 invented bank loan flow')
    if model==3:
        check({l['recourse_mode'] for l in rows['sale_lots']}=={'WITH_RECOURSE','WITHOUT_RECOURSE'},'M3 recourse alternatives missing')
        for lot in rows['sale_lots']:
            price=int(lot['face_principal_irr'])+int(lot['face_commission_irr'])-sum(int(lot[k]) for k in ['discount_irr','fee_irr','holdback_irr'])
            check(price==int(lot['price_irr'])==325920000,'M3 sale price mismatch')
            p=by_table['purchases'][lot['purchase_id']]
            check(p['service_evidence']['started_at']<=lot['ownership_effective_at'],'M3 sold before service start')
    if model==4:check(not rows['sale_lots'] and len(rows['bank_instructions'])==3,'M4 direct-credit boundary')
    summary.append({'model':model,'tables':len(rows),'rows':sum(map(len,rows.values())),'users':len(data['demo_users']),'mock_scenarios':len(data['mock_scenarios'])})
# Exercise independent exact money/reference return calculations.
P=400000000;C=(P*1200+5000)//10000
check(C==48000000,'Reference commission')
check((P+C)//4==112000000,'Reference installment')
check((P+C)*3//4==336000000,'Reference early payoff')
for returned in [1,10000000,200000000,399999999,400000000]:
    commission=(C*returned+P//2)//P
    def largest_remainder(total,weights):
        den=sum(weights);out=[total*w//den for w in weights]
        order=sorted(range(len(weights)),key=lambda i:(-(total*weights[i]%den),i))
        for i in order[:total-sum(out)]:out[i]+=1
        return out
    pc=largest_remainder(returned,[100000000]*4);cc=largest_remainder(commission,[12000000]*4)
    check(sum(pc)==returned and sum(cc)==commission,'Return rounding conservation')
    if returned==200000000:check(pc[0]+cc[0]==56000000,'50% paid refund example')
# Interleaved repayment and cumulative return must never cancel/refund twice.
original=100000000
prior_cancelled=50000000
prior_refunded=0
paid_after_first_return=20000000
new_target=60000000
target_cancel=min(new_target,original-paid_after_first_return)
target_refund=new_target-target_cancel
check(target_cancel-prior_cancelled==10000000,'Interleaved return cancellation delta')
check(target_refund-prior_refunded==0,'Interleaved return refund delta')
check(original-paid_after_first_return-target_cancel==20000000,'Interleaved return remaining debt')
# Final return after those events refunds the actual payment and cancels only residual debt.
final_cancel=min(original,original-paid_after_first_return)
final_refund=original-final_cancel
check(final_cancel-target_cancel==20000000 and final_refund==20000000,'Interleaved final return conservation')
# The example API and source content are complete local resources.
content=json.loads((ROOT/'prototype_content.json').read_text())
check(content['simulation_only'] is True,'Prototype copy must be marked simulation')
check({c['purpose'] for c in content['consents']}=={'IDENTITY','ACCOUNT','CREDIT_REPORT','DATA_PROCESSING','MARKETING'},'Consent copy coverage')
for doc in ['CLAUDE.md','PROTOTYPE_READINESS.md']:
    for link in re.findall(r'\]\(([^)]+)\)',(APP/doc).read_text()):
        if '://' not in link and not link.startswith('#'):
            check((APP/link.split('#')[0]).exists(),f'Broken handoff link {doc}: {link}')
print(json.dumps({'status':'PASS' if not errors else 'FAIL','checks':checks,'api_operations':len(ops),'models':summary,'errors':errors},ensure_ascii=False,indent=2))
sys.exit(bool(errors))
