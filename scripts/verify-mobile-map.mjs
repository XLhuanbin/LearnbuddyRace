/**
 * 本脚本随仓库提交（scripts/ 下），可直接在有 Chrome 的机器上运行；设 CHROME_PATH 可指定浏览器。
 * 窄屏（≤900px）回归：这次改了 .mapstage 的基础规则，必须确认手机端画布与详情抽屉没被改坏 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);
const resolveChrome = () => {
  const hit = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!hit) {
    console.error('找不到 Chrome/Chromium 可执行文件：请设置 CHROME_PATH 环境变量后重试。');
    process.exit(2);
  }
  return hit;
};

const ROOT = resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const DIST = join(ROOT, 'dist');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent((req.url || '/').split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    const f = normalize(join(DIST, p));
    if (!f.startsWith(DIST)) return res.writeHead(403).end();
    const st = await stat(f);
    if (!st.isFile()) throw 0;
    res.writeHead(200, { 'Content-Type': MIME[extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(await readFile(f));
  } catch {
    res.writeHead(404).end('nf');
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;
const CH = resolveChrome();
const profile = join(ROOT, '.build', 'mobile-map-' + Date.now());
mkdirSync(profile, { recursive: true });
mkdirSync(join(ROOT, 'docs', 'desktop-ui'), { recursive: true });
const child = spawn(CH, ['--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars', '--remote-debugging-port=9499', '--user-data-dir=' + profile, url], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 80; i++) {
  try {
    await (await fetch('http://127.0.0.1:9499/json/version')).json();
    break;
  } catch {
    await sleep(300);
  }
}
const list = await (await fetch('http://127.0.0.1:9499/json/list')).json();
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m.result);
    pending.delete(m.id);
  }
});
const send = (method, params = {}) => {
  const i = ++id;
  ws.send(JSON.stringify({ id: i, method, params }));
  return new Promise((r) => pending.set(i, r));
};
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }))?.result?.value;
const click = (t) => ev(`(() => { const b=[...document.querySelectorAll('button')].find((x)=>(x.textContent||'').includes(${JSON.stringify(t)})); if(!b) return false; b.click(); return true; })()`);
const waitFor = async (e, ms) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await ev(e)) return true;
    await sleep(300);
  }
  return false;
};

let pass = 0;
let fail = 0;
const failures = [];
const check = (n, c, x = '') => {
  if (c) {
    pass++;
    console.log(`  ✓ ${n}${x ? ` 〔${x}〕` : ''}`);
  } else {
    fail++;
    failures.push(n + (x ? ` — ${x}` : ''));
    console.log(`  ✗ ${n}${x ? ` — ${x}` : ''}`);
  }
};

await send('Runtime.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await sleep(3400);
await click('体验视觉论文案例');
await waitFor(`document.querySelectorAll('.paper-title').length >= 5`, 45000);
await sleep(1000);
// 进入研究地图
await ev(`(() => { const b=document.querySelector('.mapbrand .dirbtn'); if(b) b.click(); return true; })()`);
await sleep(900);
await click('研究地图');
await sleep(1600);

const noOverflow = !(await ev(`document.documentElement.scrollWidth > window.innerWidth + 1`));
check('窄屏研究地图无整页横向溢出', noOverflow);
const size = await ev(`(() => { const m=document.querySelector('.mapwork').getBoundingClientRect(); return { h: Math.round(m.height), w: Math.round(m.width) }; })()`);
check('窄屏画布仍是自适应高度（不是桌面的 440–560 固定高）', size.h >= 400, `高度 ${size.h}px / 宽 ${size.w}px`);

// 选中一个节点 → 详情在视口内可见
await ev(`(() => {
  const g = document.querySelector('.mapstage .mnode');
  if (!g) return false;
  g.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  return true;
})()`);
await sleep(800);
const drawer = await ev(`(() => {
  const d = document.querySelector('.mapdetail');
  if (!d) return null;
  const r = d.getBoundingClientRect();
  return { open: d.classList.contains('open'), top: Math.round(r.top), bottom: Math.round(r.bottom), vh: window.innerHeight, visible: r.top < window.innerHeight && r.bottom > 0 };
})()`);
check('窄屏选中节点后详情出现在视口内（底部抽屉没被冲到屏幕外）', !!drawer && drawer.open && drawer.visible, JSON.stringify(drawer));
const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(join(ROOT, 'docs', 'desktop-ui', '窄屏回归-研究地图-390x844.png'), Buffer.from(shot.data, 'base64'));

console.log('');
console.log(`结果：通过 ${pass}，失败 ${fail}`);
if (failures.length) failures.forEach((f) => console.log('  - ' + f));
child.kill();
server.close();
process.exit(fail ? 1 : 0);
