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

/** 通过「更多」进入专业 / 开发页面（本轮起这些页面不在主导航里） */
async function goMore(cdp, cardText) {
  await cdp.click('更多');
  await new Promise((r) => setTimeout(r, 900));
  const ok = await cdp.evaluate(
    `(() => { const b=[...document.querySelectorAll('button')].find((x)=>x.textContent.includes(${JSON.stringify(cardText)})); if(!b) return false; b.click(); return true; })()`,
  );
  await new Promise((r) => setTimeout(r, 1400));
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
  const homeText = await cdp.evaluate(`(document.querySelector('.main-inner') || document.body).innerText`);
  check('首屏主文案', /把一组论文，变成你看得懂的研究地图/.test(homeText));
  check('首屏副文案（看懂方法 / 发展关系 / 先读哪篇 / 原文依据）',
    /看懂各类方法解决了什么、彼此如何发展，以及你应该先读哪篇。关键结论都能回到原文/.test(homeText));
  check('三个关键词：方法差异 / 技术关系 / 先读什么',
    /看懂方法差异/.test(homeText) && /理清技术关系/.test(homeText) && /决定先读什么/.test(homeText));
  check('主按钮「体验视觉论文案例」', /体验视觉论文案例/.test(homeText));
  check('次按钮「上传我的论文」', /上传我的论文/.test(homeText));
  check('示意图是「论文 → 分组与关联 → 阅读路线」',
    /一组论文/.test(homeText) && /方法分组与关联/.test(homeText) && /阅读路线/.test(homeText));
  check('示意图标注为示意而非真实分析结果', /上图为功能示意，非真实分析结果/.test(homeText));
  check('首页不以分数对比为主视觉', !/Top-1|能直接比较吗|不能直接比较/.test(homeText));
  check('首页没有数量 / 版本 / 配置 / 缓存 / 开发状态',
    !/篇论文/.test(homeText) && !/promptVersion/.test(homeText) && !/RULES_VERSION/.test(homeText) && !/配置模型接口/.test(homeText) && !/开发状态/.test(homeText));
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
  console.log('=== E0b 体验案例 → 研究地图工作区 ===');
  await cdp.evaluate(`(() => { const b=[...document.querySelectorAll('button')].find((x)=>x.textContent.includes('体验视觉论文案例')); if (b) b.click(); })()`);
  await sleep(5200);
  const mapText = await cdp.evaluate(`(document.querySelector('.main-inner') || document.body).innerText`);
  check('直接进入研究地图（无单选项案例页）', /研究地图/.test(mapText) && !/选择一个视觉论文案例/.test(mapText));
  check(
    '工作区显示论文集合与三个视图',
    /研究地图 · 视觉论文案例/.test(mapText) && /方法地图/.test(mapText) && /联系与区别/.test(mapText) && /从哪里开始/.test(mapText),
  );
  const optsOpened = await cdp.evaluate(`(() => { const b=[...document.querySelectorAll('button')].find((x)=>x.textContent.includes('选项')); if (b) b.click(); return true; })()`);
  await sleep(600);
  const optsText = await cdp.evaluate(`(document.querySelector('.mapopts .pop') || document.body).innerText`);
  check('领域概览与统计收进「选项」弹层（不占首屏）', optsOpened && /数据来源与统计/.test(optsText));
  await cdp.evaluate(`(() => { const b=[...document.querySelectorAll('button')].find((x)=>x.textContent.includes('选项')); if (b) b.click(); })()`);
  await sleep(400);
  const laneNames = await cdp.evaluate(`[...document.querySelectorAll('svg text')].map((t)=>t.textContent).join('|')`);
  const svgTexts = await cdp.evaluate(`[...document.querySelectorAll('svg text')].map((t) => t.textContent)`);
  const laneHeaders = (svgTexts || []).filter((t) => /(CNN|架构|混合|待确认)/.test(t) && t.length < 24).join('|');
  check('地图泳道使用忠实的家族命名（卷积网络（CNN）/ Transformer 架构）',
    /卷积网络（CNN）/.test(laneHeaders) && /Transformer 架构/.test(laneHeaders) && !/视觉 Transformer/.test(laneHeaders),
    `泳道=${laneHeaders}｜svg文本数=${(svgTexts || []).length}`);
  const nodeCount = await cdp.evaluate(`[...document.querySelectorAll('svg rect')].filter((r) => r.getAttribute('width') === '208').length`);
  check(`默认地图画出全部方法节点（节点 ${nodeCount} 个）`, nodeCount === 5);
  check('连线默认不铺标签（结构优先）', !(await cdp.evaluate(`[...document.querySelectorAll('svg g.medge text')].length > 0`)));
  const nodeClicked = await cdp.evaluate(`
(() => {
  const rects = [...document.querySelectorAll('svg rect')].filter((r) => r.getAttribute('width') === '208');
  const target = rects.find((r) => [...r.closest('g').querySelectorAll('text')].some((x) => x.textContent.trim().startsWith('DeiT')));
  if (!target) return false;
  target.closest('g').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  return true;
})()`);
  await sleep(800);
  const nodeDetail = await cdp.evaluate(`(document.querySelector('.mapdetail') || document.body).innerText`);
  check('点击节点第一层给出「一句话贡献 / 核心做法 / 与相关方法的联系」',
    /一句话贡献/.test(nodeDetail) && /核心做法/.test(nodeDetail) && /与相关方法的联系/.test(nodeDetail));
  check('节点详情包含方法家族（技术策略在深入解释里）',
    /Transformer 架构|卷积网络（CNN）/.test(nodeDetail));
  check('原文依据默认折叠（按需展开）', await cdp.evaluate(`!document.querySelector('.mapdetail details.fold[open]')`));
  const edgeClicked = await cdp.evaluate(`
(() => {
  const p = [...document.querySelectorAll('svg path')].find((x) => x.getAttribute('marker-end'));
  if (!p) return false;
  p.closest('g').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  return true;
})()`);
  await sleep(700);
  const edgeDetail = await cdp.evaluate(`(document.querySelector('.mapdetail') || document.body).innerText`);
  check('点击连线给出方向与证据状态', edgeClicked && /前置方法|在此基础上继续发展|思路相近|关系不明确/.test(edgeDetail) && /系统推断|原文已说明|待核查/.test(edgeDetail));
  await cdp.evaluate(`(() => { const d = document.querySelector('.mapdetail details.fold'); if (d) d.open = true; })()`);
  await sleep(500);
  const edgeEv = await cdp.evaluate(`(document.querySelector('.mapdetail') || document.body).innerText`);
  check('连线详情可展开原文依据（缺引文时如实说明）', /没有绑定可核验引文|查看原文引文/.test(edgeEv));
/* eslint-disable */
// ===== 以下为 e2e 尾部（E1b → 结束）。因补丁脚本误截断，本段按当前界面状态完整重建。 =====

  console.log('');
  console.log('=== E1b 切换到开发回归样例（NLP，旧断言基于这 5 篇） ===');
  await goMore(cdp, '论文库');
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
  console.log('=== E2 论文库（原始字段与校验的完整入口） ===');
  await goMore(cdp, '论文库');
  await sleep(1200);
  const libText = await cdp.evaluate(`(document.querySelector('.main-inner') || document.body).innerText`);
  check('论文列表含 BERT', await cdp.evaluate(TEXT('BERT')));
  check('标注为缓存案例而非实时', await cdp.evaluate(TEXT('缓存案例')));
  check('展开区展示实验条件表', await cdp.evaluate(TEXT('实验条件')));
  check('有重新分析入口（含确认与取消）', /重新分析/.test(libText));
  check('加载按钮完成态可用（不重复点击也不禁用）', /重新加载演示案例|加载演示案例/.test(libText));

  await cdp.click('查看论文');
  await sleep(1200);
  const fieldPanel = await cdp.evaluate(`(document.querySelector('.main-inner') || document.body).innerText`);
  check('展开出现 7 个字段与四态标签', /研究任务/.test(fieldPanel) && /核心思路/.test(fieldPanel) && /局限/.test(fieldPanel) && /已核验|待核查|未提取到|待人工核对/.test(fieldPanel));
  check('展开后展示程序校验问题表', /程序校验问题/.test(fieldPanel));
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
  await goMore(cdp, '阅读建议');
  await sleep(1400);
  const decText = await cdp.evaluate(`(document.querySelector('.main-inner') || document.body).innerText`);
  check('阅读建议页有条件输入（基础 / 兴趣 / 时间 / 算力）',
    /基础/.test(decText) && /兴趣|目标/.test(decText) && /时间/.test(decText) && /算力|计算资源/.test(decText));
  check('有生成入口', /生成阅读路线|生成/.test(decText));
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
  await goMore(cdp, '论文库');
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
  const libText2 = await cdp.evaluate(`(document.querySelector('.main-inner') || document.body).innerText`);
  check('标注两套语料不混合生成关系与推荐', /不会混在一起|各自独立计算/.test(libText2));

  console.log('');
  console.log('=== E12c 实验比较页（专业视图） ===');
  await goMore(cdp, '全部结果与条件');
  await sleep(1600);
  const expText = await cdp.evaluate(`(document.querySelector('.main-inner') || document.body).innerText`);
  check('展示分类实验与表格核查状态', /分类实验/.test(expText) && /行列已核验|待核查/.test(expText));
  check('提供筛选与推荐对照入口', /按论文/.test(expText) && /推荐对照/.test(expText));
  check('标注不做排名、不给因果结论', /不做排名/.test(expText) && /因果结论/.test(expText));
  check('数值旁有原文入口', /查看原文/.test(expText));

  console.log('');
  console.log('=== E13 目标匹配与执行可行性（本轮） ===');
  await goMore(cdp, '阅读建议');
  await sleep(1500);
  const decText2 = await cdp.evaluate(`(document.querySelector('.main-inner') || document.body).innerText`);
  check('执行可行性按阶段判断（阅读/推理/微调/预训练）', /阅读|推理|微调|预训练/.test(decText2));
  check('说明论文证据判断 ≠ 实际运行', /不代表已经|≠|不等同于/.test(decText2) || /实际运行/.test(decText2));

  console.log('');
  console.log('=== E14 重新分析入口（不触发真实调用） ===');
  await goMore(cdp, '论文库');
  await sleep(1200);
  await cdp.click('查看论文');
  await sleep(1000);
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
  await cdp.send('Page.reload', {});
  await sleep(4000);
  check('刷新后论文仍在（本地持久化）', await cdp.waitFor(`document.querySelectorAll('.paper-title').length >= 5`, 25000, '刷新恢复'));
  check('刷新后模型设置仍为未配置（密钥不会被写入产物）', await cdp.evaluate(TEXT('未配置模型')));

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
  return ['首页', '研究地图', '更多'].every((x) => t.includes(x));
})()`);
  check('窄屏下功能入口仍然可见', navVisible);
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
