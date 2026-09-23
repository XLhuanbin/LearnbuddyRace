/**
 * 验收：语料状态与加载流程（对应用户给出的 A / B / C 三条路径）。
 *
 * A. 空状态：新会话打开 → 加载一次 → 数量正确
 * B. 重复加载：连续点击 / 刷新后再加载 → 不重复增加论文与实验记录
 * C. 旧数据：注入历史（无 corpusId 的 NLP 记录）→ 归位为「其它语料集」而非混入正式案例；
 *    可清理；清理后数量不变
 *
 * 只通过界面点击与 IndexedDB 读取验证，不修改任何数据文件。
 *
 * 用法：node scripts/verify-corpus-state.mjs [--url https://...]
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

const profile = join(ROOT, '.build', `chrome-corpus-${Date.now()}`);
await mkdir(profile, { recursive: true });
const child = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=9933', '--user-data-dir=' + profile, '--window-size=1440,960', url], { stdio: 'ignore' });
let ver;
for (let i = 0; i < 60; i++) {
  try {
    ver = await (await fetch('http://127.0.0.1:9933/json/version')).json();
    break;
  } catch {
    await sleep(300);
  }
}
const list = await (await fetch('http://127.0.0.1:9933/json/list')).json();
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
const cdp = new Cdp(ws);
await cdp.send('Runtime.enable');
await sleep(3200);

const clickNav = (name) =>
  cdp.ev(`(() => { const b=[...document.querySelectorAll('button.nav')].find((x)=>x.textContent.includes(${JSON.stringify(name)})); if(!b) return false; b.click(); return true; })()`);
const clickText = (name) =>
  cdp.ev(`(() => { const b=[...document.querySelectorAll('button')].find((x)=>x.textContent.includes(${JSON.stringify(name)})); if(!b) return false; b.click(); return true; })()`);

/** 从「更多」页读取当前论文集合的数量（导航本轮起不显示数字） */
const navCount = async () => {
  await clickNav('更多');
  await sleep(900);
  const t = await cdp.ev(`(document.querySelector('.main-inner') || document.body).innerText`);
  const num = (re) => {
    const m = re.exec(t);
    return m ? Number(m[1]) : null;
  };
  return {
    papers: num(/(\d+)\s*篇论文/),
    experiments: num(/(\d+)\s*条结果/),
    relations: num(/(\d+)\s*条方法关系/),
    raw: String(t).replace(/\n/g, ' | ').slice(0, 160),
  };
};

/** 走「更多 → 论文库」，点加载按钮 */
const loadFromLibrary = async (label) => {
  await clickNav('更多');
  await sleep(900);
  await clickText('论文库');
  await sleep(1200);
  const ok = await clickText(label);
  await sleep(3200);
  return ok;
};

const idb = () =>
  cdp.ev(`
new Promise((resolve) => {
  const req = indexedDB.open('researchpilot');
  req.onsuccess = () => {
    const db = req.result;
    const names = [...db.objectStoreNames];
    const out = {};
    let left = names.length;
    if (!left) return resolve(out);
    names.forEach((n) => {
      const c = db.transaction(n, 'readonly').objectStore(n).count();
      c.onsuccess = () => { out[n] = c.result; if (--left === 0) resolve(out); };
      c.onerror = () => { if (--left === 0) resolve(out); };
    });
  };
  req.onerror = () => resolve({ error: 'open failed' });
})`);



/* ---------------- A. 空状态首次加载 ---------------- */
console.log('');
console.log('=== A. 空状态：新会话加载一次 ===');
check('加载前计数为 0', JSON.stringify(await navCount()).includes('"papers":0') || (await navCount()).papers === null, JSON.stringify(await navCount()));
await clickText('体验视觉论文案例');
await sleep(5000);
const a1 = await navCount();
check(`加载后论文数 = 5（实际 ${a1.papers}）`, a1.papers === 5);
check(`加载后实验记录 = 23（实际 ${a1.experiments}）`, a1.experiments === 23);
check(`加载后关系数 = 10（实际 ${a1.relations}）`, a1.relations === 10);
const aIdb = await idb();
check(`IndexedDB 论文 5 篇（实际 ${aIdb.papers}）`, aIdb.papers === 5);
check(`IndexedDB 方法 5 条（实际 ${aIdb.methods}）`, aIdb.methods === 5);
check(`IndexedDB 关系 10 条（实际 ${aIdb.relations}）`, aIdb.relations === 10);

/* ---------------- B. 重复加载 ---------------- */
console.log('');
console.log('=== B. 重复加载（首页 / 论文库 / 实验比较 各点一次 + 刷新后再点）===');
await loadFromLibrary('重新加载演示案例');
await loadFromLibrary('重新加载演示案例');
const reloadExpBtn = await loadFromLibrary('重新加载演示案例');
const b1 = await navCount();
check(`三次重复加载后论文数仍为 5（实际 ${b1.papers}）`, b1.papers === 5);
check(`三次重复加载后实验记录仍为 23（实际 ${b1.experiments}）`, b1.experiments === 23);
const bIdb = await idb();
check(`IndexedDB 未累积（papers=${bIdb.papers}, methods=${bIdb.methods}, relations=${bIdb.relations}）`, bIdb.papers === 5 && bIdb.methods === 5 && bIdb.relations === 10);

await cdp.send('Page.reload', {});
await sleep(4000);
await loadFromLibrary('重新加载演示案例');
const b2 = await navCount();
check(`刷新后再加载一次仍为 5 篇 / 23 条（实际 ${b2.papers} / ${b2.experiments}）`, b2.papers === 5 && b2.experiments === 23);
const bIdb2 = await idb();
check(`IndexedDB 仍未累积（papers=${bIdb2.papers}）`, bIdb2.papers === 5 && bIdb2.methods === 5);

/* ---------------- C. 旧数据（无 corpusId） ---------------- */
console.log('');
console.log('=== C. 注入历史数据（无 corpusId 的 NLP 记录）后重新打开 ===');
await cdp.ev(`
new Promise((resolve) => {
  const req = indexedDB.open('researchpilot');
  req.onsuccess = () => {
    const db = req.result;
    const paper = {
      id: 'p_arxiv_1810.04805',
      title: 'BERT: Pre-training of Deep Bidirectional Transformers（历史数据，无 corpusId）',
      authors: [], source: { url: 'https://arxiv.org/abs/1810.04805', kind: 'arxiv' },
      pages: [], rawText: 'legacy', charCount: 6, pageCount: 1, parseStatus: 'ok', cached: true,
    };
    const method = {
      id: 'm_p_arxiv_1810.04805', paperId: 'p_arxiv_1810.04805', fields: {}, conditions: {}, overrides: [], cached: true,
    };
    const tx = db.transaction(['papers', 'methods'], 'readwrite');
    tx.objectStore('papers').put(paper);
    tx.objectStore('methods').put(method);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
  };
  req.onerror = () => resolve(false);
})`);
await cdp.send('Page.reload', {});
await sleep(4200);
const c1 = await navCount();
check(
  `历史 NLP 记录未混入正式案例计数（论文数仍为 5，实际 ${c1.papers}）`,
  c1.papers === 5,
  c1.raw,
);
await clickText('论文库');
await sleep(1400);
const libText = await cdp.ev(`(document.querySelector('.main-inner') || document.body).innerText`);
check('论文库明确提示存在其它语料集的数据', /检测到其它语料集的数据/.test(libText));
check('并提供「切换」与「清理」两个动作', /切换到/.test(libText) && /清理这些数据/.test(libText));
const migrated = await cdp.ev(`
new Promise((resolve) => {
  const req = indexedDB.open('researchpilot');
  req.onsuccess = () => {
    const tx = req.result.transaction('papers', 'readonly');
    const g = tx.objectStore('papers').get('p_arxiv_1810.04805');
    g.onsuccess = () => resolve(g.result ? g.result.corpusId || '(空)' : '(不存在)');
    g.onerror = () => resolve('(读取失败)');
  };
  req.onerror = () => resolve('(打开失败)');
})`);
check(`历史记录已被归位标记为 nlp-dev（实际 ${migrated}）`, migrated === 'nlp-dev');

const beforeClear = await navCount();
await clickNav('更多');
await sleep(900);
await clickText('论文库');
await sleep(1200);
await clickText('清理这些数据');
await sleep(1600);
const afterClear = await navCount();
check(
  `清理后正式案例数量不变（${beforeClear.papers} → ${afterClear.papers}）`,
  afterClear.papers === beforeClear.papers && afterClear.experiments === beforeClear.experiments,
);
const cIdb = await idb();
check(`清理后 IndexedDB 只保留当前语料（papers=${cIdb.papers}, methods=${cIdb.methods}）`, cIdb.papers === 5 && cIdb.methods === 5);

/* ---------------- 切换往返（不叠加） ---------------- */
console.log('');
console.log('=== 附加：切换到回归样例再切回（不能叠加） ===');
await clickNav('更多');
await sleep(900);
await clickText('切换到开发回归样例');
await sleep(1500);
await loadFromLibrary('加载演示案例');
const nlp = await navCount();
check(`NLP 语料计数为 5 篇（实际 ${nlp.papers}）`, nlp.papers === 5);
await clickNav('更多');
await sleep(900);
await clickText('切换到正式视觉案例');
await sleep(1500);
await loadFromLibrary('加载演示案例');
const back = await navCount();
check(`切回视觉案例仍为 5 篇 / 23 条（实际 ${back.papers} / ${back.experiments}）`, back.papers === 5 && back.experiments === 23);
const fIdb = await idb();
check(`切换往返后 IndexedDB 未累积（papers=${fIdb.papers}, methods=${fIdb.methods}）`, fIdb.papers === 5 && fIdb.methods === 5);

check('无未处理前端异常', cdp.errors.filter((e) => !/favicon/i.test(e)).length === 0, cdp.errors.slice(0, 1).join(''));

ws.close();
child.kill();
staticSrv?.server.close();
console.log('');
console.log(`结果：通过 ${pass}，失败 ${fail}`);
if (failures.length) failures.forEach((f) => console.log('  - ' + f));
process.exit(fail ? 1 : 0);
