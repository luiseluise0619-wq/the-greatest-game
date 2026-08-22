import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const PORT = 8700;
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT: String(PORT), HNH_PREP: '40', HNH_TELEMETRY: '0' }, stdio: ['ignore','ignore','inherit'] });
await new Promise(r => setTimeout(r, 1200));
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
const p = await ctx.newPage();
p.on('pageerror', e => console.log('PAGEERROR', e.message));
p.on('console', m => { if (m.type()==='error' && !m.text().includes('favicon')) console.log('CONSOLE', m.text()); });
await p.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => document.getElementById('roomCode').textContent !== '····', null, { timeout: 25000 });

await p.click('#openSettings');
console.log('opened:', !(await p.locator('#settings').getAttribute('class')).includes('hidden'));
await p.screenshot({ path: `${process.argv[2]}/ui-settings.png` });

// Drag the sensitivity and FOV sliders to their maximum.
await p.evaluate(() => {
  const set = (id, v) => { const el = document.getElementById(id); el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); };
  set('setSens', 0.006);
  set('setFov', 100);
  set('setVol', 0.2);
  document.getElementById('setInvert').click();
  document.getElementById('setFps').click();
});
await p.waitForTimeout(200);
console.log('applied:', await p.evaluate(() => ({
  sens: window.game.sensitivity,
  fov: window.game.camera.fov,
  vol: window.game.audio.volume,
  invert: window.game.settings.get('invertY'),
  fpsShown: !document.getElementById('fpsMeter').classList.contains('hidden'),
  stored: JSON.parse(localStorage.getItem('hnh.settings.v1')),
})));

// Reload: the same context keeps localStorage, so the values must come back.
await p.reload({ waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => window.game && window.game.camera, null, { timeout: 25000 });
await p.waitForTimeout(400);
console.log('after reload:', await p.evaluate(() => ({
  sens: window.game.sensitivity,
  fov: window.game.camera.fov,
  vol: window.game.audio.volume,
  slider: document.getElementById('setSens').value,
  fovLabel: document.getElementById('setFovVal').textContent,
})));

// Reset puts everything back and re-syncs the controls.
await p.click('#openSettings');
await p.click('#setReset');
await p.waitForTimeout(200);
console.log('after reset:', await p.evaluate(() => ({
  sens: window.game.sensitivity, fov: window.game.camera.fov,
  slider: document.getElementById('setSens').value,
  label: document.getElementById('setSensVal').textContent,
})));
await b.close(); srv.kill();
