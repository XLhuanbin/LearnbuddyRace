/**
 * 本脚本随仓库提交（scripts/ 下），可直接在有 Chrome 的机器上运行；设 CHROME_PATH 可指定浏览器。
 *
 * 本轮修复的针对性验收（真实浏览器 + 真实 IndexedDB）。
 *
 * 覆盖 e2e 走查覆盖不到的三件事：
 *   1. 移除论文 → 该论文的方法与**关联关系**一起消失，且库里不存在悬挂关系；撤销后原样写回；
 *   2. 切换案例 → 上一个案例的阅读路线 / 分歧结果不再显示，且**刷新后仍然不显示**；
 *   3. 案例地图 → 每条连线的两端都属于当前案例的方法。
 *
 * 用独立的 Chrome profile（.build/ 下），不触碰用户自己的浏览器数据。
 * 用法：node .build/verify-scope.mjs
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync, mkdirSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);
const resolveChrome = () => {
  const hit = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!hit) {
    console.error('找不到 Chrome/Chromium 可执行文件：请设置 CHROME_PATH 环境变量后重试。');
    process.exit(2);
  }
  return hit;
};

const ROOT = resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const DIST = join(ROOT, 'dist');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };

const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent((req.url || '/').split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    const f = normalize(join(DIST, p));
    if (!f.startsWith(DIST)) return res.writeHead(403).end();
    const st = await stat(f);
    if (!st.isFile()) throw 0;
    res.writeHead(200, { 'Content-Type': MIME[extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(await readFile(f));
  } catch {
    res.writeHead(404).end('nf');
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = 'http://127.0.0.1:' + server.address().port + '/';

const CH = resolveChrome();
const profile = join(ROOT, '.build', 'scope-' + Date.now());
mkdirSync(profile, { recursive: true });
const child = spawn(CH, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=9477', '--user-data-dir=' + profile, '--window-size=1440,900', url], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 80; i++) { try { await (await fetch('http://127.0.0.1:9477/json/version')).json(); break; } catch { await sleep(300); } }
const list = await (await fetch('http://127.0.0.1:9477/json/list')).json();
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pending = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } });
const send = (method, params = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method, params })); return new Promise((r) => pending.set(i, r)); };
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
  if (r?.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval error');
  return r?.result?.value;
};
const click = (t, sel = 'button') =>
  ev(`(() => { const b=[...document.querySelectorAll(${JSON.stringify(sel)})].find((x)=>(x.textContent||'').replace(/\\s+/g,' ').trim().includes(${JSON.stringify(t)})); if(!b) return false; b.click(); return true; })()`);
const goMore = async (t) => { await ev(`(() => { const b=document.querySelector('.mapbrand .dirbtn'); if(b) b.click(); return true; })()`); await sleep(900); const ok = await click(t); await sleep(1500); return ok; };
const waitFor = async (expr, ms, label) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(expr)) return true; await sleep(300); } console.log(`   （等待超时：${label}）`); return false; };

let pass = 0; let fail = 0; const failures = [];
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}${extra ? ` 〔${extra}〕` : ''}`); }
  else { fail++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`); }
};

/** 从页面里读一个 IndexedDB store（走真实存储层，不读内存状态） */
const READ_STORE = (store) => `(async () => {
  const rows = await new Promise((res, rej) => {
    const req = indexedDB.open('researchpilot', 1);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(${JSON.stringify(store)}, 'readonly');
      const r = tx.objectStore(${JSON.stringify(store)}).getAll();
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    };
    req.onerror = () => rej(req.error);
  });
  return rows;
})()`;

const readMeta = (key) => `(async () => {
  const rows = await new Promise((res, rej) => {
    const req = indexedDB.open('researchpilot', 1);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction('meta', 'readonly');
      const r = tx.objectStore('meta').get(${JSON.stringify(key)});
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    };
    req.onerror = () => rej(req.error);
  });
  return rows ? rows.value : null;
})()`;

await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await sleep(3200);

console.log('=== S0 载入正式案例 ===');
await click('体验视觉论文案例');
await waitFor(`document.querySelectorAll('.paper-title').length >= 5`, 45000, '案例加载');
await sleep(1200);
const papers0 = await ev(READ_STORE('papers'));
const methods0 = await ev(READ_STORE('methods'));
const rels0 = await ev(READ_STORE('relations'));
check('案例载入后库里有论文/方法/关系', papers0.length === 5 && methods0.length === 5 && rels0.length > 0, `论文 ${papers0.length} / 方法 ${methods0.length} / 关系 ${rels0.length}`);

console.log('');
console.log('=== S0b 视觉案例的原文依据能真的取到全文（samples-vision/text/） ===');
await goMore('论文集合');
await sleep(1300);
await click('查看详情');
await sleep(900);
const evBefore = await ev(`(() => {
  const b = [...document.querySelectorAll('button')].find((x) => /原文依据|实际匹配位置/.test(x.textContent));
  if (!b) return 'NO_BUTTON';
  b.click();
  return 'CLICKED';
})()`);
await sleep(2000);
const evState = await ev(`(() => {
  const pop = document.querySelector('.popover, .ev-pop, [class*=ev-]') ? document.body : document.body;
  const txt = pop.innerText || '';
  return {
    click: ${JSON.stringify('x')},
    hasContext: !!document.querySelector('.ev-context'),
    contextHead: (document.querySelector('.ev-context') || {}).textContent ? document.querySelector('.ev-context').textContent.slice(0, 60) : '',
    failed: /全文加载失败|证据上下文加载失败|未能定位到论文原文|HTTP 404/.test(txt),
  };
})()`);
check('论文详情里有「原文依据」按钮', evBefore === 'CLICKED', String(evBefore));
check('视觉案例的原文依据能展开出真实上下文（说明按 samples-vision/ 取到了全文）', evState.hasContext, evState.contextHead.slice(0, 40));
check('没有出现全文加载失败 / 定位失败', !evState.failed);
await ev(`(() => { const b=[...document.querySelectorAll('button')].find((x)=>/关闭/.test(x.textContent)); if(b) b.click(); return true; })()`);
await sleep(500);

console.log('');
console.log('=== S1 案例地图：每条连线两端都属于当前案例方法 ===');
await goMore('研究地图');
await sleep(1500);
// 展开「数据来源与筛选」才能读到地图自己报的关系计数
await ev(`(() => { const d=document.querySelector('.maphead details.fold'); if(d) d.open=true; return true; })()`);
await sleep(500);
const mapCheck = await ev(`(() => {
  const t = (document.querySelector('.maphead-meta') || {}).innerText || '';
  const m = t.match(/关系\\s*(\\d+)\\s*条[^\\d]*(\\d+)\\s*条/);
  return {
    nodeCount: document.querySelectorAll('.mapstage .mnode').length,
    edgeCount: document.querySelectorAll('svg path[marker-end]').length,
    statText: t.replace(/\\s+/g, ' ').slice(0, 90),
    total: m ? Number(m[1]) : -1,
    visible: m ? Number(m[2]) : -1,
  };
})()`);
const caseMethodIds = new Set(methods0.map((m) => m.id));
const relsInCase = rels0.filter((r) => caseMethodIds.has(r.fromMethodId) && caseMethodIds.has(r.toMethodId));
check(
  '库里每条关系的两端都属于当前案例方法（无节点不在画布的关系）',
  relsInCase.length === rels0.length,
  `关系 ${rels0.length} 条，全部在案例内 = ${relsInCase.length === rels0.length}`,
);
check('地图画布画出全部案例方法节点', mapCheck.nodeCount === 5, `节点 ${mapCheck.nodeCount} 个`);
check('地图报的「关系总数」与案例内关系数一致', mapCheck.total === relsInCase.length, `${mapCheck.statText} ｜ 库里案例内 ${relsInCase.length} 条`);
check('地图报的「当前显示 N 条」与画布上真实连线数一致（关系数量与节点集合不脱节）', mapCheck.visible === mapCheck.edgeCount && mapCheck.visible > 0, `显示 ${mapCheck.visible} / 连线 ${mapCheck.edgeCount}`);

console.log('');
console.log('=== S2 移除论文：方法 + 关联关系一起删，不留悬挂关系 ===');
await goMore('论文集合');
await sleep(1300);
const target = papers0[0];
const targetMethods = methods0.filter((m) => m.paperId === target.id);
const targetRels = rels0.filter((r) => targetMethods.some((m) => m.id === r.fromMethodId || m.id === r.toMethodId));
await click('查看详情');
await sleep(900);
await ev(`(() => { const d=[...document.querySelectorAll('.main-inner details.moreprop')].find((x)=>/更多操作/.test(x.textContent)); if(d) d.open=true; return true; })()`);
await sleep(400);
const removeClicked = await click('移除论文');
await sleep(600);
const confirmed = await click('确认移除');
await sleep(1500);
check('可以触发移除（两步确认）', removeClicked && confirmed, `移除=${removeClicked} 确认=${confirmed}`);

const papers1 = await ev(READ_STORE('papers'));
const methods1 = await ev(READ_STORE('methods'));
const rels1 = await ev(READ_STORE('relations'));
check('论文已从库里删除', papers1.length === papers0.length - 1 && !papers1.some((p) => p.id === target.id), `${papers0.length} → ${papers1.length}`);
check(
  '该论文的方法被一起删除（不依赖 m_<paperId> 命名）',
  methods1.every((m) => m.paperId !== target.id) && methods1.length === methods0.length - targetMethods.length,
  `方法 ${methods0.length} → ${methods1.length}（本论文原有 ${targetMethods.length} 条）`,
);
check(
  '该论文参与的关系被一起删除',
  targetRels.length > 0 && rels1.every((r) => !targetMethods.some((m) => m.id === r.fromMethodId || m.id === r.toMethodId)),
  `关系 ${rels0.length} → ${rels1.length}（本论文原占 ${targetRels.length} 条）`,
);
const alive = new Set(methods1.map((m) => m.id));
check('库里不存在悬挂关系（每条关系的两端都还在）', rels1.every((r) => alive.has(r.fromMethodId) && alive.has(r.toMethodId)));

console.log('');
console.log('=== S3 撤销移除：论文 + 方法 + 关系原样写回 ===');
const undone = await click('撤销移除');
await sleep(1500);
const papers2 = await ev(READ_STORE('papers'));
const methods2 = await ev(READ_STORE('methods'));
const rels2 = await ev(READ_STORE('relations'));
check('撤销后论文回来了', undone && papers2.length === papers0.length && papers2.some((p) => p.id === target.id));
check('撤销后方法分析回来了', methods2.length === methods0.length);
check('撤销后关联关系也回来了（用户数据不丢）', rels2.length === rels0.length && targetRels.every((r) => rels2.some((x) => x.id === r.id)), `关系 ${rels2.length}（原 ${rels0.length}）`);

console.log('');
console.log('=== S4 切换案例：旧案例的阅读路线/分歧不再显示，刷新后也不显示 ===');
await goMore('阅读路线');
await sleep(1600);
const planBefore = await ev(`(document.querySelector('.main-inner')||document.body).innerText`);
check('切换到 NLP 前：当前案例有阅读路线内容（示例路线）', /示例路线|个性化路线/.test(planBefore), planBefore.slice(0, 40).replace(/\n/g, ' '));
await goMore('论文集合');
await sleep(1200);
await ev(`(() => { const d=document.querySelector('.main-inner details.libmanage'); if(d) d.open=true; return true; })()`);
await sleep(400);
const switched = await click('换成开发回归样例（NLP）');
await sleep(3500);
check('可以切换案例（视觉 → NLP）', switched);
await goMore('阅读路线');
await sleep(1800);
const planAfter = await ev(`(document.querySelector('.main-inner')||document.body).innerText`);
check('切换案例后不再显示上一个案例的阅读路线', !/示例路线 · 视觉|视觉方法演进案例.*阅读路线/.test(planAfter) && !/ResNet|ViT|Swin/.test(planAfter), planAfter.slice(0, 60).replace(/\n/g, ' '));
await goMore('待调查问题');
await sleep(1600);
const divAfter = await ev(`(document.querySelector('.main-inner')||document.body).innerText`);
check('切换案例后不再显示上一个案例的分歧结果', !/ResNet|ViT|Swin|ConvNeXt/.test(divAfter), divAfter.slice(0, 60).replace(/\n/g, ' '));
const metaDiv = await ev(readMeta('divergence'));
check(
  '本机存档里的分歧结果已按语料集隔离（带 corpusId 或已清空）',
  !metaDiv || (typeof metaDiv === 'object' && 'corpusId' in metaDiv),
  JSON.stringify(metaDiv)?.slice(0, 80),
);

await send('Page.reload', {});
await sleep(5000);
const lsCorpus = await ev(`localStorage.getItem('rp.corpus')`);
const planReload = await ev(readMeta('decision'));
check(
  '刷新后本机存档里的路线仍带着「视觉」身份，与当前语料（NLP）不同 → 不会被读回来',
  !!planReload && planReload.corpusId === 'vision-classification' && planReload.corpusId !== lsCorpus,
  `存档 corpusId=${planReload?.corpusId ?? 'null'}，当前语料=${lsCorpus}`,
);
await goMore('阅读路线');
await sleep(1800);
const planReloadText = await ev(`(document.querySelector('.main-inner') || document.body).innerText`);
check(
  '刷新后阅读路线页不出现视觉案例的任何论文（不显示上一个案例的路线）',
  !/(ResNet|ViT|DeiT|Swin|ConvNeXt)/.test(planReloadText) && !/缓存/.test(planReloadText),
  planReloadText.slice(0, 70).replace(/\n/g, ' '),
);
check('刷新后如实显示「尚未生成」，而不是拿别的案例顶上', /尚未生成|还没有可用/.test(planReloadText));
await goMore('待调查问题');
await sleep(1600);
const divReloadText = await ev(`(document.querySelector('.main-inner') || document.body).innerText`);
check('刷新后待调查问题页也不显示视觉案例的分歧结果', !/(ResNet|ViT|DeiT|Swin|ConvNeXt)/.test(divReloadText), divReloadText.slice(0, 60).replace(/\n/g, ' '));

console.log('');
console.log(`结果：通过 ${pass}，失败 ${fail}`);
if (failures.length) {
  console.log('失败项：');
  failures.forEach((f) => console.log('  - ' + f));
}
child.kill();
server.close();
process.exit(fail ? 1 : 0);
