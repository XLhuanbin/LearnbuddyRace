/**
 * 前端审查：对每个页面截屏（桌面 + 窄屏），用于真实画面审查。
 * 不调用模型、不改数据。
 *
 * 用法：node scripts/ui-audit.mjs [--url https://...] [--out docs/ui-audit]
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
const OUT = resolve(ROOT, argOf('out') ?? 'docs/ui-audit');
await mkdir(OUT, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.pdf': 'application/pdf',
  '.svg': 'image/svg+xml',
};

async function startStatic() {
  const server = createServer(async (req, res) => {
    try {
      let p = decodeURIComponent((req.url || '/').split('?')[0]);
      if (p.endsWith('/')) p += 'index.html';
      const file = normalize(join(DIST, p));
      if (!file.startsWith(DIST)) return res.writeHead(403).end('forbidden');
      const st = await stat(file);
      if (!st.isFile()) throw new Error('nf');
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
      res.end(await readFile(file));
    } catch {
      res.writeHead(404).end('not found');
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
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve: rs } = this.pending.get(m.id);
        this.pending.delete(m.id);
        rs(m.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve) => {
      this.pending.set(id, { resolve });
      setTimeout(() => this.pending.has(id) && (this.pending.delete(id), resolve({})), 60000);
    });
  }
  async evaluate(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    return r?.result?.value;
  }
  async shot(file, width, height) {
    await this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
    await new Promise((r) => setTimeout(r, 700));
    const r = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    if (r?.data) await writeFile(file, Buffer.from(r.data, 'base64'));
    await this.send('Emulation.clearDeviceMetricsOverride');
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
].find((p) => existsSync(p));

let staticSrv;
let url = target;
if (!url) {
  staticSrv = await startStatic();
  url = staticSrv.url;
}
console.log(`目标：${url}`);

const profile = join(ROOT, '.build', `chrome-audit-${Date.now()}`);
await mkdir(profile, { recursive: true });
const child = spawn(
  chrome,
  ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=9777', `--user-data-dir=${profile}`, '--window-size=1440,900', 'about:blank'],
  { stdio: 'ignore' },
);
let ver;
for (let i = 0; i < 60; i++) {
  try {
    ver = await (await fetch('http://127.0.0.1:9777/json/version')).json();
    break;
  } catch {
    await sleep(300);
  }
}
if (!ver) {
  console.error('Chrome 未就绪');
  process.exit(2);
}
const list = await (await fetch('http://127.0.0.1:9777/json/list')).json();
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
const cdp = new Cdp(ws);
await cdp.send('Runtime.enable');
await cdp.send('Page.enable');

await cdp.send('Page.navigate', { url });
await sleep(3500);

await cdp.shot(join(OUT, '01-宣传首页-desktop.png'), 1440, 900);
await cdp.shot(join(OUT, '01-宣传首页-narrow.png'), 390, 844);

// 体验视觉论文案例 → 研究地图（默认是方法地图）
await cdp.evaluate(`(() => { const b=[...document.querySelectorAll('button')].find((x)=>x.textContent.includes('体验视觉论文案例')); if (b) b.click(); })()`);
await sleep(5200);
await cdp.shot(join(OUT, '02-方法地图-desktop.png'), 1440, 1000);
await cdp.shot(join(OUT, '02-方法地图-narrow.png'), 390, 844);

// 点击一个节点：高亮 + 详情
await cdp.evaluate(`(() => { const t=[...document.querySelectorAll('svg text')].find((x)=>/ResNet/.test(x.textContent)); if (t) t.closest('g').dispatchEvent(new MouseEvent('click', { bubbles: true })); })()`);
await sleep(900);
await cdp.shot(join(OUT, '03-点击节点-详情-desktop.png'), 1440, 1000);

// 点击一条连线：联系解释
await cdp.evaluate(`(() => { const paths=[...document.querySelectorAll('svg path')].filter((x)=>x.getAttribute('marker-end')); if (paths.length) paths[0].closest('g').dispatchEvent(new MouseEvent('click', { bubbles: true })); })()`);
await sleep(900);
await cdp.shot(join(OUT, '04-点击连线-联系-desktop.png'), 1440, 1000);

// 打开待核查关系
await cdp.evaluate(`(() => { const cb=[...document.querySelectorAll('input[type=checkbox]')].find((x)=>x.closest('label') && /显示待核查/.test(x.closest('label').textContent)); if (cb) cb.click(); })()`);
await sleep(800);
await cdp.shot(join(OUT, '05-显示待核查关系-desktop.png'), 1440, 1000);

// 联系与区别
await cdp.evaluate(`(() => { const b=[...document.querySelectorAll('button')].find((x)=>x.textContent.includes('联系与区别')); if (b) b.click(); })()`);
await sleep(1200);
await cdp.shot(join(OUT, '06-联系与区别-desktop.png'), 1440, 1200);

// 从哪里开始
await cdp.evaluate(`(() => { const b=[...document.querySelectorAll('button')].find((x)=>x.textContent.includes('从哪里开始')); if (b) b.click(); })()`);
await sleep(1000);
await cdp.evaluate(`(() => { const b=[...document.querySelectorAll('button')].find((x)=>x.textContent.includes('给我阅读路线')); if (b) b.click(); })()`);
await sleep(1600);
await cdp.shot(join(OUT, '07-阅读路线-desktop.png'), 1440, 1200);
await cdp.shot(join(OUT, '07-阅读路线-narrow.png'), 390, 844);

const report = ['# 页面截图索引（宣传首页 + 结果工作台）', '', `- 时间：${new Date().toLocaleString('zh-CN')}`, `- 目标：${url}`, ''];
for (const [file, title] of [
  ['01-宣传首页-desktop.png', '宣传首页（桌面）'],
  ['01-宣传首页-narrow.png', '宣传首页（390×844）'],
  ['02-选择案例-desktop.png', '选择案例（桌面）'],
  ['02-选择案例-narrow.png', '选择案例（390×844）'],
  ['03-比较结果-desktop.png', '比较结果（桌面）'],
  ['03-比较结果-narrow.png', '比较结果（390×844）'],
  ['04-结果页-展开依据-desktop.png', '比较结果：展开三类依据'],
  ['05-方法演进-desktop.png', '方法演进（桌面）'],
  ['05-方法演进-narrow.png', '方法演进（390×844）'],
  ['06-演进节点详情-desktop.png', '方法演进：节点详情'],
  ['07-更多-开发者入口-desktop.png', '更多（开发者入口）'],
]) {
  report.push(`## ${title}`, '', `![${title}](${file})`, '');
}
await writeFile(join(OUT, 'INDEX.md'), report.join('\n'), 'utf8');

console.log(`已写出 ${join(OUT, 'INDEX.md')}`);

ws.close();
child.kill();
staticSrv?.server.close();
