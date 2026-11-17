/** Persian calendar reference using runtime ICU; no dependency or invented Gregorian-month arithmetic. */
const persian=new Intl.DateTimeFormat('en-US-u-ca-persian',{year:'numeric',month:'2-digit',day:'2-digit',timeZone:'UTC'});
const offsetFormat=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Tehran',timeZoneName:'longOffset'});
function dateOnly(input){if(!/^\d{4}-\d{2}-\d{2}$/.test(input))throw new Error('INVALID_DATE');const d=new Date(input+'T12:00:00Z');if(Number.isNaN(+d)||d.toISOString().slice(0,10)!==input)throw new Error('INVALID_DATE');return d;}
export function jalaliParts(iso){const p=Object.fromEntries(persian.formatToParts(dateOnly(iso)).map(x=>[x.type,x.value]));return {year:Number(p.year),month:Number(p.month),day:Number(p.day)};}
export function tehranDueInstant(iso){const guess=new Date(iso+'T23:59:59Z');dateOnly(iso);const text=offsetFormat.formatToParts(guess).find(x=>x.type==='timeZoneName').value;const m=/GMT([+-])(\d\d):(\d\d)/.exec(text);if(!m)throw new Error('UNSUPPORTED_ZONE_OFFSET');const offset=(+m[2]*60 + +m[3])*(m[1]==='+'?1:-1);return new Date(+guess-offset*60000).toISOString();}
export function monthlyDueDates(origin,count=4){
 if(!Number.isInteger(count)||count<1||count>24)throw new Error('INVALID_SCHEDULE_COUNT');
 const start=dateOnly(origin),anchor=jalaliParts(origin),byMonth=new Map();
 // Bounded scan avoids ad-hoc leap-year arithmetic and uses actual Persian ICU calendar.
 for(let i=0;i<count*32+35;i++){const iso=new Date(+start+i*86400000).toISOString().slice(0,10),j=jalaliParts(iso),key=j.year*12+j.month-1;if(!byMonth.has(key))byMonth.set(key,[]);byMonth.get(key).push({iso,...j});}
 return Array.from({length:count},(_,i)=>{const key=anchor.year*12+anchor.month-1+i,days=byMonth.get(key);if(!days?.length)throw new Error('CALENDAR_RANGE');const row=days.find(x=>x.day===anchor.day)||days.at(-1);return {sequence:i+1,gregorian:row.iso,jalali:`${row.year}-${String(row.month).padStart(2,'0')}-${String(row.day).padStart(2,'0')}`,dueAt:tehranDueInstant(row.iso)};});
}
export function nextBusinessDate(origin,{holidays=[],includeOrigin=false}={}){
 const start=dateOnly(origin),blocked=new Set(holidays);
 for(let i=includeOrigin?0:1;i<370;i++){const d=new Date(+start+i*86400000),iso=d.toISOString().slice(0,10);if(![4,5].includes(d.getUTCDay())&&!blocked.has(iso))return iso;}
 throw new Error('NO_BUSINESS_DATE');
}
