/**
 * 本轮验收：路径 A（空状态首次打开）+ 路径 B（正式视觉案例完整演示）实走。
 * 真浏览器（系统 Chrome + CDP），逐步截屏与断言；不修改任何数据与规则。
 *
 * 用法：node scripts/demo-walkthrough2.mjs [--url https://...] [--out docs/demo-walkthrough-v2]
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
const OUT = resolve(ROOT, argOf('out') ?? 'docs/demo-walkthrough-v2');
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
  async shot(file, w = 1440, h = 960) {
    await this.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 });
    await new Promise((r) => setTimeout(r, 650));
    const r = await this.send('Page.captureScreenshot', { format: 'png' });
    if (r?.data) await writeFile(file, Buffer.from(r.data, 'base64'));
    await this.send('Emulation.clearDeviceMetricsOverride');
  }
  async waitFor(expr, ms = 30000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (await this.ev(expr)) return true;
      await new Promise((r) => setTimeout(r, 400));
    }
    return false;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0;
let fail = 0;
const failures = [];
const notes = [];
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

const profile = join(ROOT, '.build', `chrome-demo2-${Date.now()}`);
await mkdir(profile, { recursive: true });
const child = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=9911', '--user-data-dir=' + profile, '--window-size=1440,960', 'about:blank'], { stdio: 'ignore' });
let ver;
for (let i = 0; i < 60; i++) {
  try {
    ver = await (await fetch('http://127.0.0.1:9911/json/version')).json();
    break;
  } catch {
    await sleep(300);
  }
}
if (!ver) {
  console.error('Chrome 未就绪');
  process.exit(2);
}
const list = await (await fetch('http://127.0.0.1:9911/json/list')).json();
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
const cdp = new Cdp(ws);
await cdp.send('Runtime.enable');
await cdp.send('Page.enable');
await cdp.send('Page.navigate', { url });
await sleep(3200);

const TEXT = (t) => `document.body.innerText.includes(${JSON.stringify(t)})`;
const clickNav = (name) =>
  cdp.ev(`(() => { const b=[...document.querySelectorAll('button.nav')].find((x)=>x.textContent.includes(${JSON.stringify(name)})); if(!b) return false; b.click(); return true; })()`);
const clickBtn = (name) =>
  cdp.ev(`(() => { const b=[...document.querySelectorAll('button')].find((x)=>x.textContent.includes(${JSON.stringify(name)})); if(!b) return false; b.click(); return true; })()`);

/* ============================ 路径 A：空状态首次打开 ============================ */
console.log('');
console.log('=== 路径 A｜空状态首次打开 ===');
check('首屏主文案是一句可记住的话', await cdp.ev(TEXT('别急着比较分数，先确认论文到底在比较什么')));
check('顶部有品牌栏与产品定位', await cdp.ev(TEXT('面向科研初学者的 AI 文献研究工作台')));
check('首屏有两个明确 CTA（开始分析 / 查看演示案例）', (await cdp.ev(TEXT('开始分析视觉论文'))) && (await cdp.ev(TEXT('查看演示案例'))));
check('首屏用三步解释流程', (await cdp.ev(TEXT('三步完成一次调研'))) && (await cdp.ev(TEXT('选择论文'))) && (await cdp.ev(TEXT('检查实验能否公平比较'))) && (await cdp.ev(TEXT('根据证据理解方法演进'))));
check('首屏没有版本号/规则版本等技术噪声', !(await cdp.ev(TEXT('RULES_VERSION'))) && !(await cdp.ev(TEXT('promptVersion'))));
await cdp.shot(join(OUT, 'A1-首屏-空状态.png'));
await cdp.shot(join(OUT, 'A1-首屏-空状态-窄屏.png'), 390, 844);

check('点击主 CTA 可加载演示案例', await clickBtn('开始分析视觉论文'));
check('案例加载完成（导航显示 5 篇）', await cdp.waitFor(`(() => { const t=(document.querySelector('.side')||{}).innerText||''; return t.includes('论文库') && /5 篇/.test(t); })()`, 40000));
await cdp.shot(join(OUT, 'A2-加载完成.png'));

await clickNav('论文库');
await sleep(1200);
const lib = await cdp.ev(`(document.querySelector('.main-inner')||document.body).innerText`);
check('论文库显示案例名称（视觉论文案例）', /视觉论文案例/.test(lib));
check('论文库显示论文数量与领域', /5 篇/.test(lib) && /ImageNet 图像分类/.test(lib));
check('每篇论文有方法标签（CNN / Transformer 等）', /CNN/.test(lib) && /Vision Transformer/.test(lib));
check('论文卡片显示字段证据与实验条数', /字段证据/.test(lib) && /实验 \d+ 条/.test(lib));
check('论文卡片有两个明确动作（查看论文 / 查看实验）', /查看论文/.test(lib) && /查看实验/.test(lib));
check('技术信息被收进折叠区（运行日志）', /运行日志/.test(lib));
await cdp.shot(join(OUT, 'A3-论文库.png'));
await cdp.shot(join(OUT, 'A3-论文库-窄屏.png'), 390, 844);

check('从论文库进入实验比较', await clickBtn('进入实验比较'));
await sleep(1500);
check('实验比较页打开（首句是问题）', await cdp.ev(TEXT('真的可以直接比较吗')));

/* ============================ 路径 B：完整演示 ============================ */
console.log('');
console.log('=== 路径 B｜正式视觉案例完整演示 ===');
const exp0 = await cdp.ev(`(document.querySelector('.main-inner')||document.body).innerText`);
check('默认已给出一组推荐对照（无需用户先猜）', /推荐对照/.test(exp0) && /已选 2 \/ 2|↔/.test(exp0));
check('结论卡给出明确档位', /可以直接比较|只能结合条件讨论|信息不足|不能直接比较/.test(exp0));
check('结论卡配一句人话解释', /数值差异不能直接归因|无法确认两者是否在同一口径|不在同一个口径|可以在已知协议下放在一起看/.test(exp0));
check('给出具体到这一对的原因', /具体到这里/.test(exp0));
check('提供原文证据按钮', /查看原文证据/.test(exp0));
check('条件差异默认折叠在「查看详细条件差异」里', /查看详细条件差异/.test(exp0));
await cdp.shot(join(OUT, 'B1-实验比较-默认对照.png'));
await cdp.shot(join(OUT, 'B1-实验比较-默认对照-窄屏.png'), 390, 844);

const notesText = await cdp.ev(`(() => { const folds=[...document.querySelectorAll('details.fold')]; const f=folds.find((x)=>x.textContent.includes('查看详细条件差异')); if(!f) return ''; f.open=true; return f.innerText; })()`);
await sleep(500);
check('展开后能看到逐项条件差异或信息不足项', /条件不同|信息不足项|完整条件/.test(notesText));
check('完整条件表包含预训练数据/分辨率/蒸馏等', /预训练数据/.test(notesText) && /输入分辨率/.test(notesText) && /蒸馏/.test(notesText) && /测试时增强/.test(notesText));
await cdp.shot(join(OUT, 'B2-展开条件差异.png'));

const evOpened = await cdp.ev(`(() => { const b=[...document.querySelectorAll('button.fl')].find((x)=>x.textContent.includes('查看原文证据')); if(!b) return false; b.click(); return true; })()`);
check('可以打开原文证据弹层', evOpened);
await sleep(900);
const evText = await cdp.ev(`(document.querySelector('.ev-box')||document.body).innerText`);
check('证据弹层显示页码与定位校验', /p\.\d+/.test(evText) && /定位校验|已验证|未通过/.test(evText));
check('证据弹层可关闭', await cdp.ev(`[...document.querySelectorAll('button')].some((b)=>/关闭/.test(b.textContent))`));
await cdp.shot(join(OUT, 'B3-原文证据.png'));
await cdp.ev(`(() => { const b=[...document.querySelectorAll('button')].find((x)=>/关闭/.test(x.textContent)); b && b.click(); })()`);
await sleep(500);

// 口径不同的例子：验证「不能直接比较」的文案
const crossOk = await clickBtn('口径不同的例子');
if (crossOk) {
  await sleep(1200);
  const cross = await cdp.ev(`(document.querySelector('.main-inner')||document.body).innerText`);
  check('口径不同（错误率/准确率）判为不能直接比较', /不能直接比较/.test(cross));
  check('并解释了「一个是错误率、一个是准确率」', /错误率|准确率|互换/.test(cross));
  await cdp.shot(join(OUT, 'B4-口径不同示例.png'));
} else {
  check('存在「口径不同的例子」入口', false, '未找到按钮');
}

await clickNav('方法关系');
await sleep(1500);
const graph = await cdp.ev(`(document.querySelector('.main-inner')||document.body).innerText`);
check('关系页先给方法演进摘要', /方法演进摘要/.test(graph));
check('摘要覆盖 5 个方法', ['ResNet', 'ViT', 'DeiT', 'Swin', 'ConvNeXt'].every((x) => graph.includes(x)));
check('摘要标注证据状态（已核验/待核查）', /已核验|待核查/.test(graph));
check('关系图与三档标签说明在图之后', /关系图与依据/.test(graph) && /原文明示|系统推断/.test(graph));
await cdp.shot(join(OUT, 'B5-方法关系.png'));

await clickNav('阅读建议');
await sleep(1500);
const dec = await cdp.ev(`(document.querySelector('.main-inner')||document.body).innerText`);
check('阅读建议页可打开', /阅读建议/.test(dec));
check('给出阅读顺序或目标匹配', /阅读顺序|目标匹配|推荐/.test(dec));
await cdp.shot(join(OUT, 'B6-阅读建议.png'));

console.log('');
console.log('=== 边界与响应式 ===');
await clickNav('实验比较');
await sleep(1200);
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await sleep(700);
const narrowOverflow = await cdp.ev(`document.documentElement.scrollWidth > window.innerWidth + 1`);
check('窄屏（390×844）无整页横向溢出', !narrowOverflow);
await cdp.send('Emulation.clearDeviceMetricsOverride');
await sleep(400);
const deskOverflow = await cdp.ev(`document.documentElement.scrollWidth > window.innerWidth + 1`);
check('桌面无整页横向溢出', !deskOverflow);

const focusOk = await (async () => {
  await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: 9, key: 'Tab' });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 9, key: 'Tab' });
  await sleep(300);
  return cdp.ev(`(() => { const el=document.activeElement; if(!el) return false; const cs=getComputedStyle(el); return cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth||'0') > 0; })()`);
})();
check('Tab 焦点可见', focusOk);

const statusTextOk = await cdp.ev(`[...document.querySelectorAll('.status')].every((s)=>s.textContent.trim().length>1)`);
check('状态标签都有文字（不只靠颜色）', statusTextOk);

console.log('');
console.log('=== 隔离与刷新 ===');
check('正式案例里不出现旧 NLP 样例', !(await cdp.ev(TEXT('RoBERTa'))) && !(await cdp.ev(TEXT('DistilBERT'))));
await cdp.send('Page.reload', {});
await sleep(3000);
check('刷新后仍在原页面并恢复数据', await cdp.waitFor(`document.querySelectorAll('.exprow').length > 0`, 20000));
check('无未处理前端异常', cdp.errors.filter((e) => !/favicon/i.test(e)).length === 0, cdp.errors.slice(0, 1).join(''));

ws.close();
child.kill();
staticSrv?.server.close();

const lines = [
  '# 视觉重构：新用户路径实走记录（路径 A + 路径 B）',
  '',
  `- 执行时间：${new Date().toLocaleString('zh-CN')}`,
  `- 目标：${url}${target ? '（线上）' : '（本地构建产物）'}`,
  `- 结果：通过 ${pass}，失败 ${fail}`,
  '',
  '## 路径 A（空状态首次打开）',
  '',
  '打开页面 → 看到产品说明与两个 CTA → 点「开始分析视觉论文」加载演示案例 → 进入论文库（案例信息、方法标签、字段证据、实验条数）→ 点「进入实验比较」。',
  '',
  '## 路径 B（正式视觉案例完整演示）',
  '',
  '实验比较（默认已给一组推荐对照）→ 看结论卡与人话解释 → 展开条件差异 → 打开原文证据 → 换一组「口径不同的例子」验证不能直接比较 → 方法关系（先摘要后图）→ 阅读建议。',
  '',
  '## 截图',
  '',
  '| 步骤 | 桌面 | 窄屏 390×844 |',
  '| --- | --- | --- |',
  '| 首屏（空状态） | A1-首屏-空状态.png | A1-首屏-空状态-窄屏.png |',
  '| 加载完成 | A2-加载完成.png | — |',
  '| 论文库 | A3-论文库.png | A3-论文库-窄屏.png |',
  '| 实验比较（默认对照） | B1-实验比较-默认对照.png | B1-实验比较-默认对照-窄屏.png |',
  '| 展开条件差异 | B2-展开条件差异.png | — |',
  '| 原文证据 | B3-原文证据.png | — |',
  '| 口径不同示例 | B4-口径不同示例.png | — |',
  '| 方法关系 | B5-方法关系.png | — |',
  '| 阅读建议 | B6-阅读建议.png | — |',
  '',
  notes.length ? `## 记录\n\n${notes.map((n) => '- ' + n).join('\n')}` : '',
  failures.length ? `## 失败项\n\n${failures.map((f) => '- ' + f).join('\n')}` : '## 失败项\n\n- 无',
  '',
  '> 只走查界面与交互路径，不修改任何实验数据、判定规则、证据内容与推荐结论。',
];

await writeFile(join(OUT, 'WALKTHROUGH.md'), lines.filter(Boolean).join('\n'), 'utf8');
console.log('');
console.log(`结果：通过 ${pass}，失败 ${fail}`);
if (failures.length) failures.forEach((f) => console.log('  - ' + f));
console.log(`已写出 ${join(OUT, 'WALKTHROUGH.md')}`);
process.exit(fail ? 1 : 0);
