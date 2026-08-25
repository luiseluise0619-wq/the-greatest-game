import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox','--use-gl=swiftshader'] });
const p = await b.newPage({ viewport:{width:1280,height:800} });
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto('http://localhost:8098/', { waitUntil:'networkidle' });
await p.evaluate(() => localStorage.setItem('hnh.settings.v1', JSON.stringify({ lang:'ko' })));
await p.reload({ waitUntil:'networkidle' });
await p.evaluate(() => [...document.querySelectorAll('button')].find(x=>/DEAL|역할/.test(x.textContent))?.click());
await p.waitForFunction(() => window.game?.inGame, null, {timeout:90000});
await p.waitForFunction(() => window.game?.hud?.seenKills?.size > 0, null, {timeout:240000}).catch(()=>console.log('(no witnessed kill in time)'));
await p.waitForTimeout(800);
const r = await p.evaluate(() => {
  window.game.hud.toggleScoreboard(true);
  return {
    head: [...document.querySelectorAll('#sbTable thead th')].map(t=>t.textContent),
    rows: [...document.querySelectorAll('#sbTable tbody tr')].map(t=>[...t.children].map(c=>c.textContent.trim())),
    seen: [...(window.game.hud.seenKills||[])].length,
  };
});
console.log(JSON.stringify(r,null,1));
console.log('errors:', errs.length?errs:'none');
await p.screenshot({ path:'/tmp/sb.png' });
await b.close();
