/**
 * 本轮验收：两条真实路径
 *   A 体验案例：首页 → 体验视觉论文案例 → 看懂方法（分组+卡片）→ 联系与区别（真实关系+时间线声明）
 *               → 选两篇看差异 → 从哪里开始 → 阅读路线
 *   B 用我自己的论文：首页 → 上传我的论文 → 选择真实 PDF（CDP 注入）→ 解析结果 → 单篇提示
 *                    → 未配置模型时就地提示 → 进入研究地图（单篇理解）
 *
 * 并核对 7 个验证问题（能说清产品定位 / 不进实验比较也能理解 / 关系来自证据 / 阅读建议是主能力 /
 * 原文依据可访问 / 语料隔离 / 窄屏可用）。
 *
 * 用法：node scripts/demo-walkthrough4.mjs [--url https://...] [--out docs/demo-walkthrough-v5]
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
const OUT = resolve(ROOT, argOf('out') ?? 'docs/demo-walkthrough-v5');
await mkdir(OUT, { recursive: true });

/** 用于上传实测的真实 PDF（仓库内自带的视觉论文之一，仅本地读取） */
const UPLOAD_PDF = resolve(ROOT, 'samples/pdfs/vision/02_ViT_2020.pdf');

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
    await new Promise((r) => setTimeout(r, 700));
    const r = await this.send('Page.captureScreenshot', { format: 'png' });
    if (r?.data) await writeFile(file, Buffer.from(r.data, 'base64'));
    await this.send('Emulation.clearDeviceMetricsOverride');
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
console.log(`上传实测文件：${existsSync(UPLOAD_PDF) ? UPLOAD_PDF : '（缺失）'}`);

const profile = join(ROOT, '.build', `chrome-flow4-${Date.now()}`);
await mkdir(profile, { recursive: true });
const child = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=9977', '--user-data-dir=' + profile, '--window-size=1440,960', 'about:blank'], { stdio: 'ignore' });
let ver;
for (let i = 0; i < 60; i++) {
  try {
    ver = await (await fetch('http://127.0.0.1:9977/json/version')).json();
    break;
  } catch {
    await sleep(300);
  }
}
if (!ver) {
  console.error('Chrome 未就绪');
  process.exit(2);
}
const list = await (await fetch('http://127.0.0.1:9977/json/list')).json();
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
const cdp = new Cdp(ws);
await cdp.send('Runtime.enable');
await cdp.send('Page.enable');
await cdp.send('DOM.enable');
await cdp.send('Page.navigate', { url });
await sleep(3200);

const TEXT = (t) => `document.body.innerText.includes(${JSON.stringify(t)})`;

/** 精确点击某个方法节点（按节点矩形定位，避免点到连线标签） */
const clickNode = (shortName) =>
  cdp.ev(`
(() => {
  const rects = [...document.querySelectorAll('.mapstage .mnode')];
  const target = rects.find((r) => [...r.closest('g').querySelectorAll('text')].some((t) => t.textContent.trim().startsWith(${JSON.stringify(shortName)})));
  if (!target) return false;
  target.closest('g').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  return true;
})()`);

const mainText = () => cdp.ev(`(document.querySelector('.main-inner') || document.body).innerText`);
const clickBtn = (t) => cdp.ev(`(() => { const b=[...document.querySelectorAll('button')].find((x)=>x.textContent.includes(${JSON.stringify(t)})); if(!b) return false; b.click(); return true; })()`);
const clickNav = (t) => cdp.ev(`(() => { const b=[...document.querySelectorAll('button.nav')].find((x)=>x.textContent.includes(${JSON.stringify(t)})); if(!b) return false; b.click(); return true; })()`);

/* ================= 定位纠偏：首页 ================= */
console.log('');
console.log('=== 首页：产品定位（梳理论文方法 + 阅读路线，而不是给论文打分） ===');
const land = await mainText();
check('主标题是「把一组论文，变成你看得懂的研究地图。」', /把一组论文，变成你看得懂的研究地图/.test(land));
check('副标题说明看懂方法/发展/先读哪篇 + 原文依据', /看懂各类方法解决了什么、彼此如何发展，以及你应该先读哪篇。关键结论都能回到原文/.test(land));
check('三个关键词是方法/关系/阅读', /看懂方法差异/.test(land) && /理清技术关系/.test(land) && /决定先读什么/.test(land));
check('主按钮「体验视觉论文案例」', /体验视觉论文案例/.test(land));
check('次按钮「上传我的论文」', /上传我的论文/.test(land));
check('示意图是「论文 → 分组与关联 → 阅读路线」', /一组论文/.test(land) && /方法分组与关联/.test(land) && /阅读路线/.test(land));
check('首页标明内容来源与状态（预置案例 / 按证据状态标注 / 非实时）',
  /预置视觉案例/.test(land) && /证据状态标注/.test(land) && /不是本次操作触发的实时分析/.test(land));
check('首页不再以准确率对比或「不能比较」为主视觉', !/Top-1|准确率|不能直接比较|能直接比较吗/.test(land));
await cdp.shot(join(OUT, 'A1-首页.png'));
await cdp.shot(join(OUT, 'A1-首页-窄屏.png'), 390, 844);

/* ================= 路径 A ================= */
console.log('');
console.log('=== 路径 A：体验案例 ===');
check('点击「体验视觉论文案例」', await clickBtn('体验视觉论文案例'));
await sleep(5000);
const mapText = await mainText();
check('直接进入研究地图（无单选项案例页）', /研究地图/.test(mapText) && !/选择一个视觉论文案例/.test(mapText));
check('工作区显示论文集合与三个视图', /研究地图 · 视觉方法演进案例/.test(mapText) && /方法地图/.test(mapText) && /联系与区别/.test(mapText) && /从哪里开始/.test(mapText));
check('首屏主体是图形（不是概览段落或论文卡片列表）', !/领域概览\n/.test(mapText) && !/逐篇方法卡片/.test(mapText));
check(
  '默认给出一个具体的探索问题 + 入口（问题来自现有关系）',
  /先看这个/.test(mapText) && /相比/.test(mapText) && /看这个对比/.test(mapText),
);

const svgInfo = await cdp.ev(`
(() => {
  const texts = [...document.querySelectorAll('svg text')].map((t) => t.textContent);
  const nodeRects = [...document.querySelectorAll('.mapstage .mnode')];
  const edges = [...document.querySelectorAll('svg path')].filter((p) => p.getAttribute('marker-end'));
  return { texts, nodeCount: nodeRects.length, edgeCount: edges.length };
})()`);
check('泳道 = 方法家族（卷积网络 / Transformer 架构，忠实命名）', svgInfo.texts.some((t) => /卷积网络/.test(t)) && svgInfo.texts.some((t) => /Transformer 架构/.test(t)), JSON.stringify(svgInfo.texts.slice(0, 8)));
check(`五个正式案例的方法全部画在地图上（节点 ${svgInfo.nodeCount} 个）`, svgInfo.nodeCount === 5, String(svgInfo.nodeCount));
check('节点名称可读（ResNet / ViT / DeiT / Swin / ConvNeXt）', ['ResNet', 'ViT', 'DeiT', 'Swin', 'ConvNeXt'].every((n) => svgInfo.texts.some((t) => t === n || t.startsWith(n + '　') || t.startsWith(n + ' '))), JSON.stringify(svgInfo.texts.filter((t) => /ResNet|ViT|DeiT|Swin|ConvNeXt/.test(t))));
check('节点带一句话贡献（不是空话或空节点）', svgInfo.texts.some((t) => /残差|Transformer|蒸馏|窗口|卷积/.test(t)));
const optsToggles = await cdp.ev(`
(() => {
  const b=[...document.querySelectorAll('button')].find((x)=>x.textContent.includes('选项'));
  if (b) b.click();
  return new Promise((r) => setTimeout(() => {
    const t = (document.querySelector('.mapopts .pop') || document.body).innerText;
    if (b) b.click();
    r(t);
  }, 400));
})()`);
  check('待核查 / 关系不明确的开关收进「选项」弹层', /显示待核查关系/.test(optsToggles) && /关系不明确/.test(optsToggles));
check(`默认可见真实关系连线（${svgInfo.edgeCount} 条）`, svgInfo.edgeCount >= 1);
check('图例用线型 + 文字区分证据状态', /原文明示/.test(mapText) && /系统推断/.test(mapText) && /待核查/.test(mapText));
await cdp.shot(join(OUT, 'A2-方法地图.png'));
await cdp.shot(join(OUT, 'A2-方法地图-窄屏.png'), 390, 844);

// 点击节点 → 高亮 + 详情
check('点击 DeiT 节点', await clickNode('DeiT'));
await sleep(800);
const nodeDetail = await cdp.ev(`(document.querySelector('.mapdetail') || document.body).innerText`);
check('点击节点第一层显示「一句话贡献 / 核心做法 / 与相关方法的联系」', /一句话贡献/.test(nodeDetail) && /核心做法/.test(nodeDetail) && /与相关方法的联系/.test(nodeDetail));
check('节点详情给出方法家族与策略（策略在深入解释里）', /Transformer 架构|卷积网络（CNN）/.test(nodeDetail));
check('节点详情的关系说明方向正确（ViT 是前置方法）', /ViT 是 DeiT 的前置方法|DeiT 在 ViT 的基础上继续发展/.test(nodeDetail));
await cdp.shot(join(OUT, 'A3-点击节点-详情.png'));

// 原文依据：验证证据属于正确论文
const evOpened = await cdp.ev(`
(() => {
  const d = document.querySelector('.mapdetail details.fold');
  if (d) d.open = true;
  const b = [...document.querySelectorAll('.mapdetail button')].find((x) => /原文（p\./.test(x.textContent));
  if (!b) return false;
  b.click();
  return true;
})()`);
await sleep(900);
const evText = await cdp.ev(`(document.querySelector('.ev-box') || document.body).innerText`);
check('可以从节点详情打开原文依据', evOpened);
check('证据属于该论文（弹层出现该论文标题片段）', /DeiT|data-efficient|Training data-efficient/.test(evText), String(evText).slice(0, 120));
check('证据弹层显示页码与定位校验', /p\.\d+/.test(evText) && /定位校验|已验证|未能/.test(evText));
await cdp.shot(join(OUT, 'A4-节点原文依据.png'));
await cdp.ev(`(() => { const b=[...document.querySelectorAll('button')].find((x)=>/关闭/.test(x.textContent)); if (b) b.click(); })()`);
await sleep(500);

// 点击连线 → 方向与证据状态
await cdp.ev(`
(() => {
  const p = [...document.querySelectorAll('svg path')].find((x) => x.getAttribute('marker-end'));
  if (p) p.closest('g').dispatchEvent(new MouseEvent('click', { bubbles: true }));
})()`);
await sleep(800);
const edgeDetail = await cdp.ev(`(document.querySelector('.mapdetail') || document.body).innerText`);
check(
  '点击连线先给「一句话回答」，再给方向、证据状态与具体变化与下一步',
  /一句话回答/.test(edgeDetail) && /具体变化/.test(edgeDetail) && /系统推断|原文已说明|待核查/.test(edgeDetail) && /下一步/.test(edgeDetail),
);
await cdp.ev(`(() => { const d = document.querySelector('.mapdetail details.fold'); if (d) d.open = true; })()`);
  await sleep(500);
  const edgeEv = await cdp.ev(`(document.querySelector('.mapdetail') || document.body).innerText`);
  check('缺少可核验引文时如实说明（不用确定性口吻）', /没有绑定可核验引文|查看原文引文/.test(edgeEv), String(edgeEv).slice(-160));
await cdp.shot(join(OUT, 'A5-点击连线-联系.png'));

// 待核查与「关系不明确」开关
const toggleInfo = await cdp.ev(`
(async () => {
  const ob = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('选项'));
  if (ob) ob.click();
  await new Promise((r) => setTimeout(r, 400));
  const boxes = [...document.querySelectorAll('input[type=checkbox]')];
  const pending = boxes.find((b) => b.closest('label') && /显示待核查关系/.test(b.closest('label').textContent));
  const unclear = boxes.find((b) => b.closest('label') && /关系不明确/.test(b.closest('label').textContent));
  const before = [...document.querySelectorAll('svg path')].filter((p) => p.getAttribute('marker-end')).length;
  if (unclear) unclear.click();
  return { hasPending: !!pending, hasUnclear: !!unclear, before };
})()`);
await sleep(700);
const afterEdges = await cdp.ev(`[...document.querySelectorAll('svg path')].filter((p) => p.getAttribute('marker-end')).length`);
check('待核查 / 关系不明确的开关在「选项」弹层里', toggleInfo.hasPending && toggleInfo.hasUnclear);
check(`打开「关系不明确」后连线数量增加（${toggleInfo.before} → ${afterEdges}）`, afterEdges > toggleInfo.before);
await cdp.shot(join(OUT, 'A6-打开关系不明确.png'));
await cdp.ev(`
(async () => {
  const ob = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('选项'));
  if (ob) ob.click();
  await new Promise((r) => setTimeout(r, 400));
  const boxes = [...document.querySelectorAll('input[type=checkbox]')];
  const unclear = boxes.find((b) => b.closest('label') && /关系不明确/.test(b.closest('label').textContent));
  if (unclear) unclear.click();
})()`);
await sleep(500);

check('切换到「联系与区别」', await clickBtn('联系与区别'));
await sleep(1200);
const rel = await mainText();
check('关系明细表只有真实关系，方向以数据为准', /起点方法/.test(rel) && /指向方法/.test(rel) && /说明（按同一方向描述）/.test(rel));
check('时间线明确标注不代表技术继承', /发表顺序（时间线）/.test(rel) && /仅表示发表先后，不代表技术继承/.test(rel));
await cdp.shot(join(OUT, 'A7-联系与区别.png'));

await cdp.ev(`
(async () => {
  // 页面会默认预置一对，先全部取消，再精确选两个
  [...document.querySelectorAll('.chip')].filter((c) => c.classList.contains('on')).forEach((c) => c.click());
  await new Promise((r) => setTimeout(r, 250));
  for (const n of ['ResNet', 'ViT']) {
    const c = [...document.querySelectorAll('.chip')].find((x) => x.textContent.trim() === n);
    if (c) c.click();
  }
  await new Promise((r) => setTimeout(r, 350));
  return true;
})()`);
await sleep(900);
const pair = await mainText();
const pairChips = await cdp.ev(`[...document.querySelectorAll('.chip.on')].map((c) => c.textContent.trim())`);
check('两方法对照排在关系明细之前，并可自选两个方法', /两方法对照/.test(pair) && pair.indexOf('两方法对照') < pair.indexOf('关系明细'), JSON.stringify(pairChips));
check('选两个方法后先给「问题 / 做法 / 局限 / 家族 / 策略」对照', /解决什么问题/.test(pair) && /主要局限/.test(pair) && /方法家族/.test(pair) && /技术策略/.test(pair));
check('实验表现是可展开的次级入口', /比较实验表现（次级）/.test(pair));
await clickBtn('比较实验表现（次级）');
await sleep(900);
const expText = await mainText();
check('实验表现保留真实状态（不能直接比较 / 仍需确认 / 条件不同）', /不能直接比较|仍需确认|条件不同/.test(expText));
check('说明它不是评分', /不是.*系统给论文的评分/.test(expText));
await cdp.shot(join(OUT, 'A8-两方法对照.png'));

check('切换到「从哪里开始」', await clickBtn('从哪里开始'));
await sleep(1000);
check('阅读目标不追问算力', !/可用的计算资源/.test(await mainText()));
check('未配置模型时入口明确叫「查看示例路线」', await clickBtn('查看示例路线'));
await sleep(1800);
const plan = await mainText();
check('给出阅读顺序与每篇重点', /建议按这个顺序读/.test(plan) && /重点看/.test(plan));
await cdp.shot(join(OUT, 'A9-阅读路线.png'));

/* ================= 路径 B：上传自己的论文 ================= */
console.log('');
console.log('=== 路径 B：上传我的论文（真实 PDF，先清空站点数据保证是干净状态）===');
await cdp.send('Storage.clearDataForOrigin', { origin: new URL(url).origin, storageTypes: 'all' });
await cdp.send('Page.reload', {});
await sleep(3500);
await clickNav('首页');
await sleep(600);
await sleep(800);
check('点击「上传我的论文」', await clickBtn('上传我的论文'));
await sleep(1200);
const upEmpty = await mainText();
check('进入上传流程（含解析说明与两种入口）', /上传我的论文/.test(upEmpty) && /选择 PDF 文件/.test(upEmpty) && /粘贴论文正文/.test(upEmpty));

let uploaded = false;
if (existsSync(UPLOAD_PDF)) {
  const doc = await cdp.send('DOM.getDocument', { depth: -1 });
  const node = await cdp.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: 'input[type=file]' });
  if (node?.nodeId) {
    await cdp.send('DOM.setFileInputFiles', { nodeId: node.nodeId, files: [UPLOAD_PDF] });
    uploaded = true;
  }
}
check('已注入真实 PDF 并触发解析', uploaded);
await sleep(6000);
const upText = await mainText();
check('显示解析结果（页数 / 字符数）', /\d+ 页/.test(upText) && /\d+ 字符/.test(upText));
check('未配置模型时就地提示配置（不让用户先去找设置）', /需要模型接口/.test(upText) && /接口地址/.test(upText) && /密钥/.test(upText));
check('提示密钥只保存在本机浏览器', /只保存在本机浏览器|不会写入任何产物/.test(upText));
await cdp.shot(join(OUT, 'B1-上传论文-解析完成.png'));

const paperCount = await cdp.ev(`document.querySelectorAll('.paper').length`);
check(`上传后出现论文卡片（${paperCount} 张）`, paperCount >= 1);
const canEnter = await clickBtn('进入研究地图');
await sleep(2000);
const single = await mainText();
check('可以进入同一个研究地图工作区', canEnter && /研究地图/.test(single));
check(
  '单篇时地图自动切到「我上传的论文」并如实说明（不编造）',
  /我上传的论文/.test(single) && /还没有方法分析结果|方法字段尚未生成|加更多论文|只有 1 篇/.test(single),
  String(single).replace(/\n/g, ' | ').slice(0, 220),
);
await clickBtn('联系与区别');
await sleep(900);
const singleRel = await mainText();
check('单篇时不出现任何编造的关系', /还没有可核验的方法关系|暂无关系/.test(singleRel));
await clickBtn('看懂方法');
await sleep(700);
await cdp.shot(join(OUT, 'B2-单篇论文的研究地图.png'));

/* ================= 验证问题 ================= */
console.log('');
console.log('=== 七个验证问题（可自动核对的部分） ===');
check('① 产品定位能说清为「梳理论文方法与阅读路线」', /研究地图/.test(land) && /阅读路线/.test(land) && !/给论文打分|排行榜/.test(land));
check('② 不进入实验比较也能获得方法理解（家族泳道 + 节点贡献 + 节点详情）', svgInfo.texts.some((t) => /卷积网络|视觉 Transformer/.test(t)) && /核心做法/.test(nodeDetail));
check('③ 技术关系来自证据（关系表带证据状态与引文列）', /证据状态/.test(rel) && /原文依据/.test(rel));
check('④ 阅读建议是普通用户可见的主能力（三个视图之一）', /从哪里开始/.test(mapText));
check('⑤ 原文依据一到两次点击可达', evOpened && /p\.\d+/.test(evText));

await clickNav('更多');
await sleep(1000);
const more = await mainText();
check('⑥ 正式案例与旧 NLP 样例隔离（切换入口只在更多里）', /切换到开发回归样例|切换到正式视觉案例/.test(more));
check('更多里保留论文库 / 全部结果 / 开发状态 / 设置', /论文库（原始字段）/.test(more) && /开发状态与记录/.test(more) && /设置/.test(more));

await clickNav('研究地图');
await sleep(1000);
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await sleep(800);
check('⑦ 窄屏（390×844）无整页横向溢出', !(await cdp.ev(`document.documentElement.scrollWidth > window.innerWidth + 1`)));
await cdp.send('Emulation.clearDeviceMetricsOverride');
await sleep(400);
check('桌面无整页横向溢出', !(await cdp.ev(`document.documentElement.scrollWidth > window.innerWidth + 1`)));

check('无未处理前端异常', cdp.errors.filter((e) => !/favicon/i.test(e)).length === 0, cdp.errors.slice(0, 1).join(''));

ws.close();
child.kill();
staticSrv?.server.close();

const lines = [
  '# 新用户路径实走（研究地图）',
  '',
  `- 执行时间：${new Date().toLocaleString('zh-CN')}`,
  `- 目标：${url}${target ? '（线上）' : '（本地构建产物）'}`,
  `- 上传实测文件：${existsSync(UPLOAD_PDF) ? 'samples/pdfs/vision/02_ViT_2020.pdf（仓库内自带，仅本地读取）' : '缺失'}`,
  `- 结果：通过 ${pass}，失败 ${fail}`,
  '',
  '## 路径 A（体验案例）',
  '',
  '首页 → 体验视觉论文案例 → 研究地图（看懂方法：领域概览 + 方法分组 + 方法卡片）→ 展开局限与原文依据',
  '→ 联系与区别（真实关系表 + 发表顺序时间线声明 + 选两篇对照 + 可选实验表现比较）→ 从哪里开始 → 阅读路线。',
  '',
  '## 路径 B（上传自己的论文）',
  '',
  '首页 → 上传我的论文 → 选择真实 PDF → 解析完成（页数/字符数）→ 未配置模型时就地提示 → 进入同一个研究地图工作区（单篇理解 + 提示补足论文）。',
  '',
  '## 截图',
  '',
  '| 步骤 | 桌面 | 窄屏 390×844 |',
  '| --- | --- | --- |',
  '| 首页 | A1-首页.png | A1-首页-窄屏.png |',
  '| 方法地图（图形优先） | A2-方法地图.png | A2-方法地图-窄屏.png |',
  '| 点击节点（高亮 + 详情） | A3-点击节点-详情.png | — |',
  '| 节点原文依据 | A4-节点原文依据.png | — |',
  '| 点击连线（方向 + 证据状态） | A5-点击连线-联系.png | — |',
  '| 打开「关系不明确」的配对 | A6-打开关系不明确.png | — |',
  '| 联系与区别（明细 + 时间线声明） | A7-联系与区别.png | — |',
  '| 两方法对照（含实验表现） | A8-两方法对照.png | — |',
  '| 阅读路线 | A9-阅读路线.png | — |',
  '| 上传我的论文 | B1-上传论文-解析完成.png | — |',
  '| 单篇研究地图 | B2-单篇论文的研究地图.png | — |',
  '',
  notes.length ? `## 记录\n\n${notes.map((n) => '- ' + n).join('\n')}` : '',
  failures.length ? `## 失败项\n\n${failures.map((f) => '- ' + f).join('\n')}` : '## 失败项\n\n- 无',
  '',
  '> 只走查界面与交互；不修改模型输出、数据、证据、实验记录与判断算法。',
];

await writeFile(join(OUT, 'WALKTHROUGH.md'), lines.filter(Boolean).join('\n'), 'utf8');
console.log('');
console.log(`结果：通过 ${pass}，失败 ${fail}`);
if (failures.length) failures.forEach((f) => console.log('  - ' + f));
console.log(`已写出 ${join(OUT, 'WALKTHROUGH.md')}`);
process.exit(fail ? 1 : 0);
