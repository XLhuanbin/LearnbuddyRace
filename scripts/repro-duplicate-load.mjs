/**
 * 复现「重复加载」问题：观察导航计数、论文卡片数、实验记录数、语料标签与 IndexedDB 内容。
 * 只读取与点击界面按钮，不修改任何数据文件。
 *
 * 用法：node scripts/repro-duplicate-load.mjs [--url https://...]
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const args = process.argv.slice(2);
const argOf = (n) => {
  const i = args.indexOf('--' + n);
  return i >= 0 && args[i + 1] ? args[i + 1] : undefined;
};
const target = argOf('url');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.pdf': 'application/pdf', '.svg': 'image/svg+xml' };

async function startStatic() {
  const server = createServer(async (req, res) => {
    try {
      let p = decodeURIComponent((req.url || '/').split('?')[0]);
      if (p.endsWith('/')) p += 'index.html';
      const f = normalize(join(DIST, p));
      if (!f.startsWith(DIST)) return res.writeHead(403).end();
      const st = await stat(f);
      if (!st.isFile()) throw 0;
      res.writeHead(200, { 'Content-Type': MIME[extname(f)] || 'application/octet-stream' });
      res.end(await readFile(f));
    } catch {
      res.writeHead(404).end('nf');
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, url: `http://127.0.0.1:${server.address().port}/` };
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id && this.pending.has(m.id)) {
        this.pending.get(m.id)(m.result);
        this.pending.delete(m.id);
      }
    });
  }
  send(method, params = {}) {
    const i = ++this.id;
    this.ws.send(JSON.stringify({ id: i, method, params }));
    return new Promise((r) => {
      this.pending.set(i, r);
      setTimeout(() => this.pending.has(i) && (this.pending.delete(i), r({})), 40000);
    });
  }
  async ev(x) {
    const r = await this.send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
    return r?.result?.value;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find((p) => existsSync(p));

let staticSrv;
let url = target;
if (!url) {
  staticSrv = await startStatic();
  url = staticSrv.url;
}

const profile = join(ROOT, '.build', `chrome-repro-${Date.now()}`);
await mkdir(profile, { recursive: true });
const child = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=9922', '--user-data-dir=' + profile, '--window-size=1440,960', url], { stdio: 'ignore' });
let ver;
for (let i = 0; i < 60; i++) {
  try {
    ver = await (await fetch('http://127.0.0.1:9922/json/version')).json();
    break;
  } catch {
    await sleep(300);
  }
}
const list = await (await fetch('http://127.0.0.1:9922/json/list')).json();
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
const cdp = new Cdp(ws);
await cdp.send('Runtime.enable');
await sleep(3200);

const snapshot = () =>
  cdp.ev(`
(() => {
  const navText = ((document.querySelector('.side') || {}).innerText || '').replace(/\\n/g, ' | ');
  const navNums = [...document.querySelectorAll('.nav')].map((b) => b.textContent.replace(/\\s+/g, ' ').trim());
  const cards = document.querySelectorAll('.paper-title').length;
  const rows = document.querySelectorAll('.exprow').length;
  const corpusLabel = ((document.querySelector('.corpus-card .title') || {}).innerText || '').replace(/\\n/g, ' ').trim();
  const mainHead = ((document.querySelector('.main-inner') || {}).innerText || '').slice(0, 120).replace(/\\n/g, ' | ');
  return { navText, navNums, cards, rows, corpusLabel, mainHead };
})()`);

const idbCount = () =>
  cdp.ev(`
new Promise((resolve) => {
  const req = indexedDB.open('researchpilot');
  req.onsuccess = () => {
    const db = req.result;
    const names = [...db.objectStoreNames];
    const out = { stores: names };
    let left = names.length;
    if (!left) return resolve(out);
    names.forEach((n) => {
      const tx = db.transaction(n, 'readonly');
      const c = tx.objectStore(n).count();
      c.onsuccess = () => {
        out[n] = c.result;
        if (--left === 0) resolve(out);
      };
      c.onerror = () => {
        if (--left === 0) resolve(out);
      };
    });
  };
  req.onerror = () => resolve({ error: 'open failed' });
})`);

const clickBtn = (name) =>
  cdp.ev(`(() => { const b=[...document.querySelectorAll('button')].find((x)=>x.textContent.includes(${JSON.stringify(name)})); if(!b) return false; b.click(); return true; })()`);
const clickNav = (name) =>
  cdp.ev(`(() => { const b=[...document.querySelectorAll('button.nav')].find((x)=>x.textContent.includes(${JSON.stringify(name)})); if(!b) return false; b.click(); return true; })()`);

console.log(`目标：${url}`);
console.log('');
console.log('=== 步骤 1：打开首页（全新浏览器会话）===');
console.log(JSON.stringify(await snapshot(), null, 2));
console.log('IndexedDB:', JSON.stringify(await idbCount()));

console.log('');
console.log('=== 步骤 2：加载演示案例（第 1 次）===');
await clickBtn('开始分析视觉论文');
await sleep(3500);
console.log(JSON.stringify(await snapshot(), null, 2));
console.log('IndexedDB:', JSON.stringify(await idbCount()));

console.log('');
console.log('=== 步骤 3：进入实验比较 ===');
await clickNav('实验比较');
await sleep(1500);
console.log(JSON.stringify(await snapshot(), null, 2));

console.log('');
console.log('=== 步骤 4：在实验比较页点击「加载演示案例」（第 2 次）===');
const clicked = await clickBtn('加载演示案例');
console.log('是否找到并点击按钮:', clicked);
await sleep(3500);
console.log(JSON.stringify(await snapshot(), null, 2));
console.log('IndexedDB:', JSON.stringify(await idbCount()));

console.log('');
console.log('=== 步骤 5：再点一次（第 3 次）===');
console.log('是否找到并点击按钮:', await clickBtn('加载演示案例'));
await sleep(3000);
const s5 = await snapshot();
console.log(JSON.stringify(s5, null, 2));
console.log('IndexedDB:', JSON.stringify(await idbCount()));

console.log('');
console.log('=== 步骤 6：刷新后 ===');
await cdp.send('Page.reload', {});
await sleep(4000);
console.log(JSON.stringify(await snapshot(), null, 2));
console.log('IndexedDB:', JSON.stringify(await idbCount()));

ws.close();
child.kill();
staticSrv?.server.close();
