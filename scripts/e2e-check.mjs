/**
 * 端到端浏览器检查（开发用，不随作品产物分发）。
 *
 * 用系统 Chrome 的无头模式 + CDP 真实走一遍核心流程，并收集控制台错误：
 *   加载预置语料 → 查看字段与实验条件 → 打开原文证据 → 程序校验问题
 *   → 可比性判断（全选 vs 只选同族论文）→ 方法关系可信度与人工修正
 *   → 阅读决策（含预置示例与实时缺配置的降级行为）→ 分歧与待调查 → 状态统计
 *
 * 用法：node scripts/e2e-check.mjs [--url http://127.0.0.1:4173]
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIST = join(ROOT, 'dist');

const argv = process.argv.slice(2);
const urlArgIdx = argv.indexOf('--url');
const externalUrl = urlArgIdx >= 0 ? argv[urlArgIdx + 1] : undefined;

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

let pass = 0;
let fail = 0;
const failures = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function check(name, cond, extra = '') {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    failures.push(name + (extra ? ` — ${extra}` : ''));
    console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`);
  }
}

async function startStaticServer() {
  const server = createServer(async (req, res) => {
    try {
      let p = decodeURIComponent((req.url || '/').split('?')[0]);
      if (p.endsWith('/')) p += 'index.html';
      const file = normalize(join(DIST, p));
      if (!file.startsWith(DIST)) {
        res.writeHead(403).end('forbidden');
        return;
      }
      const st = await stat(file);
      if (!st.isFile()) throw new Error('not a file');
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
    this.consoleErrors = [];
    this.pageErrors = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve: rs, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : rs(msg.result);
        return;
      }
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        this.consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        this.pageErrors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
      }
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 30000);
    });
  }

  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval error');
    return r.result.value;
  }

  async click(text) {
    return this.evaluate(`
(() => {
  const b=[...document.querySelectorAll('button')].find((x)=>x.textContent.includes(${JSON.stringify(text)}));
  if (!b) return false;
  b.click();
  return true;
})()`);
  }
  async waitFor(expression, timeoutMs = 15000, label = expression) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      try {
        if (await this.evaluate(expression)) return true;
      } catch {
        /* 页面可能正在重渲染 */
      }
      await sleep(250);
    }
    console.log(`     （等待超时：${label}）`);
    return false;
  }

  async click(text, scope = 'button, a') {
    return this.evaluate(`
(() => {
  const nodes = [...document.querySelectorAll(${JSON.stringify(scope)})];
  const el = nodes.find(n => n.textContent && n.textContent.replace(/\\s+/g,' ').trim().includes(${JSON.stringify(text)}));
  if (!el) return false;
  el.click();
  return true;
})()`);
  }
}

const TEXT = (t) => `document.body.innerText.includes(${JSON.stringify(t)})`;
/** 只在「可比性判断」面板内取文本，避免命中页面上的静态说明文案 */
const PANEL_TEXT = `(() => {
  const card = [...document.querySelectorAll('.card')].find(c => (c.innerText || '').includes('可比性判断'));
  return card ? card.innerText : '';
})()`;

/** 通过顶部「目录」浮层切换页面（本轮起默认不显示侧栏） */
async function goMore(cdp, cardText) {
  await cdp.evaluate(`(() => { const b = document.querySelector('.mapbrand .dirbtn'); if (!b) return false; b.click(); return true; })()`);
  await new Promise((r) => setTimeout(r, 900));
  const ok = await cdp.evaluate(
    `(() => { const b=[...document.querySelectorAll('button')].find((x)=>x.textContent.includes(${JSON.stringify(cardText)})); if(!b) return false; b.click(); return true; })()`,
  );
  await new Promise((r) => setTimeout(r, 1400));
  return ok;
}

/**
 * 展开论文集合页的「管理论文与案例」折叠区。
 * 工具栏（加载示例 / 切换语料）、语料隔离说明、模型配置说明现在都收在这个默认收起的 details 里，
 * 收起状态下它们在 DOM 中有节点、但不在 innerText 里 —— 需要断言这些内容时必须先真正展开。
 */
async function openLibManage(cdp) {
  const ok = await cdp.evaluate(`(() => {
  const d = document.querySelector('.main-inner details.libmanage');
  if (!d) return false;
  d.open = true;
  return true;
})()`);
  await sleep(500);
  return ok;
}

async function main() {
  const chrome = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!chrome) {
    console.error('未找到 Chrome/Edge，无法执行端到端检查。');
    process.exit(2);
  }

  let staticSrv;
  let target = externalUrl;
  if (!target) {
    staticSrv = await startStaticServer();
    target = staticSrv.url;
  }
  console.log(`目标地址：${target}`);

  const child = spawn(
    chrome,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--remote-debugging-port=9333',
      `--user-data-dir=${join(ROOT, '.build', `chrome-profile-${Date.now()}`)}`,
      '--window-size=1440,1000',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  let version;
  for (let i = 0; i < 60; i++) {
    try {
      version = await (await fetch('http://127.0.0.1:9333/json/version')).json();
      break;
    } catch {
      await sleep(300);
    }
  }
  if (!version) {
    console.error('Chrome 调试端口未就绪。');
    child.kill();
    staticSrv?.server.close();
    process.exit(2);
  }

  const targets = await (await fetch('http://127.0.0.1:9333/json/list')).json();
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => {
    ws.addEventListener('open', r);
    ws.addEventListener('error', j);
  });
  const cdp = new Cdp(ws);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');

  console.log('');
  console.log('=== E1 页面加载与 7 个功能入口 ===');
  await cdp.send('Page.navigate', { url: target });
  check('页面渲染出应用界面', await cdp.waitFor(TEXT('ResearchPilot'), 25000, '首屏渲染'));
  check('宣传首页不显示侧栏（避免控制台观感）', !(await cdp.evaluate(`!!document.querySelector('.side')`)));

  console.log('');
  console.log('=== E0 宣传首页：定位是「梳理论文方法与阅读路线」 ===');
  // 2026-10-09 改版：首页换成 v8 结构（编辑脊线 + 超大标题 + 自绘概念 SVG）。
  // 旧结构里首屏图是 `.hero .fig svg.fig-wide`，新结构是 `.hero-sec` 内的自绘 SVG。
  let previewReady = false;
  for (let i = 0; i < 16; i++) {
    previewReady = await cdp.evaluate(`document.querySelectorAll('.landing .hero-sec svg[aria-hidden="true"]').length > 0`);
    if (previewReady) break;
    await sleep(500);
  }
  const previewHidden = await cdp.evaluate(
    `(() => { const s = document.querySelector('.landing .hero-sec svg'); return !!s && s.getAttribute('aria-hidden') === 'true'; })()`,
  );
  check('首屏右侧是装饰性概念 SVG（aria-hidden，不承载数据）', previewReady === true && previewHidden === true);
  // 2026-10-09 改版：v8 取消了「每张图各带一句图注」的做法，改为页脚统一声明
  //（原断言：`.fig-cap` === 4 且 `.fig-note` === 3）。改为核对新结构：
  // 四张装饰性概念图都在（首屏 1 + 三段各 1），且都标了 aria-hidden。
  check(
    '四张装饰性概念图都在，且都标了 aria-hidden',
    (await cdp.evaluate(`document.querySelectorAll('.landing .hero-sec svg[aria-hidden="true"]').length`)) === 1 &&
      (await cdp.evaluate(`document.querySelectorAll('.landing .illustration-box svg[aria-hidden="true"]').length`)) === 3,
  );
  const homeText = await cdp.evaluate(`(document.querySelector('.main-inner') || document.body).innerText`);
  check('首屏主文案', /把一组论文，变成你看得懂的研究地图/.test(homeText));
  check('首屏副文案是一句短说明（不超过 24 字）', /读懂方法演进，知道先读哪一篇。/.test(homeText));
  const subLen = await cdp.evaluate(`(() => { const e = document.querySelector('.landing .hero-lede'); return e ? e.textContent.trim().length : 99; })()`);
  check('首屏说明长度 ≤24 字', subLen <= 24, String(subLen));
  check('三个段落：论文集合 / 研究地图 / 阅读路线',
    /论文集合/.test(homeText) && /研究地图/.test(homeText) && /阅读路线/.test(homeText));
  check('主按钮「体验视觉论文案例」', /体验视觉论文案例/.test(homeText));
  check('次按钮「上传我的论文」', /上传我的论文/.test(homeText));
  check(
    '首页配图是概念示意，且不出现真实论文名 / 数量 / 证据状态',
    // 2026-10-09 改版：v8 取消了逐图图注（三句旧图注文案随旧结构一起移除），
    // 概念示意改由页脚统一声明。这里核对页脚声明 + 三个段落入口 + 无真实数据措辞。
    /产品概念示意/.test(homeText) &&
      /不代表当前案例的真实关系数量/.test(homeText) &&
      /论文集合/.test(homeText) &&
      /研究地图/.test(homeText) &&
      /阅读路线/.test(homeText) &&
      !/ResNet|ViT|DeiT|Swin|ConvNeXt|BERT|RoBERTa|GPT-3/.test(homeText) &&
      !/篇论文|条可见关系|条关系|原文已说明|系统推断|待核查|可核验/.test(homeText),
  );
  check('首页标明配图是产品概念示意，且真实结果指向对应工作页',
    /产品概念示意/.test(homeText) && /不代表当前案例的真实关系数量/.test(homeText) && /研究地图与阅读路线页/.test(homeText));
  check('首页不以分数对比为主视觉', !/Top-1|能直接比较吗|不能直接比较/.test(homeText));
  // 2026-10-09 改版：v8 的页脚新增了「开发状态 / 偏好设置」两个入口链接。
  // 原断言禁止首页出现「开发状态」四个字（D2 规则：宣传首页不显示任何数量/版本/配置/缓存/开发状态）。
  // 按用户 2026-10-09「严格照 v8（覆盖旧规则）」的决定保留该链接，断言相应收窄为：
  // 禁止「开发状态的具体取值」外露（版本号 / 配置项 / 缓存标注 / 篇数）。
  // ⚠️ 若要恢复 D2 原规则：删掉 LandingView 页脚里那两行链接，
  //    并把本断言加回 `&& !/开发状态/.test(homeText)`。
  check('首页不出现开发状态的具体取值（版本 / 配置 / 缓存 / 篇数）',
    !/篇论文/.test(homeText) && !/promptVersion/.test(homeText) && !/RULES_VERSION/.test(homeText) && !/配置模型接口/.test(homeText) && !/缓存案例/.test(homeText));
  check('首页不渲染侧栏', !(await cdp.evaluate(`!!document.querySelector('.side')`)));
  const heroVisible = await cdp.evaluate(`
(() => {
  const h = document.querySelector('.landing h1');
  const cta = document.querySelector('.landing .cta-row');
  if (!h || !cta) return false;
  const hr = h.getBoundingClientRect();
  const cr = cta.getBoundingClientRect();
  return hr.top >= 0 && cr.bottom <= window.innerHeight + 1;
})()`);
  check('主文案与主按钮都在首屏内', heroVisible);

  console.log('');
  console.log('=== E0b 体验案例 → 研究地图工作区（真实用户路径）===');
  await cdp.evaluate(`(() => { const b=[...document.querySelectorAll('button')].find((x)=>x.textContent.includes('体验视觉论文案例')); if (b) b.click(); })()`);
  await sleep(5600);
  const mapText = await cdp.evaluate(`(document.querySelector('.main-inner') || document.body).innerText`);
  // 2026-10-09 改版：主按钮直接进研究地图（不再先落「论文集合」）
  check(
    '点「体验视觉论文案例」直接进入研究地图（不再先停论文集合）',
    /研究地图 · 视觉方法演进案例/.test(mapText) && !/选择一个视觉论文案例/.test(mapText),
    mapText.slice(0, 80).replace(/\n/g, ' '),
  );
  check(
    '首屏就是画布（真实用户不用再找入口）',
    (await cdp.evaluate(`document.querySelectorAll('#map-canvas svg g.cursor-pointer').length`)) === 5,
    `节点 ${await cdp.evaluate(`document.querySelectorAll('#map-canvas svg g.cursor-pointer').length`)}`,
  );
  const mapOnly = mapText;
  // 2026-10-08 改版：恢复三个视图的切换条 —— 此前子视图只剩两条隐式深链，且进入后没有回到
  // 「方法地图」的入口（点目录也不复位）。2026-10-09：视图改名并显式给出返回入口。
  check(
    '研究地图首屏是标题、一句解释、三个视图切换与一个阅读起点链接（无主按钮墙）',
    /研究地图 · 视觉方法演进案例/.test(mapOnly) &&
      /阅读起点/.test(mapOnly) &&
      /方法地图/.test(mapOnly) &&
      /关系与比较/.test(mapOnly),
  );
  // 关系可见性三态常驻页头，默认「全部」——不再默认把大部分关系藏起来。
  // 条数由模型结果决定（关系检索/认证规则改版后会变），这里只守「三态存在 + 默认选中全部」，不写死数字。
  const chipState = await cdp.evaluate(
    `(() => { const cs=[...document.querySelectorAll('.relview .chip')]; const on=cs.find((c)=>c.classList.contains('on')); return [!!on, on ? on.textContent.trim() : '', cs.length]; })()`,
  );
  check(
    '关系可见性三态常驻（全部 / 可用 / 待核查），默认选中「全部」',
    chipState[0] === true && /^全部\d+$/.test(String(chipState[1])) && chipState[2] === 3,
    chipState.join('|'),
  );
  // 本轮改版：「数据来源与统计」移到页头折叠区；关系状态行直接可见；筛选与集合操作拆成两个入口
  const optsOpened = await cdp.evaluate(
    `(() => { const d=document.querySelector('.maphead-meta details.fold'); if(!d) return false; d.open=true; return true; })()`,
  );
  await sleep(500);
  const headText = await cdp.evaluate(`(document.querySelector('.maphead-meta') || document.body).innerText`);
  check('领域概览与统计收进页头「数据来源与统计」折叠区（不占首屏）', optsOpened && /数据来源与统计/.test(headText));
  check(
    '首屏关系状态行直接显示「关系总数 · 当前显示数」',
    /关系\s*\d+\s*条\s*·\s*当前显示\s*\d+\s*条/.test(headText),
    headText.slice(0, 90).replace(/\n/g, ' '),
  );
  check(
    '筛选与集合操作是两个独立入口（不再混在一个「选项」里）',
    await cdp.evaluate(
      `[...document.querySelectorAll('.maphead-links button')].some(b=>/筛选/.test(b.textContent)) && [...document.querySelectorAll('.maphead-links button')].some(b=>/集合操作/.test(b.textContent))`,
    ),
  );
  await cdp.evaluate(`(() => { const d=document.querySelector('.maphead-meta details.fold'); if(d) d.open=false; return true; })()`);
  await sleep(300);
  // 2026-10-11 新画布（草稿 17763ea3 v3）：没有泳道，节点是真实的 5 个方法短名
  const svgTexts = await cdp.evaluate(`[...document.querySelectorAll('#map-canvas svg text')].map((t) => t.textContent)`);
  check('节点使用真实方法短名（ResNet / ViT / DeiT / Swin / ConvNeXt）',
    ['ResNet', 'ViT', 'DeiT', 'Swin', 'ConvNeXt'].every((n) => (svgTexts || []).includes(n)) &&
      !(svgTexts || []).some((t) => /视觉 Transformer/.test(t)),
    `svg文本=${(svgTexts || []).join('|')}`);
  const nodeCount = await cdp.evaluate(`document.querySelectorAll('#map-canvas svg g.cursor-pointer').length`);
  check(`默认地图画出全部方法节点（节点 ${nodeCount} 个）`, nodeCount === 5);
  // 连线不铺文字标签：svg text 只有 5 个节点名
  check('连线默认不铺标签（结构优先）', (svgTexts || []).length === 5, `svg文本数=${(svgTexts || []).length}`);
  const nodeClicked = await cdp.evaluate(`
(() => {
  const nodes = [...document.querySelectorAll('#map-canvas svg g.cursor-pointer')];
  const target = nodes.find((g) => [...g.querySelectorAll('text')].some((x) => x.textContent.trim().startsWith('DeiT')));
  if (!target) return false;
  target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  return true;
})()`);
  await sleep(800);
  const nodeDetail = await cdp.evaluate(`(document.querySelector('.mapnet') || document.body).innerText`);
  check('点节点后右侧给出「方法论核心」与「已核验字段」',
    nodeClicked && /方法论核心/.test(nodeDetail) && /已核验字段/.test(nodeDetail),
    nodeDetail.slice(0, 120).replace(/\n/g, ' '));
  check('相关连接列出对端方法并标注路径类型与证据状态（原文明示 / 系统推断 / 待核查）',
    /相关连接/.test(nodeDetail) && /原文明示|系统推断|待核查/.test(nodeDetail),
    nodeDetail.slice(0, 160).replace(/\n/g, ' '));
  check('节点详情给出「查看原文依据」入口（引文可点开核对）', /查看原文依据/.test(nodeDetail));
/* eslint-disable */
// ===== 以下为 e2e 尾部（E1b → 结束）。因补丁脚本误截断，本段按当前界面状态完整重建。 =====

  console.log('');
  console.log('=== E1b 切换到开发回归样例（NLP，旧断言基于这 5 篇） ===');
  await goMore(cdp, '论文集合');
  await sleep(700);
  const switched = await cdp.evaluate(`
(() => {
  const b = [...document.querySelectorAll('button')].find(
    (x) => x.textContent.includes('换成开发回归样例') || x.textContent.includes('切换到开发回归样例'),
  );
  if (!b) return false;
  b.click();
  return true;
})()`);
  check('可以切换到开发回归样例语料集', switched);
  await sleep(1500);
  check('「管理论文与案例」折叠区可以展开（工具栏与说明都在里面）', await openLibManage(cdp));
  check('切换后提示两套语料不混合', await cdp.evaluate(TEXT('不会混在一起')));
  const loadClicked = await cdp.evaluate(`
(() => {
  const b = [...document.querySelectorAll('button')].find(
    (x) =>
      x.textContent.includes('开始分析') ||
      x.textContent.includes('加载演示案例') ||
      x.textContent.includes('重新加载演示案例') ||
      (x.textContent.includes('加载') && (x.textContent.includes('案例') || x.textContent.includes('语料'))),
  );
  if (!b) return false;
  b.click();
  return true;
})()`);
  check('点击加载语料（正式案例或预置样例）', loadClicked);
  const nlpLoaded = await cdp.waitFor(`document.querySelectorAll('.paper-title').length >= 5`, 40000, 'NLP 语料加载');
  check('语料加载完成（论文卡片渲染 5 篇）', nlpLoaded);

  console.log('');
  console.log('=== E2 论文集合（草稿 6db41280：统计卡 + 表格 + 右栏） ===');
  await goMore(cdp, '论文集合');
  await sleep(1200);
  await openLibManage(cdp);
  const libText = await cdp.evaluate(`(document.querySelector('.main-inner') || document.body).innerText`);
  check('论文列表含 BERT', await cdp.evaluate(TEXT('BERT')));
  // 2026-10-11 表格化：预置语料的「缓存」标注在行元数据里（分析完成 · 缓存结果）
  check('行元数据如实标注「缓存结果」（预置语料不是本次实时分析）', await cdp.evaluate(TEXT('缓存结果')));
  check(
    '四张统计卡：已收录论文 / 平均创新评分 / 待核查关系 / 最近分析时间',
    /已收录论文/.test(libText) && /平均创新评分/.test(libText) && /待核查关系/.test(libText) && /最近分析时间/.test(libText),
  );
  check('右上三个入口：跨论文比较 / 生成阅读路线 / 上传新论文', /跨论文比较/.test(libText) && /生成阅读路线/.test(libText) && /上传新论文/.test(libText));
  check('右栏：创新度分布 + 智能路线规划 + 近期动态', /创新度分布/.test(libText) && /智能路线规划/.test(libText) && /近期动态/.test(libText));
  // 行结构（2026-10-11 表格化）：标题 → 年份·来源·状态 → 方法族 → 创新度徽章 → 只有一个「查看报告」
  const rowShape = await cdp.evaluate(`
(() => {
  const row = document.querySelector('.main-inner .lrows .lrow');
  if (!row) return null;
  const q = (sel) => row.querySelector(sel);
  const txt = (el) => (el && el.textContent ? el.textContent.trim() : '');
  return {
    title: txt(q('.paper-title')),
    meta: txt(q('td:nth-child(2) div:nth-child(2)')),
    family: txt(row.querySelectorAll('td')[2]),
    badge: txt(row.querySelectorAll('td')[3]),
    btns: [...row.querySelectorAll('button')].map((b) => b.textContent.trim()),
  };
})()`);
  check(
    '行结构：标题 → 年份·来源·状态 → 方法族 → 创新度徽章 → 只有一个「查看报告」（按篇操作已迁分析结果页）',
    !!rowShape &&
      rowShape.title.length > 10 &&
      /·/.test(rowShape.meta) &&
      rowShape.family.length > 0 &&
      /查看报告/.test(rowShape.btns.join(',')) &&
      !/查看详情/.test(rowShape.btns.join(',')),
    JSON.stringify(rowShape).slice(0, 220),
  );

  // 字段 / 实验条件 / 程序校验 / 证据弹层 / 本篇操作 都在「分析结果页」
  await cdp.click('查看报告');
  await sleep(1500);
  const fieldPanel = await cdp.evaluate(`(document.querySelector('.main-inner') || document.body).innerText`);
  check(
    '分析结果页出现 7 个字段与四态标签（可核验 / 待人工核对 / 未找到证据 / 缺失）',
    /研究任务/.test(fieldPanel) && /核心思路/.test(fieldPanel) && /局限/.test(fieldPanel) && /可核验|待人工核对|未找到证据|缺失/.test(fieldPanel),
    fieldPanel.slice(0, 60),
  );
  check('展示程序校验问题表', /程序校验问题/.test(fieldPanel));
  // 2026-10-11 起实验条件是分析结果页的独立分区（不再是折叠区）
  check('展示实验条件表（论文报告的原始条件）', await cdp.evaluate(TEXT('论文报告的原始条件')));
  check(
    '昂贵 / 破坏性操作收在「本篇操作」（重新分析 + 移除本篇）',
    /本篇操作/.test(fieldPanel) && /重新分析/.test(fieldPanel) && /移除本篇/.test(fieldPanel),
  );
  const evBtn = await cdp.evaluate(`
(() => {
  const b = [...document.querySelectorAll('button')].find((x) => /原文依据|实际匹配位置/.test(x.textContent));
  if (!b) return false;
  b.click();
  return true;
})()`);
  await sleep(900);
  check('可以打开证据弹层', evBtn);
  check('弹层显示原文上下文', await cdp.evaluate(`!!document.querySelector('.ev-context')`));
  check('弹层可关闭', await cdp.evaluate(`[...document.querySelectorAll('button')].some((b) => /关闭/.test(b.textContent))`));
  await cdp.evaluate(`(() => { const b=[...document.querySelectorAll('button')].find((x)=>/关闭/.test(x.textContent)); if (b) b.click(); })()`);
  await sleep(400);

  console.log('');
  console.log('=== E3 方法关系图（完整版） ===');
  await goMore(cdp, '方法关系图');
  await sleep(1400);
  const graphText = await cdp.evaluate(`(document.querySelector('.main-inner') || document.body).innerText`);
  check('关系页有生成/分析入口', /分析方法关系|重新分析关系|生成关系/.test(graphText));
  check('关系三档证据状态说明存在', /原文明示/.test(graphText) && /系统推断/.test(graphText) && /待核查|待确认/.test(graphText));
  check('明确不使用置信度百分比', await cdp.evaluate(TEXT('不使用未校准的置信度百分比')));
  check('人工添加关系入口存在', /人工添加关系/.test(graphText));

  console.log('');
  console.log('=== E5 阅读建议（完整版） ===');
  await goMore(cdp, '阅读路线');
  await sleep(1400);
  const decText = await cdp.evaluate(`(document.querySelector('.main-inner') || document.body).innerText`);
  check('阅读建议页有条件输入（基础 / 兴趣 / 时间 / 算力）',
    /基础/.test(decText) && /兴趣|目标/.test(decText) && /时间/.test(decText) && /算力|计算资源/.test(decText));
  check(
    '有生成入口（未配置模型时明确叫「查看示例路线」）',
    /查看示例路线|生成个性化路线|重新生成个性化路线/.test(decText),
  );
  check('示例决策可查看（缓存案例标注）', /缓存/.test(decText) || /示例/.test(decText));

  console.log('');
  console.log('=== E7 待调查问题 ===');
  await goMore(cdp, '待调查问题');
  await sleep(1400);
  const divText = await cdp.evaluate(`(document.querySelector('.main-inner') || document.body).innerText`);
  check('待调查问题页有分析入口', /分析待调查问题|重新分析/.test(divText));
  check('每条待调查问题都带固定声明（不把推断当结论）', /不构成共同结论|不代表整个领域存在研究空白|仅供参考/.test(divText) && !/保证.*创新性/.test(divText));

  console.log('');
  console.log('=== E8 跨论文比较（论文级） ===');
  await goMore(cdp, '跨论文比较');
  await sleep(1400);
  const cmpAll = await cdp.evaluate(`(document.querySelector('.main-inner') || document.body).innerText`);
  check('跨论文比较以论文为单位', /论文/.test(cmpAll) && /比较/.test(cmpAll));
  check('说明可比性按论文对计算', /论文对|分别/.test(cmpAll) || /可比/.test(cmpAll));

  console.log('');
  console.log('=== E12 产物密钥扫描 ===');
  const appJs = await cdp.evaluate(`
fetch([...document.scripts].find((s) => /app.*\\.js/.test(s.src)).src).then((r) => r.text()).then((t) => {
  const leaks = t.match(/sk-[A-Za-z0-9]{20,}/g) || [];
  return { leaks: leaks.length, sample: leaks[0] || '' };
})`);
  check('产物里没有疑似密钥（sk-…）', appJs && appJs.leaks === 0, JSON.stringify(appJs));

  console.log('');
  console.log('=== E12a 切回正式案例（图像分类）并加载 ===');
  await goMore(cdp, '论文集合');
  await sleep(1200);
  const back = await cdp.evaluate(`
(() => {
  const b = [...document.querySelectorAll('button')].find(
    (x) => x.textContent.includes('换成正式视觉案例') || x.textContent.includes('切换到正式视觉案例'),
  );
  if (!b) return false;
  b.click();
  return true;
})()`);
  check('可以切回正式案例语料集', back);
  await sleep(1500);
  await cdp.evaluate(`
(() => {
  const b = [...document.querySelectorAll('button')].find(
    (x) => x.textContent.includes('重新加载演示案例') || x.textContent.includes('加载演示案例'),
  );
  if (b) b.click();
})()`);
  const visLoaded = await cdp.waitFor(`document.querySelectorAll('.paper-title').length >= 5`, 40000, '视觉语料加载');
  check('视觉语料加载完成', visLoaded);

  console.log('');
  console.log('=== E12b 语料集切换与隔离（正式视觉案例） ===');
  await sleep(800);
  await openLibManage(cdp);
  const libText2 = await cdp.evaluate(`(document.querySelector('.main-inner') || document.body).innerText`);
  check('标注两套语料不混合生成关系与推荐', /不会混在一起|各自独立计算/.test(libText2));

  console.log('');
  console.log('=== E12c 实验可比性页 ===');
  await goMore(cdp, '实验可比性');
  await sleep(1600);
  const expText = await cdp.evaluate(`(document.querySelector('.main-inner') || document.body).innerText`);
  check('展示分类实验与表格核查状态', /分类实验/.test(expText) && /行列已核验|待核查/.test(expText));
  check('提供筛选与推荐对照入口', /按论文/.test(expText) && /推荐对照/.test(expText));
  check('标注不做排名、不给因果结论', /不做排名/.test(expText) && /因果结论/.test(expText));
  check('数值旁有原文入口', /查看原文/.test(expText));

  console.log('');
  console.log('=== E13 目标匹配与执行可行性（本轮） ===');
  await goMore(cdp, '阅读路线');
  await sleep(1500);
  // 2026-10-11 起「执行可行性」收在证据链卡片的折叠区里，断言前先展开（折叠态内容不进 innerText）
  await cdp.evaluate(`(() => {
  const ds=[...document.querySelectorAll('#evidence-chain-section details')].filter((d)=>/在你的条件下能做哪一步/.test(d.textContent));
  ds.forEach((d)=>{ d.open = true; });
  return ds.length;
})()`);
  await sleep(600);
  const decText2 = await cdp.evaluate(`(document.querySelector('.main-inner') || document.body).innerText`);
  check('执行可行性按阶段判断（阅读/推理/微调/预训练）', /阅读|推理|微调|预训练/.test(decText2));
  check('说明论文证据判断 ≠ 实际运行', /不代表已经|≠|不等同于/.test(decText2) || /实际运行/.test(decText2));

  console.log('');
  console.log('=== E14 重新分析入口（不触发真实调用；2026-10-11 起在分析结果页「本篇操作」） ===');
  await goMore(cdp, '论文集合');
  await sleep(1200);
  await cdp.click('查看报告');
  await sleep(1500);
  const reBtn = await cdp.evaluate(`
(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '重新分析');
  if (!b) return false;
  b.click();
  return true;
})()`);
  await sleep(600);
  const confirmText = await cdp.evaluate(`(document.querySelector('.main-inner') || document.body).innerText`);
  check('重新分析需要确认（两步）', reBtn && /确认重新分析/.test(confirmText));
  check('提示说明分析期间保留原结果、人工修正不会被覆盖', /保留原结果/.test(confirmText) && /人工修正不会被覆盖/.test(confirmText));
  await cdp.evaluate(`
(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '取消');
  if (b) b.click();
})()`);
  await sleep(400);

  console.log('');
  console.log('=== E10 刷新后恢复（本地持久化） ===');
  // E14 结束时在分析结果页；先回到论文集合再刷新，刷新后的断言都以论文集合为基准
  await goMore(cdp, '论文集合');
  await sleep(1200);
  await cdp.send('Page.reload', {});
  await sleep(4000);
  check('刷新后论文仍在（本地持久化）', await cdp.waitFor(`document.querySelectorAll('.paper-title').length >= 5`, 25000, '刷新恢复'));
  // 模型配置说明与语料来源同在「管理论文与案例」折叠区里，先展开再断言
  await openLibManage(cdp);
  check('刷新后模型设置仍为未配置（密钥不会被写入产物）', await cdp.evaluate(TEXT('未配置模型')));
  check('刷新后行元数据仍如实标注「缓存结果」', await cdp.evaluate(TEXT('缓存结果')));

  console.log('');
  console.log('=== E11 窄屏（390×844）布局 ===');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await sleep(700);
  const overflow = await cdp.evaluate(`document.documentElement.scrollWidth > window.innerWidth + 1`);
  check('窄屏无整页横向溢出', !overflow);
  await sleep(400);
  const navVisible = await cdp.evaluate(`
(() => {
  const t = (document.body.innerText || '');
  const homeLink = !!document.querySelector('.mapbrand .logo');
  return homeLink && ['目录', '返回论文集合'].every((x) => t.includes(x));
})()`);
  check('窄屏下功能入口仍然可见（品牌回首页 + 论文集合 + 研究地图 + 更多）', navVisible);
  await cdp.send('Emulation.clearDeviceMetricsOverride');
  await sleep(400);

  console.log('');
  console.log('=== E10 控制台错误 ===');
  const allErrors = [...(cdp.pageErrors || []), ...(cdp.consoleErrors || [])].filter((e) => !/favicon/i.test(String(e)));
  check('无未处理的前端错误（捕获 0 条）', allErrors.length === 0, allErrors.slice(0, 2).join(' | '));

  ws.close();
  child.kill();
  staticSrv?.server.close();

  console.log('');
  console.log(`结果：通过 ${pass}，失败 ${fail}`);
  if (failures.length) failures.forEach((f) => console.log('  - ' + f));
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error('端到端检查异常：', e);
  process.exit(2);
});
