/** PayStar executable reference domain. Pure functions; no DB, auth, or external effects.
 * Money inputs/outputs are BigInt internally. Use toWire before JSON serialization.
 */
export function money(value) {
  if (typeof value === 'bigint' && value >= 0n) return value;
  if (typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value)) return BigInt(value);
  throw new Error('INVALID_MONEY');
}
export function roundHalfUp(numerator, denominator) {
  numerator=money(numerator); denominator=money(denominator);
  if (!denominator) throw new Error('INVALID_DENOMINATOR');
  return (2n*numerator+denominator)/(2n*denominator);
}
export function splitFour(total) {
  total=money(total); const base=total/4n;
  return [base,base,base,total-base*3n];
}
export function quote(principal, commissionBps=1200n) {
  const p=money(principal), b=money(commissionBps);
  if (!p || b>10000n) throw new Error('INVALID_QUOTE');
  const commission=roundHalfUp(p*b,10000n), ps=splitFour(p),cs=splitFour(commission);
  return {principal:p,commission,total:p+commission,installments:ps.map((x,i)=>({sequence:i+1,principal:x,commission:cs[i],total:x+cs[i]}))};
}
export function availableCredit({limit,outstanding,reserved=0n,held=false,expired=false}) {
  const raw=money(limit)-money(outstanding)-money(reserved);
  const available=raw<0n?0n:raw;
  return {available,spendable:held||expired?0n:available};
}
export function allocatePayment(amount, installments) {
  let remaining=money(amount); const allocations=[];
  // Caller must pass the active schedule and lock the installment rows.
  const order=[...installments].sort((a,b)=>a.dueAt.localeCompare(b.dueAt)||a.sequence-b.sequence);
  let principalReleased=0n;
  for (const i of order) for (const component of ['principal','commission','penalty']) {
    const owed=money(i[component]??0n),paid=owed<remaining?owed:remaining;
    if (paid) allocations.push({installmentId:i.id,component,amount:paid});
    if (component==='principal') principalReleased+=paid;
    remaining-=paid;
  }
  return {allocations,principalReleased,unapplied:remaining};
}
export function largestRemainder(total,weights) {
  total=money(total);weights=weights.map(money);const denominator=weights.reduce((a,b)=>a+b,0n);
  if (!denominator) { if(total)throw new Error('INVALID_WEIGHTS');return weights.map(()=>0n); }
  const out=weights.map(w=>total*w/denominator);
  const order=weights.map((w,i)=>({i,remainder:total*w%denominator})).sort((a,b)=>a.remainder===b.remainder?a.i-b.i:a.remainder>b.remainder?-1:1);
  const residue=Number(total-out.reduce((a,b)=>a+b,0n));
  for(let i=0;i<residue;i++)out[order[i].i]++;
  return out;
}
export function refundPlan({principal,commission,cumulativeReturn,installments}) {
  const p=money(principal),c=money(commission),r=money(cumulativeReturn);
  if (!p||r>p||installments.length!==4)throw new Error('INVALID_RETURN');
  const targetCommission=roundHalfUp(c*r,p);
  const totals={principal:r,commission:targetCommission};const changes=[];
  let walletDelta=0n,principalReleased=0n;
  for(const component of ['principal','commission']) {
    const originals=installments.map(i=>money(i[component].original));
    if(originals.reduce((a,b)=>a+b,0n)!==(component==='principal'?p:c))throw new Error('SCHEDULE_MISMATCH');
    const targets=largestRemainder(totals[component],originals);
    installments.forEach((i,index)=>{
      const x=i[component],o=money(x.original),paid=money(x.paid),cancelled=money(x.cancelled??0n),refunded=money(x.refunded??0n);
      if(paid+cancelled>o||refunded>paid)throw new Error('INVALID_COMPONENT_BALANCE');
      const capacity=o-paid,targetCancel=targets[index]<capacity?targets[index]:capacity,targetRefund=targets[index]-targetCancel;
      const cancelDelta=targetCancel-cancelled,refundDelta=targetRefund-refunded;
      if(cancelDelta<0n||refundDelta<0n)throw new Error('RETURN_TARGET_REGRESSION');
      changes.push({installmentId:i.id,component,cancelDelta,refundDelta,targetCancel,targetRefund});
      walletDelta+=refundDelta;if(component==='principal')principalReleased+=cancelDelta;
    });
  }
  return {changes,walletDelta,principalReleased,cumulativePrincipal:r,cumulativeCommission:targetCommission};
}
export function guaranteeClaim({residualPrincipal,coverageBps,cap,used=0n,reserved=0n,availableSecurity,dpd,recoveryDays,legalApproved}) {
  if(dpd<60||recoveryDays<15||!legalApproved)return 0n;
  const remaining=money(cap)-money(used)-money(reserved);
  if(remaining<0n)throw new Error('GUARANTEE_CAP_CORRUPT');
  const coverage=money(residualPrincipal)*money(coverageBps)/10000n;
  if(money(coverageBps)>10000n)throw new Error('INVALID_COVERAGE');
  return [coverage,remaining,money(availableSecurity)].reduce((a,b)=>a<b?a:b);
}
export function salePrice({principal,commission,discountBps=300n,fee=0n,holdback=0n}) {
  const face=money(principal)+money(commission),discount=roundHalfUp(face*money(discountBps),10000n);
  const price=face-discount-money(fee)-money(holdback);
  if(price<=0n)throw new Error('INVALID_SALE_PRICE');
  return {face,discount,price};
}
export function assertRecourse(mode,claimType) {
  if(!['WITH_RECOURSE','WITHOUT_RECOURSE'].includes(mode))throw new Error('INVALID_RECOURSE_MODE');
  if(!['CUSTOMER_DEFAULT','WARRANTY_BREACH','SERVICE_RETURN'].includes(claimType))throw new Error('INVALID_CLAIM');
  if(mode==='WITHOUT_RECOURSE'&&claimType==='CUSTOMER_DEFAULT')throw new Error('RECOURSE_NOT_PERMITTED');
  // Passing this guard is not claim approval: legal evidence and checker still required.
}
export function finalDecisionRole(model) {
  if (![1,2,3,4].includes(model))throw new Error('INVALID_MODEL');
  return model===2?'business-admin':model===4?'bank':'paystar-admin';
}
export function assertChecker(maker,checker) {
  if(!maker||!checker||maker===checker)throw new Error('MAKER_CHECKER_REQUIRED');
}
export function affordability({income,externalObligations=0n,existingByMonth={},proposedByMonth={}}) {
  const cap=money(income)*30n/100n,external=money(externalObligations);
  const months=[...new Set([...Object.keys(existingByMonth),...Object.keys(proposedByMonth)])].sort();
  const breaches=months.filter(m=>external+money(existingByMonth[m]??0n)+money(proposedByMonth[m]??0n)>cap);
  return {allowed:breaches.length===0,monthlyCap:cap,breaches};
}
export function toWire(value) {
  return JSON.parse(JSON.stringify(value,(_key,v)=>typeof v==='bigint'?v.toString():v));
}
