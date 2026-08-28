const { chromium } = require('playwright');
(async()=>{const b=await chromium.launch();
  const page=await b.newPage({viewport:{width:1440,height:900}});
  const errs=[]; page.on('pageerror',e=>errs.push('pageerror: '+e.message.slice(0,110)));
  page.on('console',m=>{if(m.type()==='error')errs.push('console: '+m.text().slice(0,110));});
  await page.goto('http://127.0.0.1:8433/book.html',{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(4000);
  await page.evaluate(()=>{const c=document.getElementById('cookie-banner');if(c)c.remove();});
  await page.evaluate(()=>{const w=[...document.querySelectorAll('#serviceGroups .option-card-wrap')]
    .find(x=>x.textContent.includes('Hair Extensions (50g)')); if(w)w.click();});
  await page.waitForTimeout(2500);
  console.log('STASHED (last commit) staff cards:', await page.evaluate(()=>document.querySelectorAll('[data-staff-id]').length));
  console.log('  errors:',errs.length?errs.slice(0,3):'none');
  await b.close();})();
