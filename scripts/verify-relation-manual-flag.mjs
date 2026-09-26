/**
 * 「人工关系判定」回归：`aiOriginal` 不是人工标志（独立 Chrome 数据目录 + 真实缓存数据）。
 *
 * 背景（实测缺陷）：`public/samples-vision/index.json` 的 10 条缓存关系**全部带 aiOriginal、
 * 全部没有 userEdited** —— aiOriginal 只是「AI 原始判定快照」，普通 AI 关系也会有。
 * 旧判定 `userEdited || aiOriginal` 把整批普通关系当人工关系，导致
 * `replaceRelationsInScope().write` 恒为空：同 ID 的新结果写不进去、旧的普通关系也删不掉。
 *
 * 本脚本用**真实缓存数据**同时检查三层：内存（关系图页面）、IndexedDB、刷新之后。
 * 不调用任何真实模型：用预置缓存 + 界面人工修正 + 直读/写 IndexedDB 制造「旧值」基线。
 *
 * 用法：node scripts/verify-relation-manual-flag.mjs
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
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
    console.error('找不到 Chrome/Chromium：请设置 CHROME_PATH 后重试。');
    process.exit(2);
  }
  return hit;
};

const ROOT = resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const DIST = join(ROOT, 'dist');
const SHOTS = join(ROOT, 'docs', 'relation-manual-flag');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.mjs': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
};

const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent((req.url || '/').split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    const f = normalize(join(DIST, p));
    if (!f.startsWith(DIST)) return res.writeHead(403).end();
    if (!(await stat(f)).isFile()) throw 0;
    res.writeHead(200, { 'Content-Type': MIME[extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(await readFile(f));
  } catch {
    res.writeHead(404).end('nf');
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = 'http://127.0.0.1:' + server.address().port + '/';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0;
let fail = 0;
const failures = [];
const check = (name, cond, extra = '') => {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}${extra ? ` 〔${extra}〕` : ''}`);
  } else {
    fail++;
    failures.push(name + (extra ? ` — ${extra}` : ''));
    console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`);
  }
};

/** 真实缓存里那 10 条关系（作为期望值的来源，不依赖界面文案） */
const cacheIndex = JSON.parse(await readFile(join(ROOT, 'public', 'samples-vision', 'index.json'), 'utf8'));
const cacheRelations = cacheIndex.relations ?? [];
const cacheTypeById = new Map(cacheRelations.map((r) => [r.id, r.type]));

const profile = join(ROOT, '.build', 'relation-manual-flag-' + Date.now());
mkdirSync(profile, { recursive: true });
mkdirSync(SHOTS, { recursive: true });
const child = spawn(
  resolveChrome(),
  ['--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars', '--remote-debugging-port=9541', '--user-data-dir=' + profile, '--window-size=1440,900', url],
  { stdio: 'ignore' },
);
for (let i = 0; i < 100; i++) {
  try {
    await (await fetch('http://127.0.0.1:9541/json/version')).json();
    break;
  } catch {
    await sleep(300);
  }
}
const list = await (await fetch('http://127.0.0.1:9541/json/list')).json();
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m.result);
    pending.delete(m.id);
  }
});
const send = (method, params = {}) => {
  const i = ++id;
  ws.send(JSON.stringify({ id: i, method, params }));
  return new Promise((r) => pending.set(i, r));
};
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r?.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval error');
  return r?.result?.value;
};
await send('Runtime.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

const click = (t) =>
  ev(`(() => { const b=[...document.querySelectorAll('button')].find((x)=>(x.textContent||'').replace(/\\s+/g,' ').trim().includes(${JSON.stringify(t)})); if(!b) return false; b.click(); return true; })()`);
const goMore = async (t) => {
  for (let attempt = 0; attempt < 3; attempt++) {
    await ev(`(() => { const b=document.querySelector('.mapbrand .dirbtn'); if(b) b.click(); return true; })()`);
    await sleep(900);
    if (await click(t)) {
      await sleep(1700);
      return true;
    }
    await sleep(700);
  }
  return false;
};
const waitFor = async (expr, ms, label) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await ev(expr)) return true;
    await sleep(400);
  }
  console.log(`   （等待超时：${label}）`);
  return false;
};
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(SHOTS, name), Buffer.from(r.data, 'base64'));
};

const READ_RELS = `(async () => {
  const db = await new Promise((resolve) => { const q = indexedDB.open('researchpilot'); q.onsuccess = () => resolve(q.result); q.onerror = () => resolve(null); });
  if (!db) return { error: 'open failed' };
  const rows = await new Promise((resolve) => {
    if (!db.objectStoreNames.contains('relations')) return resolve([]);
    const a = db.transaction('relations', 'readonly').objectStore('relations').getAll();
    a.onsuccess = () => resolve(a.result || []);
  });
  return rows.map((r) => ({ id: r.id, type: r.type, state: r.evidenceState, userEdited: !!r.userEdited, hasAiOriginal: !!r.aiOriginal, rationale: r.rationale }));
})()`;

/** 内存层：完整关系图页面上的连线数，以及被标成「·人工」的条数 */
const readGraphMemory = () =>
  ev(`(() => {
    const edges = [...document.querySelectorAll('.graph-wrap .grel')];
    const texts = edges.map((g) => (g.querySelector('text') || {}).textContent || '');
    return { edges: edges.length, manualLabels: texts.filter((t) => /·人工/.test(t)).length, sample: texts.slice(0, 3) };
  })()`);

console.log('=== 真实缓存数据基线（public/samples-vision/index.json）===');
console.log(`   缓存关系 ${cacheRelations.length} 条｜带 aiOriginal ${cacheRelations.filter((r) => r.aiOriginal).length} 条｜带 userEdited ${cacheRelations.filter((r) => r.userEdited).length} 条`);

await sleep(3400);

// ---------- 在「空库」阶段注入两条**带 aiOriginal 的普通关系**（与真实缓存同构）----------
// 必须在加载案例**之前**注入并刷新一次：应用启动时会把它们读进内存，
// 「按范围替换」才有机会判定它们（普通关系应被替换/删除，而不是被当成人工关系保护起来）。
const mutateId = cacheRelations[0].id;
const cacheType = cacheRelations[0].type;
const fromId = cacheRelations[0].fromMethodId;
const toId = cacheRelations[0].toMethodId;
await ev(`(async () => {
  const db = await new Promise((resolve) => { const q = indexedDB.open('researchpilot'); q.onsuccess = () => resolve(q.result); });
  const tx = db.transaction('relations', 'readwrite');
  const os = tx.objectStore('relations');
  os.put({
    id: ${JSON.stringify(mutateId)},
    fromMethodId: ${JSON.stringify(fromId)},
    toMethodId: ${JSON.stringify(toId)},
    type: 'improves', evidenceState: 'inferred', rationale: '与缓存不同的旧值（回归测试基线）', cached: true,
    aiOriginal: { type: 'improves', evidenceState: 'inferred', rationale: '旧值快照' },
  });
  os.put({
    id: 'r_scope_stale_plain',
    fromMethodId: ${JSON.stringify(fromId)},
    toMethodId: ${JSON.stringify(toId)},
    type: 'similar', evidenceState: 'candidate', rationale: '范围内的旧普通关系（不在新结果里）', cached: true,
    aiOriginal: { type: 'similar', evidenceState: 'candidate', rationale: '旧值快照' },
  });
  await new Promise((r) => { tx.oncomplete = r; tx.onerror = r; });
})()`);
await sleep(600);
const dbInjected = await ev(READ_RELS);
check(
  '基线注入：两条都带 aiOriginal、都没有 userEdited（与真实缓存关系同构）',
  dbInjected.length === 2 && dbInjected.every((r) => r.hasAiOriginal && !r.userEdited),
  `${dbInjected.map((r) => `${r.id}:${r.type}`).join(' | ')}`,
);

// 刷新一次：让应用把它们读进内存（否则内存里没有它们，范围替换无从判定）
await send('Page.reload');
await sleep(5000);

await click('体验视觉论文案例');
await waitFor(`document.querySelectorAll('.paper-title').length >= 5`, 60000, '视觉案例加载');
await sleep(1500);

const dbBase = await ev(READ_RELS);
check(
  '加载案例后：IndexedDB 里正好 10 条缓存关系',
  Array.isArray(dbBase) && dbBase.length === cacheRelations.length,
  `${Array.isArray(dbBase) ? dbBase.length : 'error'} 条`,
);
check(
  '这 10 条全部带 aiOriginal（证明它只是 AI 原判定快照，不是人工痕迹）',
  Array.isArray(dbBase) && dbBase.every((r) => r.hasAiOriginal),
  `带 aiOriginal 的 ${Array.isArray(dbBase) ? dbBase.filter((r) => r.hasAiOriginal).length : '?'} 条`,
);
check('这 10 条没有任何一条被标为人工（userEdited 全空）', Array.isArray(dbBase) && dbBase.every((r) => !r.userEdited));
check(
  '范围内那条「旧普通关系」被按范围删除（不在新结果里的普通关系不会赖着不走）',
  !dbBase.some((r) => r.id === 'r_scope_stale_plain'),
  `当前 ${dbBase.length} 条`,
);
check(
  '被改过值的**普通**关系换回了缓存值（普通 AI 关系可以被新结果替换）',
  dbBase.find((r) => r.id === mutateId)?.type === cacheType,
  `${mutateId}：${dbBase.find((r) => r.id === mutateId)?.type}（期望缓存值 ${cacheType}）`,
);

await goMore('方法关系图');
await sleep(1800);
const memBase = await readGraphMemory();
check('内存（关系图）：画出全部缓存关系', memBase.edges === cacheRelations.length, `${memBase.edges} 条边`);
check('内存（关系图）：普通 AI 关系没有被标成「·人工」', memBase.manualLabels === 0, `标记数 ${memBase.manualLabels}`);
await shot('01-加载后（无人工标记）.png');

// ---------- 界面人工修正一条 → 必须受保护（保留上一轮行为） ----------
await goMore('方法关系图');
await sleep(1600);
const openedForEdit = await ev(`(() => {
  const edges = [...document.querySelectorAll('.graph-wrap .grel')];
  if (!edges.length) return '';
  edges[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
  return true;
})()`);
await sleep(800);
await click('修正');
await sleep(700);
const newType = await ev(`(() => {
  const sel = document.querySelector('.main-inner select.f');
  if (!sel) return '';
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
  const target2 = [...sel.options].map((o) => o.value).find((v) => v !== sel.value) || sel.value;
  setter.call(sel, target2);
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  return target2;
})()`);
await sleep(300);
const savedEdit = await click('保存修正');
await sleep(1000);
const dbEdited = await ev(READ_RELS);
const manual = dbEdited.filter((r) => r.userEdited);
check('界面人工修正后：IndexedDB 里恰好 1 条 userEdited（且带 aiOriginal 快照）', manual.length === 1 && manual[0].hasAiOriginal, `userEdited=${manual.length}`);
const manualId = manual[0]?.id ?? '';
const manualType = manual[0]?.type ?? '';

await goMore('论文集合');
await ev(`(() => { const d=document.querySelector('.main-inner details.libmanage'); if(d) d.open=true; return true; })()`);
await sleep(400);
await click('重新加载演示案例');
await waitFor(`document.querySelectorAll('.paper-title').length >= 5`, 90000, '第二次重新加载');
await sleep(2500);
const dbAfter2 = await ev(READ_RELS);
const manualAfter = dbAfter2.find((r) => r.id === manualId);
check(
  '保留上一轮行为：重载后人工修正的那条仍是用户改的值（同 ID 优先，不被缓存覆盖）',
  !!manualAfter && manualAfter.userEdited === true && manualAfter.type === manualType,
  manualAfter ? `type=${manualAfter.type}（期望 ${manualType}）userEdited=${manualAfter.userEdited}` : '关系丢失',
);
check(
  '重载后：其余 9 条普通关系仍按缓存值写入（没有被人工标记连带保护）',
  dbAfter2.filter((r) => !r.userEdited).length === cacheRelations.length - 1,
  `非人工 ${dbAfter2.filter((r) => !r.userEdited).length} 条`,
);

await goMore('方法关系图');
await sleep(1800);
const memAfter2 = await readGraphMemory();
check('内存（关系图）：只有那 1 条被标成「·人工」', memAfter2.manualLabels === 1, `标记数 ${memAfter2.manualLabels}｜${memAfter2.sample.join(' | ')}`);

// ---------- 刷新 ----------
await send('Page.reload');
await sleep(6000);
await click('体验视觉论文案例');
await waitFor(`document.querySelectorAll('.paper-title').length >= 5`, 60000, '刷新后加载');
await sleep(1500);
const dbRefresh = await ev(READ_RELS);
const manualRefresh = dbRefresh.find((r) => r.id === manualId);
check('刷新后：人工关系仍是用户改的值', !!manualRefresh && manualRefresh.userEdited === true && manualRefresh.type === manualType);
check(
  '刷新后：普通关系仍是缓存值（普通关系没有被误判为人工而挡住新结果）',
  dbRefresh.filter((r) => !r.userEdited).every((r) => !cacheTypeById.has(r.id) || r.type === cacheTypeById.get(r.id)),
  `非人工 ${dbRefresh.filter((r) => !r.userEdited).length} 条`,
);
check('刷新后：范围内那条旧普通关系没有复活', !dbRefresh.some((r) => r.id === 'r_scope_stale_plain'));
await goMore('方法关系图');
await sleep(1600);
const memRefresh = await readGraphMemory();
check('刷新后内存（关系图）：仍只有 1 条「·人工」', memRefresh.manualLabels === 1, `标记数 ${memRefresh.manualLabels}`);
await shot('02-刷新后（只有人工那条被标记）.png');

console.log('');
console.log(`结果：通过 ${pass}，失败 ${fail}`);
if (failures.length) {
  console.log('失败项：');
  failures.forEach((f) => console.log('  - ' + f));
}
console.log(`截图目录：${SHOTS}`);
child.kill();
server.close();
process.exit(fail ? 1 : 0);
