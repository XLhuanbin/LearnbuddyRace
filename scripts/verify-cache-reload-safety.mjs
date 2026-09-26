/**
 * 「重新加载案例是否丢失人工修正」的数据安全回归（独立 Chrome 数据目录，直读 IndexedDB）。
 *
 * 用户给的复现顺序（阶段 A，完全按此执行）：
 *   加载视觉案例 → 论文集合里用界面修正 ResNet 的一个方法字段 → 完整关系图里修正一条已有关系
 *   → 点「重新加载演示案例」→ 刷新页面
 *   每一步直读 IndexedDB，记录方法 overrides、关系 userEdited 与修正内容。
 *
 * 阶段 B 检查「范围外数据不受影响」：用户粘贴导入的论文（不在案例范围内）+ 一条范围外关系。
 *
 * 不调用任何真实模型：只走预置缓存 + 界面人工修正 + 本地解析/粘贴。
 * 用法：node scripts/verify-cache-reload-safety.mjs
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
const SHOTS = join(ROOT, 'docs', 'cache-reload-safety');

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

async function openBrowser(label, port) {
  const profile = join(ROOT, '.build', `reload-safety-${label}-${Date.now()}`);
  mkdirSync(profile, { recursive: true });
  const child = spawn(
    resolveChrome(),
    ['--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--window-size=1440,900', url],
    { stdio: 'ignore' },
  );
  for (let i = 0; i < 100; i++) {
    try {
      await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
      break;
    } catch {
      await sleep(300);
    }
  }
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
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
  return { send, ev, child };
}

/** 直读 IndexedDB：方法 overrides / 关系 userEdited 与内容 / 论文清单 */
const READ_DB = `(async () => {
  const open = () => new Promise((resolve) => { const q = indexedDB.open('researchpilot'); q.onsuccess = () => resolve(q.result); q.onerror = () => resolve(null); });
  const getAll = (db, store) => new Promise((resolve) => {
    if (!db.objectStoreNames.contains(store)) return resolve([]);
    const a = db.transaction(store, 'readonly').objectStore(store).getAll();
    a.onsuccess = () => resolve(a.result || []);
    a.onerror = () => resolve([]);
  });
  const db = await open();
  if (!db) return { error: 'db open failed' };
  const papers = await getAll(db, 'papers');
  const methods = await getAll(db, 'methods');
  const relations = await getAll(db, 'relations');
  return {
    papers: papers.map((p) => ({ id: p.id, title: p.title, corpusId: p.corpusId ?? 'user-import', parseStatus: p.parseStatus })),
    methods: methods.map((m) => ({
      id: m.id, paperId: m.paperId, corpusId: m.corpusId,
      overrides: (m.overrides || []).map((o) => ({ field: o.field, newValue: o.newValue, oldValue: o.oldValue, at: o.at })),
    })),
    relations: relations.map((r) => ({ id: r.id, from: r.fromMethodId, to: r.toMethodId, type: r.type, state: r.evidenceState, userEdited: !!r.userEdited, aiOriginal: !!r.aiOriginal, rationale: r.rationale })),
  };
})()`;

const click = (ev, t) =>
  ev(`(() => { const b=[...document.querySelectorAll('button')].find((x)=>(x.textContent||'').replace(/\\s+/g,' ').trim().includes(${JSON.stringify(t)})); if(!b) return false; b.click(); return true; })()`);
const goMore = async (ev, t) => {
  for (let attempt = 0; attempt < 3; attempt++) {
    await ev(`(() => { const b=document.querySelector('.mapbrand .dirbtn'); if(b) b.click(); return true; })()`);
    await sleep(900);
    if (await click(ev, t)) {
      await sleep(1700);
      return true;
    }
    await sleep(700);
  }
  return false;
};
const waitFor = async (ev, expr, ms, label) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await ev(expr)) return true;
    await sleep(400);
  }
  console.log(`   （等待超时：${label}）`);
  return false;
};
const shot = async (send, name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(SHOTS, name), Buffer.from(r.data, 'base64'));
};

// ================================================================ 阶段 A
console.log('=== 阶段 A（独立数据目录 #1）：加载案例 → 修字段 → 修关系 → 重新加载案例 → 刷新 ===');
{
  const { ev, send, child } = await openBrowser('a', 9531);
  mkdirSync(SHOTS, { recursive: true });
  await sleep(3400);
  await click(ev, '体验视觉论文案例');
  await waitFor(ev, `document.querySelectorAll('.paper-title').length >= 5`, 60000, '视觉案例加载');
  await sleep(1200);

  const base = await ev(READ_DB);
  console.log(`   初始：论文 ${base.papers.length} 篇 / 方法 ${base.methods.length} 条 / 关系 ${base.relations.length} 条`);
  const resnetPaper = base.papers.find((p) => /1512\.03385/.test(p.id)) ?? base.papers[0];
  const resnetMethod0 = base.methods.find((m) => m.paperId === resnetPaper.id);
  check('视觉案例已加载（论文 / 方法 / 关系齐全）', base.papers.length >= 5 && base.methods.length >= 5 && base.relations.length > 0, `${base.papers.length}/${base.methods.length}/${base.relations.length}`);
  check('初始状态：ResNet 方法还没有人工修正', (resnetMethod0?.overrides.length ?? -1) === 0, `overrides=${resnetMethod0?.overrides.length}`);

  // ---------- 1) 界面修正 ResNet 的一个方法字段 ----------
  await goMore(ev, '论文集合');
  await sleep(800);
  const opened = await ev(`(() => {
    const rows = [...document.querySelectorAll('.lrow')];
    const row = rows.find((r) => /1512\\.03385|residual|ResNet/i.test((r.querySelector('.paper-title')||{}).textContent||''));
    if (!row) return 'NO_ROW';
    const btn = [...row.querySelectorAll('button')].find((b) => /查看详情/.test(b.textContent));
    if (!btn) return 'NO_BTN';
    btn.click();
    return 'OK';
  })()`);
  await sleep(1000);
  check('打开 ResNet 论文详情（论文集合页）', opened === 'OK', String(opened));
  const editedField = await ev(`(() => {
    const f = document.querySelector('.main-inner .field');
    if (!f) return 'NO_FIELD';
    const name = (f.querySelector('.field-name') || {}).textContent || '';
    const fix = [...f.querySelectorAll('button')].find((b) => b.textContent.trim() === '修正');
    if (!fix) return 'NO_FIX_BTN';
    fix.click();
    return name.trim();
  })()`);
  await sleep(600);
  const fieldName = await ev(`(() => {
    const f = document.querySelector('.main-inner .field');
    return f ? ((f.querySelector('.field-name')||{}).textContent||'').trim() : '';
  })()`);
  const typed = await ev(`(() => {
    const ta = document.querySelector('.main-inner .field textarea.f');
    if (!ta) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, '人工修正-回归测试值');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return ta.value;
  })()`);
  await sleep(300);
  const savedField = await click(ev, '保存修正');
  await sleep(900);
  check('界面可以保存字段修正', savedField && !!typed, `字段「${fieldName}」→「${String(typed).slice(0, 20)}」`);

  const afterField = await ev(READ_DB);
  const resnetMethod1 = afterField.methods.find((m) => m.id === resnetMethod0.id);
  const ovCount1 = resnetMethod1?.overrides.length ?? -1;
  check('IndexedDB 里 ResNet 方法已记录 1 处人工修正', ovCount1 === 1, `overrides=${ovCount1}｜${JSON.stringify(resnetMethod1?.overrides[0] ?? {})}`);

  // ---------- 2) 完整关系图里修正一条已有关系 ----------
  await goMore(ev, '方法关系图');
  await sleep(1200);
  const pickedRel = await ev(`(() => {
    const g = document.querySelector('.graph-wrap .grel');
    if (!g) return null;
    g.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const card = document.querySelector('.main-inner .card');
    return card ? true : false;
  })()`);
  await sleep(900);
  const editClicked = await click(ev, '修正');
  await sleep(700);
  const changed = await ev(`(() => {
    const sels = [...document.querySelectorAll('.main-inner select.f')];
    if (!sels.length) return 'NO_SELECT';
    const sel = sels[0];
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    const target = [...sel.options].map((o) => o.value).find((v) => v !== sel.value) || sel.value;
    setter.call(sel, target);
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    const ta = document.querySelector('.main-inner textarea.f');
    if (ta) {
      const tsetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      tsetter.call(ta, '人工修正关系的理由-回归测试');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
    return target;
  })()`);
  await sleep(300);
  const savedRel = await click(ev, '保存修正');
  await sleep(1000);
  check('界面可以保存关系修正（关系类型改为 ' + String(changed) + '）', editClicked && savedRel, String(changed));

  const afterRel = await ev(READ_DB);
  const manualRels = afterRel.relations.filter((r) => r.userEdited);
  const manualRel = manualRels[0];
  check('IndexedDB 里已存在一条人工修正关系（userEdited=true）', manualRels.length === 1, JSON.stringify(manualRel ?? {}));
  const relIdBefore = manualRel?.id ?? '';
  const relTypeBefore = manualRel?.type ?? '';
  const isCachedCollision = afterRel.relations.some((r) => r.id === relIdBefore && !r.userEdited) === false;
  console.log(`   人工关系 id=${relIdBefore}｜type=${relTypeBefore}｜rationale=${String(manualRel?.rationale).slice(0, 30)}`);
  check('这条人工关系与缓存关系的 ID 相同（复现用户要求的「同 ID」情形）', !!relIdBefore && base.relations.some((r) => r.id === relIdBefore), `缓存里同 id：${base.relations.some((r) => r.id === relIdBefore)}`);

  // ---------- 范围外基线：粘贴导入的论文 + 一条范围外关系 ----------
  await ev(`(async () => {
    const open = () => new Promise((resolve) => { const q = indexedDB.open('researchpilot'); q.onsuccess = () => resolve(q.result); });
    const db = await open();
    const tx = db.transaction('relations', 'readwrite');
    tx.objectStore('relations').put({
      id: 'r_out_of_scope_regression', fromMethodId: 'm_outside_a', toMethodId: 'm_outside_b',
      type: 'similar', evidenceState: 'candidate', rationale: '范围外关系（回归测试基线）', userEdited: true, cached: false,
    });
    await new Promise((r) => { tx.oncomplete = r; tx.onerror = r; });
  })()`);
  await sleep(600);

  // 范围外论文：粘贴导入一篇（本机解析，不调用模型）
  await goMore(ev, '方法提取');
  await sleep(1000);
  const pasteOpen = await click(ev, '粘贴论文正文');
  await sleep(600);
  const pasted = await ev(`(() => {
    // 页面上还有模型配置输入框，必须先把范围收窄到「粘贴论文正文」这个分组里
    const submit = [...document.querySelectorAll('.main-inner button')].find((b) => /进入流程/.test(b.textContent));
    const group = submit ? submit.closest('.quiet-group') : null;
    if (!group) return 'NO_GROUP';
    const title = group.querySelector('input.f');
    const text = group.querySelector('textarea.f');
    if (!title || !text) return 'NO_FIELDS';
    const tset = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    tset.call(title, '范围外回归样例论文');
    title.dispatchEvent(new Event('input', { bubbles: true }));
    const body = 'Abstract\\n\\n' + 'This is an out-of-scope paper used by the reload-safety regression test. '.repeat(8) + '\\n\\n1 Introduction\\n' + 'Body text for local parsing only. '.repeat(10);
    const aset = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    aset.call(text, body);
    text.dispatchEvent(new Event('input', { bubbles: true }));
    return 'FILLED';
  })()`);
  await sleep(400);
  const pasteSubmitted = await click(ev, '进入流程');
  await sleep(1500);
  const beforeReload = await ev(READ_DB);
  const outPaper = beforeReload.papers.find((p) => p.corpusId === 'user-import');
  check('范围外关系基线已就位（两端都不属于案例范围）', beforeReload.relations.some((r) => r.id === 'r_out_of_scope_regression'), `关系总数 ${beforeReload.relations.length}`);
  check(
    '范围外论文基线已就位（粘贴导入，corpusId=user-import）',
    pasteOpen && pasted === 'FILLED' && pasteSubmitted && !!outPaper,
    `打开表单=${pasteOpen} 填表=${pasted} 提交=${pasteSubmitted} 论文=${outPaper ? outPaper.title : '未导入'}`,
  );
  await shot(send, '01-修正后（重载前）.png');

  // ---------- 3) 点「重新加载演示案例」 ----------
  await goMore(ev, '论文集合');
  await ev(`(() => { const d=document.querySelector('.main-inner details.libmanage'); if(d) d.open=true; return true; })()`);
  await sleep(400);
  const reloaded = await click(ev, '重新加载演示案例');
  await waitFor(ev, `document.querySelectorAll('.paper-title').length >= 5`, 90000, '重新加载完成');
  await sleep(2500);
  check('点「重新加载演示案例」成功', reloaded);

  const afterReload = await ev(READ_DB);
  const resnetMethod2 = afterReload.methods.find((m) => m.id === resnetMethod0.id);
  const relAfterReload = afterReload.relations.find((r) => r.id === relIdBefore);
  console.log(`   重载后：ResNet overrides=${resnetMethod2?.overrides.length ?? '缺失'}｜人工关系=${relAfterReload ? JSON.stringify({ type: relAfterReload.type, userEdited: relAfterReload.userEdited }) : '缺失'}`);
  check(
    '【重载后立即查看】方法人工修正保留（overrides 还在）',
    (resnetMethod2?.overrides.length ?? 0) === 1,
    `overrides=${resnetMethod2?.overrides.length ?? '方法丢失'}`,
  );
  check(
    '【重载后立即查看】关系人工修正保留（userEdited 与改过的类型还在）',
    !!relAfterReload && relAfterReload.userEdited === true && relAfterReload.type === relTypeBefore,
    relAfterReload ? `type=${relAfterReload.type}（期望 ${relTypeBefore}）userEdited=${relAfterReload.userEdited}` : '关系丢失',
  );
  check(
    '【重载后立即查看】范围外关系不受影响',
    afterReload.relations.some((r) => r.id === 'r_out_of_scope_regression'),
    `关系总数 ${afterReload.relations.length}`,
  );
  check(
    '【重载后立即查看】范围外论文不受影响（我粘贴导入的那篇还在）',
    afterReload.papers.some((p) => p.corpusId === 'user-import'),
    `论文总数 ${afterReload.papers.length}`,
  );

  // ---------- 4) 刷新页面 ----------
  await send('Page.reload');
  await sleep(6000);
  await click(ev, '体验视觉论文案例');
  await waitFor(ev, `document.querySelectorAll('.paper-title').length >= 5`, 60000, '刷新后加载');
  await sleep(1500);
  const afterRefresh = await ev(READ_DB);
  const resnetMethod3 = afterRefresh.methods.find((m) => m.id === resnetMethod0.id);
  const relAfterRefresh = afterRefresh.relations.find((r) => r.id === relIdBefore);
  console.log(`   刷新后：ResNet overrides=${resnetMethod3?.overrides.length ?? '缺失'}｜人工关系=${relAfterRefresh ? JSON.stringify({ type: relAfterRefresh.type, userEdited: relAfterRefresh.userEdited }) : '缺失'}`);
  check('【刷新后查看】方法人工修正仍在', (resnetMethod3?.overrides.length ?? 0) === 1, `overrides=${resnetMethod3?.overrides.length ?? '方法丢失'}`);
  check(
    '【刷新后查看】关系人工修正仍在（未被缓存结果覆盖）',
    !!relAfterRefresh && relAfterRefresh.userEdited === true && relAfterRefresh.type === relTypeBefore,
    relAfterRefresh ? `type=${relAfterRefresh.type}（期望 ${relTypeBefore}）userEdited=${relAfterRefresh.userEdited}` : '关系丢失',
  );
  check('【刷新后查看】范围外关系仍在', afterRefresh.relations.some((r) => r.id === 'r_out_of_scope_regression'));
  check('【刷新后查看】范围外论文仍在', afterRefresh.papers.some((p) => p.corpusId === 'user-import'));
  // 界面上也要能看见：打开那条人工关系，详情卡上必须有「已人工修正」标记
  await goMore(ev, '方法关系图');
  await sleep(1600);
  // 逐条点到出现「已人工修正」为止（关系图上的连线顺序不保证）
  let openedRel = '';
  let detailText = '';
  for (let i = 0; i < 12; i++) {
    openedRel = await ev(`(() => {
      const edges = [...document.querySelectorAll('.graph-wrap .grel')];
      const g = edges[${i}];
      if (!g) return '';
      g.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return g.getAttribute('aria-label') || '';
    })()`);
    if (!openedRel) break;
    await sleep(700);
    detailText = await ev(`(() => { const m=document.querySelector('.main-inner')||document.body; return (m.innerText||'').slice(0, 1800); })()`);
    if (/已人工修正/.test(detailText)) break;
  }
  await shot(send, '02-刷新后（人工修正仍在）.png');
  check(
    '刷新后界面上仍能看到「已人工修正」标记（人工修正没有被缓存结果盖掉）',
    /已人工修正/.test(detailText),
    `${String(openedRel).slice(0, 40)}｜${detailText.replace(/\n/g, ' ').slice(0, 90)}`,
  );
  await shot(send, '02-刷新后（人工修正仍在）.png');
  child.kill();
}

console.log('');
console.log(`结果：通过 ${pass}，失败 ${fail}`);
if (failures.length) {
  console.log('失败项：');
  failures.forEach((f) => console.log('  - ' + f));
}
console.log(`截图目录：${SHOTS}`);
server.close();
process.exit(fail ? 1 : 0);
