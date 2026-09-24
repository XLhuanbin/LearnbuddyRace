/**
 * 回归验证：研究地图的「集合范围」
 * 场景：浏览器里同时存在
 *   ① 历史 NLP 记录（没有 corpusId）——应被归位到开发回归样例，绝不进视觉案例地图；
 *   ② 用户自己上传的论文（user-import，核心思路里写着 Transformer）——不能被当作视觉论文混进案例地图，
 *      也不能被命名为「视觉 Transformer」。
 * 期望：案例地图只显示视觉语料的 5 篇；用户论文可从「选项」切到「我上传的论文」单独查看。
 *
 * 用法：node scripts/verify-collection-scope.mjs [--url https://...]
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, readFile, stat } from 'node:fs/promises';
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
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.pdf': 'application/pdf' };

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
      setTimeout(() => this.pending.has(i) && (this.pending.delete(i), r({})), 45000);
    });
  }
  async ev(x) {
    const r = await this.send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
    return r?.result?.value;
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

const profile = join(ROOT, '.build', `chrome-scope-${Date.now()}`);
await mkdir(profile, { recursive: true });
const child = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=9944', '--user-data-dir=' + profile, '--window-size=1440,920', url], { stdio: 'ignore' });
let ver;
for (let i = 0; i < 60; i++) {
  try {
    ver = await (await fetch('http://127.0.0.1:9944/json/version')).json();
    break;
  } catch {
    await sleep(300);
  }
}
if (!ver) {
  console.error('Chrome 未就绪');
  process.exit(2);
}
const list = await (await fetch('http://127.0.0.1:9944/json/list')).json();
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
const cdp = new Cdp(ws);
await cdp.send('Runtime.enable');
await sleep(2800);

// 注入两类历史数据
await cdp.ev(`
new Promise((resolve) => {
  const req = indexedDB.open('researchpilot');
  req.onsuccess = () => {
    const db = req.result;
    const mk = (id, title, extra = {}) => ({
      id, title, authors: [], source: { kind: 'arxiv', url: 'https://arxiv.org/abs/' + id },
      pages: [], rawText: 'x', charCount: 1, pageCount: 1, parseStatus: 'ok', cached: true, ...extra,
    });
    const papers = [
      mk('p_arxiv_1810.04805', 'BERT: Pre-training of Deep Bidirectional Transformers（历史记录，无 corpusId）'),
      mk('p_own_bert', 'My Pasted NLP Paper（用户自己上传）', { corpusId: 'user-import', source: { kind: 'text' } }),
    ];
    const methods = [
      { id: 'm_p_arxiv_1810.04805', paperId: 'p_arxiv_1810.04805', fields: { methodName: { value: 'BERT' }, coreIdea: { value: '基于 Transformer 的双向语言模型预训练，用掩码语言建模。' } }, conditions: {}, overrides: [], cached: true },
      { id: 'm_p_own_bert', paperId: 'p_own_bert', fields: { methodName: { value: 'My NLP Method' }, coreIdea: { value: '基于 Transformer 的文本分类方法，用注意力做句级表示。' } }, conditions: {}, overrides: [], cached: true, corpusId: 'user-import' },
    ];
    const tx = db.transaction(['papers', 'methods'], 'readwrite');
    papers.forEach((p) => tx.objectStore('papers').put(p));
    methods.forEach((m) => tx.objectStore('methods').put(m));
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
  };
  req.onerror = () => resolve(false);
})`);
await cdp.send('Page.reload', {});
await sleep(4000);

console.log('');
console.log('=== 加载正式视觉案例（浏览器里已有 NLP 历史数据 + 用户上传的论文）===');
await cdp.ev(`(() => { const b=[...document.querySelectorAll('button')].find((x)=>x.textContent.includes('体验视觉论文案例')); if (b) b.click(); })()`);
await sleep(5200);

const state = await cdp.ev(`
(() => {
  const texts = [...document.querySelectorAll('svg text')].map((t) => t.textContent);
  const head = (document.querySelector('.maphead') || {}).innerText || '';
  return { texts, head: head.replace(/\\n/g, ' | ') };
})()`);
check('地图工具栏标明当前集合是视觉方法演进案例', /研究地图 · 视觉方法演进案例/.test(state.head), state.head);
check('案例论文数仍为 5 篇（不因历史/自传数据增加）', /5 篇/.test(state.head), state.head);
check('地图里没有出现 BERT（历史 NLP 记录已归位到回归样例）', !state.texts.some((t) => /BERT/i.test(t)), JSON.stringify(state.texts.slice(0, 6)));
check('地图里没有出现用户上传的论文', !state.texts.some((t) => /My NLP|My Pasted/i.test(t)));
const laneTexts = state.texts.filter((t) => /(CNN|架构|混合|待确认)/.test(t) && t.length < 24);
check(
  '泳道使用忠实的家族命名，未把语言模型称为「视觉 Transformer」',
  laneTexts.some((t) => /Transformer 架构/.test(t)) && !laneTexts.some((t) => /视觉 Transformer/.test(t)),
  JSON.stringify(laneTexts),
);

const opts = await cdp.ev(`
(async () => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('选项'));
  if (b) b.click();
  await new Promise((r) => setTimeout(r, 500));
  const t = (document.querySelector('.mapopts .pop') || document.body).innerText;
  return t.replace(/\\n/g, ' | ');
})()`);
check('「选项」里说明另有用户上传的论文，并提供查看入口', /另有 \d+ 篇我上传的论文/.test(opts) && /查看我上传的论文/.test(opts), opts.slice(0, 200));
check('「选项」里能看到数据来源与统计（二级入口）', /数据来源与统计/.test(opts));

const ownState = await cdp.ev(`
(async () => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('查看我上传的论文'));
  if (b) b.click();
  await new Promise((r) => setTimeout(r, 1000));
  const texts = [...document.querySelectorAll('svg text')].map((t) => t.textContent);
  const head = (document.querySelector('.maphead') || {}).innerText || '';
  return { texts, head: head.replace(/\\n/g, ' | ') };
})()`);
check('可以单独查看「我上传的论文」', /研究地图 · 我上传的论文/.test(ownState.head), ownState.head);
check('我上传的论文自己的方法出现在它自己的地图里', ownState.texts.some((t) => /My NLP Method|My Pasted/i.test(t)), JSON.stringify(ownState.texts.slice(0, 6)));
const ownEdgeCount = await cdp.ev(`[...document.querySelectorAll('svg path')].filter((p) => p.getAttribute('marker-end')).length`);
check(`没有为单篇用户论文编造跨论文关系（连线 ${ownEdgeCount} 条）`, ownEdgeCount === 0, String(ownEdgeCount));

const back = await cdp.ev(`
(async () => {
  const b = [...document.querySelectorAll('button')].find((x) => /回到/.test(x.textContent) && /视觉方法演进案例/.test(x.textContent));
  if (!b) return 'NO_BACK_BUTTON';
  b.click();
  await new Promise((r) => setTimeout(r, 900));
  return (document.querySelector('.maphead') || document.body).innerText.replace(/\\n/g, ' | ');
})()`);
check('可以回到视觉方法演进案例', /研究地图 · 视觉方法演进案例/.test(String(back)), String(back).slice(0, 120));

// 侧栏 / 页脚必须把两种计数分别说清楚（用户问过「10 篇 vs 5 篇分别统计什么」）
const badges = await cdp.ev(`[...document.querySelectorAll('.side.research .nav .badge')].map((b) => b.textContent)`);
const sideFoot = String((await cdp.ev(`(document.querySelector('.side.research .side-foot') || {}).innerText || ''`)) || '').replace(/\n/g, ' | ');
check('侧栏分别给出「论文集合」与「我上传的论文」的篇数', Array.isArray(badges) && String(badges[0]) === '5' && /^\d+$/.test(String(badges[1])), JSON.stringify(badges));
check('侧栏页脚写明案例与我上传各自的篇数', /案例 5 篇/.test(sideFoot) && /我上传 \d+ 篇/.test(sideFoot), sideFoot);

const idb = await cdp.ev(`
new Promise((resolve) => {
  const req = indexedDB.open('researchpilot');
  req.onsuccess = () => {
    const db = req.result;
    const c = db.transaction('papers', 'readonly').objectStore('papers').count();
    c.onsuccess = () => resolve(c.result);
    c.onerror = () => resolve(-1);
  };
  req.onerror = () => resolve(-2);
})`);
check(`用户论文与历史记录仍在 IndexedDB（不被清空，实际 ${idb} 篇）`, idb >= 6, String(idb));

check('无未处理前端异常', cdp.errors.filter((e) => !/favicon/i.test(e)).length === 0, cdp.errors.slice(0, 1).join(''));

ws.close();
child.kill();
staticSrv?.server.close();
console.log('');
console.log(`结果：通过 ${pass}，失败 ${fail}`);
if (failures.length) failures.forEach((f) => console.log('  - ' + f));
process.exit(fail ? 1 : 0);
