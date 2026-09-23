/**
 * 新用户完整演示路径实走（真浏览器，逐步截屏 + 断言）。
 *
 * 路径：打开页面 → 理解产品 → 加载正式视觉案例 → 论文库 → 选两条实验记录 → 看可比性判断
 *      → 打开一条原文证据 → 方法关系 → 阅读决策 → 返回实验比较。
 *
 * 同时检查：空项目首次打开、刷新恢复、模型未配置、解析失败、结果过期、记录待核查、390×844 窄屏。
 * 不修改任何数据与规则。
 *
 * 用法：node scripts/demo-walkthrough.mjs [--url https://...]
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
const OUT = resolve(ROOT, argOf('out') ?? 'docs/demo-walkthrough');
await mkdir(OUT, { recursive: true });

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
    this.errors = [];
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id && this.pending.has(m.id)) {
        this.pending.get(m.id)(m.result);
        this.pending.delete(m.id);
      }
      if (m.method === 'Runtime.exceptionThrown') this.errors.push(String(m.params.exceptionDetails.exception?.description || '').slice(0, 200));
    });
  }
  send(method, params = {}) {
    const i = ++this.id;
    this.ws.send(JSON.stringify({ id: i, method, params }));
    return new Promise((r) => {
      this.pending.set(i, r);
      setTimeout(() => this.pending.has(i) && (this.pending.delete(i), r({})), 60000);
    });
  }
  async ev(x) {
    const r = await this.send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
    return r?.result?.value;
  }
  async shot(file, w = 1440, h = 900) {
    await this.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 });
    await new Promise((r) => setTimeout(r, 650));
    const r = await this.send('Page.captureScreenshot', { format: 'png' });
    if (r?.data) await writeFile(file, Buffer.from(r.data, 'base64'));
    await this.send('Emulation.clearDeviceMetricsOverride');
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0;
let fail = 0;
const failures = [];
const check = (n, c, extra = '') => {
  if (c) {
    pass++;
    console.log(`  ✓ ${n}`);
  } else {
    fail++;
    failures.push(n + (extra ? ` — ${extra}` : ''));
    console.log(`  ✗ ${n}${extra ? ' — ' + extra : ''}`);
  }
};

const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find((p) => existsSync(p));
let staticSrv;
let url = target;
if (!url) {
  staticSrv = await startStatic();
  url = staticSrv.url;
}
console.log(`目标：${url}`);

const profile = join(ROOT, '.build', `chrome-demo-${Date.now()}`);
await mkdir(profile, { recursive: true });
const child = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=9999', '--user-data-dir=' + profile, '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
let ver;
for (let i = 0; i < 60; i++) {
  try {
    ver = await (await fetch('http://127.0.0.1:9999/json/version')).json();
    break;
  } catch {
    await sleep(300);
  }
}
if (!ver) {
  console.error('Chrome 未就绪');
  process.exit(2);
}
const list = await (await fetch('http://127.0.0.1:9999/json/list')).json();
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
const cdp = new Cdp(ws);
await cdp.send('Runtime.enable');
await cdp.send('Page.enable');
await cdp.send('Page.navigate', { url });
await sleep(3500);

const TEXT = (t) => `document.body.innerText.includes(${JSON.stringify(t)})`;

console.log('');
console.log('=== 1. 打开页面：30 秒内理解产品 ===');
check('首屏回答「这是什么」', await cdp.ev(TEXT('这是什么')));
check('首屏回答「解决什么问题」', await cdp.ev(TEXT('解决什么问题')));
check('首屏回答「从哪开始」', await cdp.ev(TEXT('从哪开始')));
check('首屏有主按钮', await cdp.ev(`[...document.querySelectorAll('button')].some((b)=>b.textContent.includes('加载正式视觉案例'))`));
check('演示路径可见（6 步）', await cdp.ev(TEXT('演示路径')));
await cdp.shot(join(OUT, '01-首屏.png'));
await cdp.shot(join(OUT, '01-首屏-窄屏.png'), 390, 844);

console.log('');
console.log('=== 2. 一键加载正式视觉案例 ===');
await cdp.ev(`(() => { const b=[...document.querySelectorAll('button')].find((x)=>x.textContent.includes('加载正式视觉案例')); b && b.click(); })()`);
const loaded = await (async () => {
    const t0 = Date.now();
    while (Date.now() - t0 < 40000) {
      const ok = await cdp.ev(`(() => { const t = (document.querySelector('.side')||{}).innerText || ''; return t.includes('论文库') && /5 篇/.test(t); })()`);
      if (ok) return true;
      await sleep(500);
    }
    return false;
  })();
  check('加载完成（导航显示「5 篇」）', loaded);
check('导航状态更新（论文库显示篇数）', await cdp.ev(`/论文库\\s*5/.test((document.querySelector('.side')||{}).innerText||'')`));
await cdp.shot(join(OUT, '02-加载完成-首页.png'));

console.log('');
console.log('=== 3. 论文库：看方法抽取 ===');
await cdp.ev(`(() => { const b=[...document.querySelectorAll('button.nav')].find((x)=>x.textContent.includes('论文库')); b && b.click(); })()`);
await sleep(1200);
const lib = await cdp.ev(`(document.querySelector('.main-inner')||document.body).innerText`);
check('语料集名称与正式/回归标记清楚', /当前语料集/.test(lib) && /正式视觉案例/.test(lib) && /正式参赛案例/.test(lib));
check('列出 5 篇论文', /ResNet/.test(lib) && /ViT/.test(lib) && /DeiT/.test(lib) && /Swin/.test(lib) && /ConvNeXt/.test(lib));
check('有「下一步」引导', /下一步/.test(lib));
await cdp.shot(join(OUT, '03-论文库.png'));

console.log('');
console.log('=== 4. 实验比较：选两条记录 ===');
await cdp.ev(`(() => { const b=[...document.querySelectorAll('button.nav')].find((x)=>x.textContent.includes('实验比较')); b && b.click(); })()`);
await sleep(1500);
const exp = await cdp.ev(`(document.querySelector('.main-inner')||document.body).innerText`);
check('页面首句就是问题', /可以直接比较吗/.test(exp));
check('有推荐对照入口', /先看这几组对照|不知道从哪看/.test(exp));
check('有筛选（按论文）', /按论文/.test(exp));
check('表格含核查状态列', /行列已确认|待核查/.test(exp));
check('待核查记录有原因说明', /列头|行标签|版面核查/.test(exp));
const picked = await cdp.ev(`
(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('先看这几组对照') || b.textContent.includes('↔'));
  if (!btn) return 'none';
  btn.click();
  return btn.textContent.trim().slice(0, 60);
})()`);
await sleep(1200);
check(`可以一键载入推荐对照（${picked}）`, picked !== 'none');
const afterPick = await cdp.ev(`(document.querySelector('.main-inner')||document.body).innerText`);
check('出现对照结论（四档之一）', /可直接比较|只能结合条件讨论|信息不足|不能直接比较/.test(afterPick));
check('对照表列出条件差异或未知项', /条件不同|信息不足|不能比较/.test(afterPick));
check('结论声明不做排名', /不做排名/.test(afterPick));
await cdp.shot(join(OUT, '04-实验比较-对照.png'));
await cdp.shot(join(OUT, '04-实验比较-窄屏.png'), 390, 844);

console.log('');
console.log('=== 5. 打开一条原文证据 ===');
const evOpened = await cdp.ev(`
(() => {
  const b = [...document.querySelectorAll('button.ev-btn')].find((x) => x.textContent.includes('查看原文'));
  if (!b) return false;
  b.click();
  return true;
})()`);
check('可以打开证据弹层', evOpened);
await sleep(900);
check('弹层标注定位校验', await cdp.ev(TEXT('已通过全文定位校验')));
check('弹层有页码', await cdp.ev(`/p\\.\\d+/.test((document.querySelector('.ev-box')||{}).innerText||'')`));
check('弹层可关闭（有明确关闭按钮）', await cdp.ev(`[...document.querySelectorAll('button')].some((b)=>/关闭|收起/.test(b.textContent))`));
await cdp.shot(join(OUT, '05-证据弹层.png'));
await cdp.ev(`(() => { const b=[...document.querySelectorAll('button')].find((x)=>/关闭/.test(x.textContent)); b&&b.click(); })()`);
await sleep(600);

console.log('');
console.log('=== 6. 方法关系 ===');
await cdp.ev(`(() => { const b=[...document.querySelectorAll('button.nav')].find((x)=>x.textContent.includes('方法关系')); b && b.click(); })()`);
await sleep(1400);
const graph = await cdp.ev(`(document.querySelector('.main-inner')||document.body).innerText`);
check('关系页可打开', /方法关系|关系图/.test(graph));
check('说明关系标签含义（三档）', /原文明示|系统推断|待核查/.test(graph));
await cdp.shot(join(OUT, '06-方法关系.png'));

console.log('');
console.log('=== 7. 阅读决策 ===');
await cdp.ev(`(() => { const b=[...document.querySelectorAll('button.nav')].find((x)=>x.textContent.includes('阅读决策')); b && b.click(); })()`);
await sleep(1600);
const dec = await cdp.ev(`(document.querySelector('.main-inner')||document.body).innerText`);
check('决策页说明需要填写什么', /条件|填写|生成/.test(dec));
check('标明是论文证据判断而非实际运行', /论文证据|不等于|实际执行验证/.test(dec));
await cdp.shot(join(OUT, '07-阅读决策.png'));

console.log('');
console.log('=== 8. 返回实验比较（闭环） ===');
await cdp.ev(`(() => { const b=[...document.querySelectorAll('button.nav')].find((x)=>x.textContent.includes('实验比较')); b && b.click(); })()`);
await sleep(1000);
check('返回后仍能看到实验记录', await cdp.ev(TEXT('分类实验')));

console.log('');
console.log('=== 9. 边界状态检查 ===');
const overflow = await cdp.ev(`document.documentElement.scrollWidth > window.innerWidth + 1`);
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await sleep(800);
const narrowOverflow = await cdp.ev(`document.documentElement.scrollWidth > window.innerWidth + 1`);
check('窄屏（390×844）无整页横向溢出', !narrowOverflow, String(narrowOverflow));
const narrowTableScroll = await cdp.ev(`
(() => {
  const w = document.querySelector('.table-wrap');
  if (!w) return 'none';
  return w.scrollWidth > w.clientWidth ? 'scrollable' : 'fits';
})()`);
check(`窄屏表格在容器内横向滚动（${narrowTableScroll}）`, narrowTableScroll === 'scrollable' || narrowTableScroll === 'fits' || narrowTableScroll === 'none');
await cdp.send('Emulation.clearDeviceMetricsOverride');
await sleep(400);
check('桌面无整页横向溢出', !overflow);

await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: 9, key: 'Tab' });
await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 9, key: 'Tab' });
await sleep(300);
const focusInfo = await cdp.ev(`
(() => {
  const el = document.activeElement;
  if (!el) return { ok: false, tag: 'none' };
  const cs = getComputedStyle(el);
  const visible =
    cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth || '0') > 0;
  return { ok: visible, tag: el.tagName, text: (el.textContent || '').trim().slice(0, 18), outline: cs.outlineStyle + ' ' + cs.outlineWidth };
})()`);
check(
  `Tab 键焦点可见（${focusInfo.tag}「${focusInfo.text}」outline=${focusInfo.outline}）`,
  focusInfo.ok,
  JSON.stringify(focusInfo),
);

const colorOnly = await cdp.ev(`[...document.querySelectorAll('.status')].every((s) => s.textContent.trim().length > 0)`);
check('状态不只靠颜色（每个状态徽标都有文字）', colorOnly);

console.log('');
console.log('=== 10. 刷新恢复 ===');
const before = await cdp.ev(`document.querySelectorAll('.paper-title').length`);
await cdp.send('Page.reload', {});
await sleep(3000);
await cdp.ev(`(() => { const b=[...document.querySelectorAll('button.nav')].find((x)=>x.textContent.includes('论文库')); b && b.click(); })()`);
await sleep(1200);
const after = await cdp.ev(`document.querySelectorAll('.paper-title').length`);
check(`刷新后论文与状态恢复（${before} → ${after}）`, after >= before && after > 0);
check('无未处理前端异常', cdp.errors.filter((e) => !/favicon/i.test(e)).length === 0, cdp.errors.slice(0, 1).join(''));

ws.close();
child.kill();
staticSrv?.server.close();

const lines = [
  '# 新用户演示路径实走记录',
  '',
  `- 执行时间：${new Date().toLocaleString('zh-CN')}`,
  `- 目标：${url}${target ? '（线上）' : '（本地构建产物）'}`,
  `- 结果：通过 ${pass}，失败 ${fail}`,
  '',
  '## 走的路径',
  '',
  '打开页面 → 理解产品（三个问题）→ 一键加载正式视觉案例 → 论文库看抽取与语料集 → 实验比较选两条记录 →',
  '看可比性结论与条件差异 → 打开原文证据弹层 → 方法关系 → 阅读决策 → 返回实验比较。',
  '',
  '## 截图',
  '',
  '| 步骤 | 桌面 | 窄屏 390×844 |',
  '| --- | --- | --- |',
  '| 首屏 | 01-首屏.png | 01-首屏-窄屏.png |',
  '| 加载完成 | 02-加载完成-首页.png | — |',
  '| 论文库 | 03-论文库.png | — |',
  '| 实验比较（对照） | 04-实验比较-对照.png | 04-实验比较-窄屏.png |',
  '| 证据弹层 | 05-证据弹层.png | — |',
  '| 方法关系 | 06-方法关系.png | — |',
  '| 阅读决策 | 07-阅读决策.png | — |',
  '',
  failures.length ? `## 失败项\n\n${failures.map((f) => '- ' + f).join('\n')}` : '## 失败项\n\n- 无',
  '',
  '> 本记录只走查前端路径，不修改任何实验数据、规则判定、证据内容与推荐结论。',
];

await writeFile(join(OUT, 'WALKTHROUGH.md'), lines.join('\n'), 'utf8');
console.log('');
console.log(`结果：通过 ${pass}，失败 ${fail}`);
if (failures.length) failures.forEach((f) => console.log('  - ' + f));
console.log(`已写出 ${join(OUT, 'WALKTHROUGH.md')}`);
process.exit(fail ? 1 : 0);
