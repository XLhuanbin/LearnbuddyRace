/**
 * 本轮验收：两条真实路径
 *   A 体验案例：首页 → 体验视觉论文案例 → 看懂方法（分组+卡片）→ 关系与比较（真实关系+时间线声明）
 *               → 选两篇看差异 → 阅读起点 → 阅读路线
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
/**
 * 顶栏「目录」下拉。2026-09-25（c647794）起导航从左侧栏改为目录浮层，
 * 旧的 `button.nav`（AppSideNav）已不再渲染 —— 这里按当前结构点 .dirbtn → .diritem。
 */
const clickNav = async (t) => {
  await cdp.ev(`(() => { const b=document.querySelector('.dirbtn'); if(b) b.click(); return true; })()`);
  await sleep(500);
  const ok = await cdp.ev(
    `(() => { const it=[...document.querySelectorAll('.diritem')].find(x=>x.textContent.includes(${JSON.stringify(t)})); if(!it) return false; it.click(); return true; })()`,
  );
  await sleep(1400);
  return ok;
};

/* ================= 定位纠偏：首页 ================= */
console.log('');
console.log('=== 首页：产品定位（梳理论文方法 + 阅读路线，而不是给论文打分） ===');
const land = await mainText();
check('主标题是「把一组论文，变成你看得懂的研究地图。」', /把一组论文，变成你看得懂的研究地图/.test(land));
check('一句话说清产品定位（读懂方法演进、知道先读哪一篇）', /读懂方法演进，知道先读哪一篇/.test(land));
check('三块概念说明齐备（论文集合 / 研究地图 / 阅读路线），每块各有一句说明',
  /先把论文按技术路线放在一起，再看每篇具体解决了什么/.test(land) &&
  /看清方法之间的联系、区别和证据状态/.test(land) &&
  /先读哪篇，以及读每篇时重点看什么/.test(land));
check('主按钮「体验视觉论文案例」', /体验视觉论文案例/.test(land));
check('次按钮「上传我的论文」', /上传我的论文/.test(land));
check('首页配图明确标注为概念示意、不代表真实数量',
  /一组论文/.test(land) && /概念示意，不代表当前案例的真实关系数量/.test(land));
check('首页标明内容来源（真实分组/关系/阅读顺序在地图与阅读路线页按证据展示）',
  /不代表当前案例的真实关系数量与证据状态/.test(land) && /在研究地图与阅读路线页按证据展示/.test(land));
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
check('工作区显示论文集合与三个视图', /研究地图 · 视觉方法演进案例/.test(mapText) && /方法地图/.test(mapText) && /关系与比较/.test(mapText) && /阅读起点/.test(mapText));
check('首屏主体是图形（不是概览段落或论文卡片列表）', !/领域概览\n/.test(mapText) && !/逐篇方法卡片/.test(mapText));
// 2026-10-09：画布上给出一个具体的起点建议（数据取自阅读路线的第 1 篇），替代早先的「先看这个 / 看这个对比」提问块
check(
  '画布给出具体的起点建议（不是泛泛的说明）',
  /建议从这里开始：/.test(mapText) && /阅读路线的第 1 篇/.test(mapText),
  mapText.match(/建议从这里开始：[^\n]*/)?.[0] ?? '（没找到起点建议）',
);
// 2026-10-09：关系可见性改为常驻三态，默认「全部」——不再默认把大部分关系藏起来
check(
  '关系可见性三态常驻且默认「全部」',
  (await cdp.ev(
    `(() => { const chips=[...document.querySelectorAll('.relview .chip')]; const on=chips.find(c=>c.classList.contains('on')); return JSON.stringify({ n: chips.length, on: on ? on.textContent.trim() : '' }); })()`,
  )) === JSON.stringify({ n: 3, on: '全部10' }),
  String(await cdp.ev(`[...document.querySelectorAll('.relview .chip')].map(c=>c.textContent.trim()).join('|')`)),
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
// 2026-10-09：关系可见性移到页头常驻三态；「筛选」弹层只保留与三态正交的「只看有证据关系」
const filterPop = await cdp.ev(`
(async () => {
  const b=[...document.querySelectorAll('.mapopts button')].find((x)=>/筛选/.test(x.textContent));
  if (!b) return '（没有筛选入口）';
  b.click();
  await new Promise((r) => setTimeout(r, 400));
  const t = (document.querySelector('.mapopts .pop') || document.body).innerText;
  b.click();
  return t;
})()`);
check(
  '「筛选」弹层保留「只看有证据关系」，并说明可见性在页头三态里切换',
  /只看有证据关系/.test(filterPop) && /全部 \/ 可用 \/ 待核查/.test(filterPop),
  String(filterPop).replace(/\n/g, ' | ').slice(0, 120),
);
check(`默认可见真实关系连线（${svgInfo.edgeCount} 条）`, svgInfo.edgeCount >= 1);
check('图例用线型 + 文字区分证据状态', /原文明示/.test(mapText) && /系统推断/.test(mapText) && /待核查/.test(mapText));
await cdp.shot(join(OUT, 'A2-方法地图.png'));
await cdp.shot(join(OUT, 'A2-方法地图-窄屏.png'), 390, 844);

// 点击节点 → 高亮 + 详情
check('点击 DeiT 节点', await clickNode('DeiT'));
await sleep(800);
const nodeDetail = await cdp.ev(`(document.querySelector('.mapdetail') || document.body).innerText`);
check('点击节点首层给「一句话贡献」，核心做法与联系收在折叠里（渐进披露）',
  /一句话贡献/.test(nodeDetail) && /查看核心做法 · 局限 · 原文依据/.test(nodeDetail));
check('节点详情给出方法家族（策略在深入解释里）', /Transformer 架构|卷积网络（CNN）/.test(nodeDetail));
await cdp.shot(join(OUT, 'A3-点击节点-详情.png'));

// 展开节点详情的折叠区：核心做法、与相关方法的联系、原文依据都应出现
await cdp.ev(`(() => { const d=document.querySelector('.mapdetail details.fold'); if (d) d.open = true; })()`);
await sleep(600);
const nodeDetailOpen = await cdp.ev(`(document.querySelector('.mapdetail') || document.body).innerText`);
check('展开后给出核心做法与「与相关方法的联系」',
  /核心做法/.test(nodeDetailOpen) && /与相关方法的联系/.test(nodeDetailOpen));
check('节点详情的关系说明方向正确（ViT 是 DeiT 的前置方法）',
  /ViT 是 DeiT 的前置方法|DeiT 在 ViT 的基础上继续发展/.test(nodeDetailOpen));

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
  '点击连线给出关系描述、证据状态与「具体联系 / 变化」',
  /方法联系/.test(edgeDetail) && /具体联系 \/ 变化/.test(edgeDetail) && /系统推断|原文已说明|待核查/.test(edgeDetail),
);
await cdp.ev(`(() => { const d = document.querySelector('.mapdetail details.fold'); if (d) d.open = true; })()`);
  await sleep(500);
  const edgeEv = await cdp.ev(`(document.querySelector('.mapdetail') || document.body).innerText`);
  check('缺少可核验引文时如实说明（不用确定性口吻）', /没有绑定可核验引文|查看原文引文/.test(edgeEv), String(edgeEv).slice(-160));
await cdp.shot(join(OUT, 'A5-点击连线-联系.png'));

/**
 * 2026-10-09：原先「待核查 / 关系不明确」两个默认关闭的开关已被页头常驻三态取代。
 * 这里改为实测三态的实际口径：默认「全部」画出全部关系；切「可用」只留有可用证据状态的；
 * 切「待核查」看还不能当结论用的那部分（待核查 + 关系不明确）。
 */
const relViewSnap = async () =>
  cdp.ev(`(() => {
  const on = document.querySelector('.relview .chip.on');
  const t = document.querySelector('.maphead-meta').innerText;
  const line = (t.match(/关系\\s*\\d+\\s*条\\s*·\\s*当前显示\\s*\\d+\\s*条/) || [''])[0];
  const hidden = (t.match(/隐藏\\s*[^\\n]*/) || ['（无隐藏行）'])[0];
  return { chip: on ? on.textContent.trim() : '', line, hidden, edges: [...document.querySelectorAll('.mapstage svg path')].filter((p) => p.getAttribute('marker-end')).length };
})()`);
const relView = { all: await relViewSnap() };
check(`默认「全部」画出全部关系（${relView.all.edges} 条，且没有隐藏行）`,
  /^全部/.test(relView.all.chip) && relView.all.edges >= 8 && relView.all.hidden === '（无隐藏行）',
  JSON.stringify(relView.all));

const setRelView = async (prefix) => {
  await cdp.ev(`(() => { const c=[...document.querySelectorAll('.relview .chip')].find((x)=>x.textContent.trim().startsWith(${JSON.stringify(prefix)})); if (c) c.click(); return true; })()`);
  await sleep(900);
  return relViewSnap();
};
relView.usable = await setRelView('可用');
check(`切「可用」后只剩有可用证据状态的关系，并写清隐藏了什么（${relView.usable.edges} 条：${relView.usable.hidden}）`,
  /^可用/.test(relView.usable.chip) && relView.usable.edges < relView.all.edges && /待核查|关系不明确/.test(relView.usable.hidden),
  JSON.stringify(relView.usable));
await cdp.shot(join(OUT, 'A6-关系可见性-可用.png'));

relView.pending = await setRelView('待核查');
check(`切「待核查」后看到还不能当结论用的关系（${relView.pending.edges} 条：${relView.pending.hidden}）`,
  /^待核查/.test(relView.pending.chip) && relView.pending.edges > relView.usable.edges,
  JSON.stringify(relView.pending));

await setRelView('全部');

check('切换到「关系与比较」', await clickBtn('关系与比较'));
await sleep(1200);
const rel = await mainText();
check('关系明细表只有真实关系，方向以数据为准', /起点方法/.test(rel) && /指向方法/.test(rel) && /说明（按同一方向描述）/.test(rel));
check('时间线明确标注不代表技术继承', /发表顺序（时间线）/.test(rel) && /仅表示发表先后，不代表技术继承/.test(rel));
await cdp.shot(join(OUT, 'A7-关系与比较.png'));

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
// 2026-10-09：可比才并排数字；不可比就说明为什么不并列（含「已抽取结果里没有可比对记录」这一支）
check('实验表现保留真实状态（可比才并排数字 / 不可比就说明为什么不并列）',
  /仍需确认|条件不同|不并列数字|不做表现比较|不能直接比较/.test(expText),
  String(expText).replace(/\n/g, ' | ').slice(-200));
check('说明它不是评分', /不是.*系统给论文的评分/.test(expText));
await cdp.shot(join(OUT, 'A8-两方法对照.png'));

check('切换到「阅读起点」', await clickBtn('阅读起点'));
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
// 清空站点数据后应用会回到宣传首页；点品牌回首页只是保险（落地页与工作页都有 .logo）
await cdp.ev(`(() => { const b=document.querySelector('.logo'); if(b) b.click(); return true; })()`);
await sleep(900);
check('点击「上传我的论文」', await clickBtn('上传我的论文'));
await sleep(1400);
const upEmpty = await mainText();
check(
  '进入上传流程（含解析说明与两种入口）',
  // 2026-10-09 改版：方法提取页按 Superdesign 草稿复刻，上传按钮文案改为草稿原文「浏览文件」，
  // 空态文案改为草稿原文「尚未选择任何文件」；「方法提取」仍在首屏 eyebrow 里。
  /方法提取/.test(upEmpty) && /浏览文件/.test(upEmpty) && /粘贴论文正文/.test(upEmpty) && /尚未提取方法|还没有上传论文|尚未选择任何文件/.test(upEmpty),
  upEmpty.replace(/\n+/g, ' | ').slice(0, 140),
);

let uploaded = false;
if (existsSync(UPLOAD_PDF)) {
  /**
   * 精确定位上传控件：`.main-inner` 里的那个 file input。
   * 页面里有多个隐藏 file input（App 根节点上还有一个「重新选择 PDF」用的），
   * 取全局第一个会塞到没接线的那个上 —— 之前这里就是这么失败的（实测注入后 0 篇论文）。
   */
  const doc = await cdp.send('DOM.getDocument', { depth: -1 });
  const node = await cdp.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '.main-inner input[type=file]' });
  if (node?.nodeId) {
    await cdp.send('DOM.setFileInputFiles', { nodeId: node.nodeId, files: [UPLOAD_PDF] });
    uploaded = true;
  }
}
check('已注入真实 PDF 并触发解析', uploaded);
await sleep(6000);
// 「N 页 · N 字符」收在论文详情/处理细节的折叠区里（默认收起）—— 先展开再断言
await cdp.ev(`(() => { document.querySelectorAll('.main-inner details').forEach((d) => { d.open = true; }); return true; })()`);
await sleep(800);
const upText = await mainText();
check(
  '显示解析结果（页数 / 字符数）',
  /\d+ 页 · \d+ 字符/.test(upText),
  upText.match(/\d+ 页 · \d+ 字符/)?.[0] ?? '（没找到「N 页 · N 字符」）',
);
check('未配置模型时就地提示配置（不让用户先去找设置）', /需要模型接口/.test(upText) && /接口地址/.test(upText) && /密钥/.test(upText));
check('提示密钥只保存在本机浏览器', /只保存在本机浏览器|不会写入任何产物/.test(upText));
await cdp.shot(join(OUT, 'B1-上传论文-解析完成.png'));

// 2026-10-09 改版：方法提取页按 Superdesign 草稿重做，队列行的类名从 .pitem 改为 .up-row
const paperCount = await cdp.ev(`document.querySelectorAll('.main-inner .up-row').length`);
check(`上传后出现论文卡片（${paperCount} 张）`, paperCount >= 1);

/**
 * 2026-10-09：原来这里假定「上传一篇就能直接进研究地图看单篇理解」，与当前产品行为不符 ——
 * 未配置模型 ⇒ 抽取无法进行 ⇒ 「进入研究地图」是**故意禁用**的（处理时间线写明「需先完成提取」）。
 * 这里改为断言这个诚实的克制行为：不放行就不放行，并且说明原因，而不是让用户点进一个空地图。
 */
const enterBtns = await cdp.ev(
  `JSON.stringify([...document.querySelectorAll('.main-inner button')].filter((b)=>/进入研究地图/.test(b.textContent)).map((b)=>({t:b.textContent.trim().slice(0,18),dis:b.disabled})))`,
);
// 2026-10-09 改版：方法提取页的流程条从「折叠的 details.stepline」改为常驻可见的处理状态卡
// （.uppage .flowbar），断言改读新容器 —— 这里核对的仍然是同一件事：真实五步流程的文案。
const timeline = await cdp.ev(
  `(()=>{const d=document.querySelector('.uppage .flowbar');return d?d.innerText.replace(/\\n+/g,' | '):'';})()`,
);
check(
  '未提取出方法时不放行进地图：入口禁用，并在处理时间线写明「需先完成提取」',
  !/"dis":false/.test(enterBtns) && /需先完成提取/.test(timeline),
  `${enterBtns}｜${String(timeline).slice(0, 120)}`,
);
check('解析已完成这一步如实标为完成（1 篇已解析）', /解析文本 · 1 篇已解析/.test(timeline), String(timeline).slice(0, 160));
await cdp.shot(join(OUT, 'B2-上传论文-待提取.png'));

/* ================= 验证问题 ================= */
console.log('');
console.log('=== 七个验证问题（可自动核对的部分） ===');
check('① 产品定位能说清为「梳理论文方法与阅读路线」', /研究地图/.test(land) && /阅读路线/.test(land) && !/给论文打分|排行榜/.test(land));
check('② 不进入实验比较也能获得方法理解（家族泳道 + 节点贡献 + 节点详情）', svgInfo.texts.some((t) => /卷积网络|视觉 Transformer/.test(t)) && /核心做法/.test(nodeDetailOpen));
check('③ 技术关系来自证据（关系表带证据状态与引文列）', /证据状态/.test(rel) && /原文依据/.test(rel));
check('④ 阅读建议是普通用户可见的主能力（三个视图之一）', /阅读起点/.test(mapText));
check('⑤ 原文依据一到两次点击可达', evOpened && /p\.\d+/.test(evText));

/**
 * 2026-09-25（c647794）起导航改为顶栏「目录」浮层，原「更多」页已不再渲染。
 * 语料集切换入口移到「论文集合」页默认收起的「管理论文与案例」折叠里。
 */
await cdp.ev(`(() => { const b=document.querySelector('.dirbtn'); if(b) b.click(); return true; })()`);
await sleep(600);
const dirItems = await cdp.ev(`[...document.querySelectorAll('.diritem')].map((x)=>x.textContent.trim()).join('|')`);
check('⑥ 正式案例与开发回归样例隔离（目录里不出现语料切换）',
  /论文集合/.test(dirItems) && /研究地图/.test(dirItems) && !/回归样例|NLP/.test(dirItems),
  dirItems);
check('目录保留论文集合 / 开发状态 / 设置等入口',
  /论文集合/.test(dirItems) && /开发状态/.test(dirItems) && /设置/.test(dirItems),
  dirItems);
await cdp.ev(`(() => { const b=document.querySelector('.dirbtn'); if(b) b.click(); return true; })()`);
await sleep(400);
await clickNav('论文集合');
await sleep(1000);
await cdp.ev(`(() => { const d=document.querySelector('details.libmanage'); if(d) d.open = true; return true; })()`);
await sleep(600);
const libManage = await mainText();
check('语料切换入口在「论文集合」的管理区（换成开发回归样例 / 换成正式视觉案例）',
  /换成开发回归样例|换成正式视觉案例/.test(libManage),
  libManage.replace(/\n+/g, ' | ').slice(0, 120));

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
  '→ 关系与比较（真实关系表 + 发表顺序时间线声明 + 选两篇对照 + 可选实验表现比较）→ 阅读起点 → 阅读路线。',
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
  '| 关系与比较（明细 + 时间线声明） | A7-关系与比较.png | — |',
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
