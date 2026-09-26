/**
 * 桌面端「真实导入流程」回归走查（独立浏览器数据目录，按真实顺序实测）。
 *
 * 覆盖用户实测发现的问题：
 *  1. 先加载视觉案例，再上传自己的 PDF → 方法提取页必须能**找到并打开**这篇新论文，且抽取入口可用；
 *  2. 同一 PDF 上传两次 → 只保留一份（按内容哈希去重）；
 *  3. 损坏 PDF 解析失败 → 失败可见，且「重新选择 PDF」必须**真的重新解析 PDF**（不是拿模型抽取冒充）；
 *  4. 切到 NLP 开发样例 → 实验可比性页不得承诺「重载能补出实验记录」（那份缓存里本来就 0 条）。
 * 另外检查：非预置 PDF 的标题不能把摘要句当成已确认标题（要么校正，要么明确标「标题待确认」）。
 *
 * 每个阶段用**全新的浏览器数据目录**，保证 IndexedDB 是空的。
 * 用法：node scripts/verify-import-flow.mjs [--keep]（--keep 保留失败截图以外的截图目录）
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, stat, writeFile } from 'node:fs/promises';
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
const SHOTS = join(ROOT, 'docs', 'import-flow');
const GOOD_PDF = join(ROOT, 'samples', 'pdfs', '2006.11239.pdf');
const BAD_PDF = join(ROOT, '.build', 'fixtures', 'corrupt.pdf');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  // pdf.js 的 worker 是 .mjs：MIME 不对会被浏览器拒绝加载模块（本地走查会误报「PDF 无法打开」）
  '.mjs': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
};

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
const url = `http://127.0.0.1:${server.address().port}/`;

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

/** 打开一个全新的浏览器实例（独立数据目录 ⇒ 空 IndexedDB） */
async function openBrowser(label, port) {
  const profile = join(ROOT, '.build', `importflow-${label}-${Date.now()}`);
  mkdirSync(profile, { recursive: true });
  const child = spawn(
    resolveChrome(),
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--hide-scrollbars',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      '--window-size=1440,900',
      url,
    ],
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
  await send('DOM.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  return { send, ev, child, label };
}

const click = (ev, t) =>
  ev(`(() => { const b=[...document.querySelectorAll('button')].find((x)=>(x.textContent||'').replace(/\\s+/g,' ').trim().includes(${JSON.stringify(t)})); if(!b) return false; b.click(); return true; })()`);
const goMore = async (ev, t) => {
  // 菜单是 toggle：上一次没关干净时第一次点击会把它关掉，所以最多重试 3 次
  for (let attempt = 0; attempt < 3; attempt++) {
    await ev(`(() => { const b=document.querySelector('.mapbrand .dirbtn'); if(b) b.click(); return true; })()`);
    await sleep(900);
    const ok = await click(ev, t);
    if (ok) {
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
/** 把本地文件塞进页面上第一个 file input（等价于用户在选择框里选中该文件） */
const setFileInput = async (send, files, selector = '.main-inner input[type=file]') => {
  const { root } = await send('DOM.getDocument', { depth: -1 });
  const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector });
  if (!nodeId) return 'NO_INPUT';
  await send('DOM.setFileInputFiles', { files, nodeId });
  return 'OK';
};
const shot = async (send, name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(SHOTS, name), Buffer.from(r.data, 'base64'));
};
const loadVisionCase = async (ev) => {
  await click(ev, '体验视觉论文案例');
  await waitFor(ev, `document.querySelectorAll('.paper-title').length >= 5`, 60000, '视觉案例加载');
  await sleep(1000);
};
/** 直读 IndexedDB：这是「到底有没有导入成功」的唯一地面真相 */
const idbPapers = (ev) =>
  ev(`new Promise((resolve) => {
  const req = indexedDB.open('researchpilot');
  req.onerror = () => resolve({ error: 'open failed' });
  req.onsuccess = () => {
    const db = req.result;
    if (!db.objectStoreNames.contains('papers')) return resolve({ papers: [] });
    const all = db.transaction('papers', 'readonly').objectStore('papers').getAll();
    all.onsuccess = () =>
      resolve({
        papers: (all.result || []).map((p) => ({
          id: p.id,
          title: p.title,
          parseStatus: p.parseStatus,
          corpusId: p.corpusId ?? 'user-import',
          chars: p.rawText ? p.rawText.length : 0,
          pages: (p.pages || []).length,
          titleFrom: p.titleFrom || '',
          parseError: (p.parseError || '').slice(0, 140),
        })),
      });
    all.onerror = () => resolve({ error: 'getAll failed' });
  };
})`);

/** 页面上的操作日志（用户能看到的真实反馈） */
const logText = (ev) => ev(`(() => { const l = document.querySelector('.log, .logpanel, .logs, .logbox'); return l ? l.innerText.slice(-1500) : ''; })()`);

/** 方法提取页的论文列表快照 */
const uploadList = (ev) =>
  ev(`(() => {
  const items = [...document.querySelectorAll('.main-inner .pitem')];
  return {
    count: items.length,
    names: items.map((x)=>((x.querySelector('.nm')||{}).textContent||'').trim()),
    states: items.map((x)=>((x.querySelector('.st')||{}).textContent||'').trim()),
  };
})()`);

// ---------------------------------------------------------------- 阶段 A
console.log('=== 阶段 A（独立数据目录 #1）：空数据 → 视觉案例 → 上传新 PDF → 查找并打开 → 抽取入口 ===');
{
  const { send, ev, child } = await openBrowser('a', 9511);
  mkdirSync(SHOTS, { recursive: true });
  await sleep(3200);
  await loadVisionCase(ev);

  // ---- S1：上传真实 PDF（DDPM 2006.11239）----
  await goMore(ev, '方法提取');
  const before = await uploadList(ev);
  check('上传前：方法提取页显示案例的 5 篇论文', before.count === 5, `${before.count} 篇`);

  const set1 = await setFileInput(send, [GOOD_PDF]);
  check('可以把本地 PDF 放进上传入口（选择文件）', set1 === 'OK', String(set1));
  /** 等库里真的出现「用户上传」的论文 —— 不能只看列表（列表本身可能就是 bug 的一部分） */
  const parsed = await waitFor(
    ev,
    `(async () => {
      const n = await new Promise((resolve) => {
        const q = indexedDB.open('researchpilot');
        q.onsuccess = () => {
          const db = q.result;
          if (!db.objectStoreNames.contains('papers')) return resolve(0);
          const all = db.transaction('papers', 'readonly').objectStore('papers').getAll();
          all.onsuccess = () => resolve((all.result || []).filter((p) => (p.corpusId ?? 'user-import') === 'user-import').length);
          all.onerror = () => resolve(0);
        };
        q.onerror = () => resolve(0);
      });
      return n > 0;
    })()`,
    180000,
    'PDF 解析（库里出现用户论文）',
  );
  await sleep(1200);
  const dbAfter = await idbPapers(ev);
  const userPapers = (dbAfter.papers || []).filter((p) => p.corpusId === 'user-import');
  console.log(
    `   库里用户论文 ${userPapers.length} 篇：${userPapers
      .map((p) => `${p.title.slice(0, 26)}（${p.parseStatus}, ${p.chars} 字, ${p.pages} 页）`)
      .join(' | ')}`,
  );
  const after = await uploadList(ev);
  const ddpmIn = after.names.findIndex((n) => /denoising|diffusion|2006\.11239/i.test(n));
  console.log(`   导入后列表（${after.count} 篇）：${after.names.map((n) => n.slice(0, 28)).join(' | ')}`);
  check('导入的论文出现在方法提取页的列表里（不再静默留在案例列表）', ddpmIn >= 0);
  check(
    '列表/页头计数指向同一范围（列表条数 = 页头「共 N 篇」）',
    await ev(`(() => {
      const t=(document.querySelector('.work2-list')||{}).innerText||'';
      const m=t.match(/共\\s*(\\d+)\\s*篇/);
      const n=document.querySelectorAll('.main-inner .pitem').length;
      return !!m && Number(m[1]) === n;
    })()`),
  );
  if (ddpmIn >= 0) {
    await ev(`(() => { const it=[...document.querySelectorAll('.main-inner .pitem')][${ddpmIn}]; if(it) it.click(); return true; })()`);
    await sleep(900);
  }
  const detail = await ev(`(() => {
    const h=(document.querySelector('.work2-detail .detail-head h3')||{}).textContent||'';
    const btns=[...document.querySelectorAll('.work2-detail button')].map((b)=>b.textContent.trim());
    return { head: h.trim(), btns, inner: (document.querySelector('.work2-detail')||{}).innerText||'' };
  })()`);
  check('可以打开刚导入的论文（右侧详情标题 = 该论文）', /denoising|diffusion|2006\.11239/i.test(detail.head), detail.head.slice(0, 40));
  check(
    '该论文的抽取入口可用（开始提取字段 / 配置模型后提取）',
    detail.btns.some((b) => /提取字段|配置模型后提取/.test(b)),
    detail.btns.filter((b) => /提取|配置/.test(b)).join(' / '),
  );

  // ---- S1b：标题不能把摘要句当已确认标题 ----
  const fresh = (dbAfter.papers || []).find((p) => p.corpusId === 'user-import');
  const storedTitle = fresh ? fresh.title : '';
  const titleUi = await ev(`(() => {
    const h=(document.querySelector('.work2-detail .detail-head')||{}).innerText||'';
    return { text: h.slice(0, 160), badge: /标题待确认|标题未确认/.test(h) };
  })()`);
  const titleIsSentence = /[.?!;]\s+[A-Za-z(]/.test(storedTitle) || storedTitle.length > 160;
  console.log(`   库里标题：${storedTitle.slice(0, 90)}`);
  console.log(`   详情标题区：${titleUi.text.replace(/\n/g, ' ').slice(0, 90)}`);
  check(
    '非预置 PDF 的标题不会把摘要句当成已确认标题（要么标题正确，要么界面标「标题待确认」）',
    !titleIsSentence || titleUi.badge,
    `标题像摘要句=${titleIsSentence}｜界面待确认标记=${titleUi.badge}｜titleFrom=${fresh ? fresh.titleFrom : '?'}`,
  );
  await shot(send, '01-导入后方法提取页可找到新论文.png');

  // ---- S3：损坏 PDF → 失败可见 → 重新选择并真正重新解析 ----
  const setBad = await setFileInput(send, [BAD_PDF]);
  check('可以放入损坏的 PDF', setBad === 'OK', String(setBad));
  const failedVisible = await waitFor(
    ev,
    `[...document.querySelectorAll('.main-inner .pitem .st')].some((s)=>/(解析失败|解析文本 · 失败)/.test(s.textContent))`,
    60000,
    '损坏 PDF 报错',
  );
  check('损坏 PDF 解析失败后可见（状态显示「解析失败」）', failedVisible);
  const failedIdx = await ev(`(() => [...document.querySelectorAll('.main-inner .pitem')].findIndex((x)=>/(解析失败|解析文本 · 失败)/.test(((x.querySelector('.st')||{}).textContent||''))))()`);
  if (failedIdx >= 0) {
    await ev(`(() => { const it=[...document.querySelectorAll('.main-inner .pitem')][${failedIdx}]; if(it) it.click(); return true; })()`);
    await sleep(800);
  }
  const failDetail = await ev(`(() => {
    const d=(document.querySelector('.work2-detail')||{}).innerText||'';
    return { text: d.slice(0, 400), btns: [...document.querySelectorAll('.work2-detail button')].map((b)=>b.textContent.trim()) };
  })()`);
  const retryLabel = failDetail.btns.find((b) => /解析|重试|重新选择/.test(b)) || '';
  check('失败详情给出的按钮是「重新解析 / 重新选择 PDF」，不是模型抽取', /重新解析|重新选择|重新导入/.test(retryLabel), retryLabel || '(无相关按钮)');
  const detailText = (v) => ev(`(() => { const d=(document.querySelector('.work2-detail')||{}).innerText||''; return { text: d.slice(0, 500), model: /未配置模型|模型接口|apiKey|接口地址/.test(d), pdfErr: /文本层|无法打开|解析/.test(d) }; })()`);

  // ---- 分支 1：文件还在本次会话的内存里 → 直接重解析，不该再弹一次选择框 ----
  check('按钮文案与真实行为一致（文件还在内存里 → 直接重新解析）', /重新解析这份 PDF/.test(retryLabel), retryLabel);
  await ev(`(() => { window.__picker = 0; document.addEventListener('click', (e)=>{ const t=e.target; if(t && t.tagName==='INPUT' && t.type==='file') window.__picker++; }, true); return true; })()`);
  await click(ev, retryLabel);
  await sleep(2500);
  const afterRetry = await detailText();
  check('直接重解析：报的是 PDF 层问题，不是模型配置问题（没有拿模型抽取冒充）', afterRetry.pdfErr && !afterRetry.model, afterRetry.text.replace(/\n/g, ' ').slice(0, 100));
  const dbCorrupt = await idbPapers(ev);
  const corruptPaper = (dbCorrupt.papers || []).find((x) => /corrupt/i.test(x.title));
  check(
    '损坏文件重解析后仍然是失败状态，且原因是 PDF 层（不会假装成功）',
    !!corruptPaper && corruptPaper.parseStatus === 'failed' && /文本层|无法打开|解析/.test(corruptPaper.parseError) && !/模型|接口/.test(corruptPaper.parseError),
    corruptPaper ? corruptPaper.parseStatus + '｜' + corruptPaper.parseError.slice(0, 60) : '(库里找不到 corrupt 那篇)',
  );

  // ---- 分支 2：刷新页面（内存里的 File 没了）→ 必须请用户重新选文件，并且真的重新解析 ----
  await send('Page.reload');
  await sleep(6000);
  await click(ev, '体验视觉论文案例');
  await sleep(4000);
  await goMore(ev, '方法提取');
  const banner = await ev(`(() => {
    const b=document.querySelector('.ownentry');
    return b ? b.innerText.replace(/\\n/g, ' ').slice(0, 120) : '';
  })()`);
  console.log(`   刷新后在方法提取页看到的入口横幅：${banner || '(没有)'}`);
  check('刷新后（范围回到案例）自传论文不在列表时，页面给出醒目入口', /你上传的 [0-9]+ 篇论文不在当前列表/.test(banner), banner);
  const toOwn = await click(ev, '查看我上传的');
  await sleep(1200);
  check('点「查看我上传的 N 篇论文」可以切到自传论文范围', toOwn);
  const ownList = await uploadList(ev);
  console.log(`   切到自传范围后列表：${ownList.names.map((n) => n.slice(0, 24)).join(' | ')}`);
  check('自传范围里能看到之前导入的论文（含失败的那篇）', ownList.count >= 2 && ownList.states.some((s) => /(解析失败|解析文本 · 失败)/.test(s)), `${ownList.count} 篇：${ownList.states.join(' / ')}`);
  const failIdx2 = await ev(`(() => [...document.querySelectorAll('.main-inner .pitem')].findIndex((x)=>/(解析失败|解析文本 · 失败)/.test(((x.querySelector('.st')||{}).textContent||''))))()`);
  if (failIdx2 >= 0) {
    await ev(`(() => { const it=[...document.querySelectorAll('.main-inner .pitem')][${failIdx2}]; if(it) it.click(); return true; })()`);
    await sleep(900);
  }
  const label2 = await ev(`(() => { const b=[...document.querySelectorAll('.work2-detail button')].find((x)=>/解析|重新选择/.test(x.textContent)); return b ? b.textContent.trim() : ''; })()`);
  check('刷新后按钮变成「重新选择 PDF 并重新解析」（诚实告知要重新选文件）', /重新选择/.test(label2), label2 || '(无)');
  await ev(`(() => { window.__picker = 0; document.addEventListener('click', (e)=>{ const t=e.target; if(t && t.tagName==='INPUT' && t.type==='file') window.__picker++; }, true); return true; })()`);
  await click(ev, label2 || '重新选择');
  await sleep(1200);
  const pickerOpened = await ev(`window.__picker || 0`);
  check('点它确实打开文件选择（不是直接跑模型抽取）', pickerOpened > 0, `触发 ${pickerOpened} 次`);
  await setFileInput(send, [BAD_PDF]);
  await sleep(3000);
  const afterReselect = await detailText();
  check('重新选文件后确实重新跑了 PDF 解析（仍是 PDF 层错误，且不是因为模型）', afterReselect.pdfErr && !afterReselect.model, afterReselect.text.replace(/\n/g, ' ').slice(0, 100));
  await shot(send, '02-损坏PDF失败与重新选择.png');

  // ---- S4：切到 NLP → 实验可比性不得承诺重载能补出记录 ----
  await goMore(ev, '论文集合');
  await ev(`(() => { const d=document.querySelector('.main-inner details.libmanage'); if(d) d.open=true; return true; })()`);
  await sleep(400);
  const switched = await click(ev, '换成开发回归样例（NLP）');
  await sleep(4000);
  check('可以切换到 NLP 开发回归样例', switched);
  // 品牌栏的行目录里这一项就叫「实验可比性」
  await goMore(ev, '实验可比性');
  await waitFor(ev, `/实验可比性/.test((document.querySelector('.main-inner')||document.body).innerText)`, 20000, '进入实验可比性');
  const exp = await ev(`(() => { const d=document.querySelector('.main-inner')||document.body; return (d.innerText||'').slice(0, 900); })()`);
  console.log(`   实验页文案：${exp.replace(/\n+/g, ' ').slice(0, 200)}`);
  check('实验可比性页不再承诺「重新加载演示案例（补齐实验记录）」', !/补齐实验记录/.test(exp));

  // 再加载这份语料的预置缓存 → 必须如实说明「本来就没有实验记录」
  await click(ev, '加载');
  await waitFor(
    ev,
    `(() => { const t=(document.querySelector('.main-inner')||document.body).innerText; return /没有实验记录/.test(t) || /0 条实验记录/.test(t); })()`,
    90000,
    'NLP 预置缓存加载完成',
  );
  await sleep(1500);
  const exp2 = await ev(`(() => { const d=document.querySelector('.main-inner')||document.body; return (d.innerText||'').slice(0, 900); })()`);
  console.log(`   加载后的实验页文案：${exp2.replace(/\n+/g, ' ').slice(0, 220)}`);
  check('加载后如实说明这份语料没有实验记录，且不再提示「再来一次重载」', /没有实验记录/.test(exp2) && !/补齐/.test(exp2));
  check(
    '如实说明这份语料没有实验记录（重载也不会多出来）',
    /没有实验记录|不含实验记录|本来就没有|重载也不会|不会多出来/.test(exp),
  );
  check('给出切回有实验记录的视觉案例的入口', /视觉方法演进案例|换成正式视觉案例/.test(exp));
  await shot(send, '03-NLP无实验记录的如实说明.png');

  child.kill();
}

// ---------------------------------------------------------------- 阶段 B
console.log('');
console.log('=== 阶段 B（独立数据目录 #2）：空数据 → 同一 PDF 上传两次 → 只保留一份 ===');
{
  const { send, ev, child } = await openBrowser('b', 9512);
  await sleep(3200);
  await loadVisionCase(ev);
  await goMore(ev, '方法提取');
  const userCountExpr = `(async () => {
    const n = await new Promise((resolve) => {
      const q = indexedDB.open('researchpilot');
      q.onsuccess = () => {
        const db = q.result;
        if (!db.objectStoreNames.contains('papers')) return resolve(0);
        const all = db.transaction('papers','readonly').objectStore('papers').getAll();
        all.onsuccess = () => resolve((all.result || []).filter((p) => (p.corpusId ?? 'user-import') === 'user-import').length);
        all.onerror = () => resolve(0);
      };
      q.onerror = () => resolve(0);
    });
    return n;
  })()`;
  await setFileInput(send, [GOOD_PDF]);
  await waitFor(ev, `(async () => { const n = await (${userCountExpr}); return n > 0; })()`, 180000, '第一次上传');
  await sleep(1500);
  const first = await uploadList(ev);
  const firstUser = await ev(userCountExpr);
  await setFileInput(send, [GOOD_PDF]);
  await sleep(8000);
  const second = await uploadList(ev);
  const secondUser = await ev(userCountExpr);
  console.log(`   库里用户论文：第一次 ${firstUser} 篇 → 第二次 ${secondUser} 篇`);
  const same = second.names.filter((n) => /denoising|diffusion|2006\.11239/i.test(n)).length;
  console.log(`   列表：第一次 ${first.count} 篇 → 第二次 ${second.count} 篇；列表里同名条目 ${same} 个`);
  check(
    '同一 PDF 上传两次只保留一份（按内容哈希去重）',
    secondUser === 1 && firstUser === 1 && second.count === first.count,
    `库里 ${firstUser} → ${secondUser}，列表 ${first.count} → ${second.count}，列表同名 ${same}`,
  );
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
