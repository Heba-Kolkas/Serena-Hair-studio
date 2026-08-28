import fs from 'fs';
// Run from the repo root:  node scripts/slot-rules.test.mjs
//
// Kani's day is the most rule-heavy part of the system and the easiest to
// break without noticing, because a wrong slot list still looks like a
// perfectly normal booking page. These cases are the owner's own worked
// examples, kept executable so a change that breaks one says so.
const src = fs.readFileSync(new URL('../js/booking.js', import.meta.url),'utf8');
function grab(name){
  const i = src.indexOf(`function ${name}(`);
  if(i<0) throw new Error('missing '+name);
  let d=0, j=src.indexOf('{',i);
  for(let k=j;k<src.length;k++){ if(src[k]==='{')d++; else if(src[k]==='}'){d--; if(!d) return src.slice(i,k+1);} }
}
const code = [grab('freeIntervals'),grab('windowSlots'),grab('withholdLoneCallIn')].join('\n');
const mod = await import('data:text/javascript,'+encodeURIComponent(code+'\nexport{freeIntervals,windowSlots,withholdLoneCallIn};'));
const {windowSlots,withholdLoneCallIn}=mod;
const T=(h,m=0)=>h*60+m, F=t=>`${String(Math.floor(t/60)).padStart(2,'0')}:${String(t%60).padStart(2,'0')}`;

// Reproduce the two-window build from computeSlotsFor.
function offer({open,close,splitAt,duration,ranges=[],colourStarts=[],hasBookings=false,dayOpen}){
  const pack=new Set(); if(splitAt!=null)pack.add(splitAt); colourStarts.forEach(c=>pack.add(c));
  let w = splitAt!=null
    ? windowSlots(open,splitAt,duration,dayOpen,ranges,pack).concat(windowSlots(splitAt,close,duration,dayOpen,ranges,pack))
    : windowSlots(open,close,duration,dayOpen,ranges,pack);
  w = withholdLoneCallIn(w,{hasBookings,duration,dayOpen,dayClose:close,boundaries:pack});
  return w.map(F).join(', ');
}
let pass=0,fail=0;
const check=(label,got,want)=>{ const ok=got===want; ok?pass++:fail++;
  console.log(`${ok?'  ok':'FAIL'}  ${label}\n        got  ${got||'(none)'}${ok?'':`\n        want ${want}`}`); };

console.log('\n--- MON/WED/FRI, nothing booked (open 11:00, short from 12:00, close 17:30) ---');
const mwf={open:T(12),close:T(17,30),splitAt:T(15),dayOpen:T(11)};
check('haircut 60',  offer({...mwf,duration:60}),  '12:00, 13:00, 14:00, 15:00, 16:00');
check('colour 90',   offer({...mwf,duration:90}),  '12:00, 13:30, 15:00');
check('colour+addon 120 packs onto the colour', offer({...mwf,duration:120}), '13:00, 15:00');

console.log('\n--- MON/WED/FRI, 11:00 colour booked -> window 15:00-17:30 ---');
const mwfC={open:T(15),close:T(17,30),splitAt:null,colourStarts:[T(11)],dayOpen:T(11)};
check('haircut 60',  offer({...mwfC,duration:60}),  '15:00, 16:00');
check('colour 90',   offer({...mwfC,duration:90}),  '15:00');
check('colour+addon 120', offer({...mwfC,duration:120}), '15:00');

console.log('\n--- TUE/THU, 15:00 balayage booked, 11:00 free (short work opens 11:00) ---');
const tt={open:T(11),close:T(18),splitAt:null,colourStarts:[T(15)],dayOpen:T(11),ranges:[[T(15),T(19)]]};
check('haircut 60, empty -> 11:00 withheld',
      offer({...tt,duration:60}), '12:00, 13:00, 14:00');
check('haircut 60, after the 14:00 is taken -> 11:00 opens',
      offer({...tt,duration:60,hasBookings:true,ranges:[[T(14),T(15)],[T(15),T(19)]]}),
      '11:00, 12:00, 13:00');

console.log('\n--- TUE/THU, 15:00 balayage released, day empty (11:00-18:00) ---');
check('haircut 60 -> no lone 17:00',
      offer({open:T(11),close:T(18),splitAt:T(15),duration:60,dayOpen:T(11)}),
      '12:00, 13:00, 14:00, 15:00, 16:00');

console.log(`\n${pass} passed, ${fail} failed`);
