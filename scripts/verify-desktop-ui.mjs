/**
 * 本脚本随仓库提交（scripts/ 下），可直接在有 Chrome 的机器上运行；设 CHROME_PATH 可指定浏览器。
 *
 * 桌面端 UI 修复的验收走查（1280×800 / 1440×900）。
 *
 * 覆盖本轮要求：
 *   画布高度 440–560；详情并列不覆盖画布；未选中元素仍可读；
 *   关系总数与当前显示数一致；键盘可选中节点与连线（Enter 打开、关闭后焦点还原）；
 *   方法提取页 5 篇案例论文全部存在且 ResNet / ViT 可打开；
 *   方法关系页主标是「短名 · 年份」；
 *   实验比较页推荐对照明确标注「最多 3 条」。
 * 同时为研究地图 / 方法提取 / 方法关系 / 实验比较 / 阅读路线各出一张截图（每个视口一套）。
 *
 * 用法：node .build/verify-desktop-ui.mjs
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
    console.error('找不到 Chrome/Chromium 可执行文件：请设置 CHROME_PATH 环境变量后重试。');
    process.exit(2);
  }
  return hit;
};

const ROOT = resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const DIST = join(ROOT, 'dist');
const SHOTS = join(ROOT, 'docs', 'desktop-ui');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
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

const CH = resolveChrome();
const profile = join(ROOT, '.build', 'desktop-ui-' + Date.now());
mkdirSync(profile, { recursive: true });
mkdirSync(SHOTS, { recursive: true });
const child = spawn(
  CH,
  ['--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars', '--remote-debugging-port=9488', '--user-data-dir=' + profile, '--window-size=1440,900', url],
  { stdio: 'ignore' },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 80; i++) {
  try {
    await (await fetch('http://127.0.0.1:9488/json/version')).json();
    break;
  } catch {
    await sleep(300);
  }
}
const list = await (await fetch('http://127.0.0.1:9488/json/list')).json();
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
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
  if (r?.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval error');
  return r?.result?.value;
};
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(SHOTS, name), Buffer.from(r.data, 'base64'));
};
const click = (t) =>
  ev(`(() => { const b=[...document.querySelectorAll('button')].find((x)=>(x.textContent||'').replace(/\\s+/g,' ').trim().includes(${JSON.stringify(t)})); if(!b) return false; b.click(); return true; })()`);
const goMore = async (t) => {
  await ev(`(() => { const b=document.querySelector('.mapbrand .dirbtn'); if(b) b.click(); return true; })()`);
  await sleep(900);
  const ok = await click(t);
  await sleep(1400);
  return ok;
};
const waitFor = async (expr, ms, label) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await ev(expr)) return true;
    await sleep(300);
  }
  console.log(`   （等待超时：${label}）`);
  return false;
};
/** 给 SVG 里第 i 个可聚焦元素发一个真实键盘事件 */
const keyOn = (selector, index, key) =>
  ev(`(() => {
  const els = [...document.querySelectorAll(${JSON.stringify(selector)})];
  const el = els[${index}];
  if (!el) return false;
  el.focus();
  el.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true }));
  return document.activeElement === el || el.contains(document.activeElement);
})()`);

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

await send('Runtime.enable');
await send('Page.enable');
await sleep(3400);
// 真实用户路径：主按钮「体验视觉论文案例」直接进研究地图（2026-10-09 起）。
// 本脚本后续断言在论文集合页上，因此再显式从目录进入论文集合。
await click('体验视觉论文案例');
await waitFor(`document.querySelectorAll('.mapstage .mnode').length >= 5`, 60000, '视觉案例加载');
await goMore('论文集合');
await waitFor(`document.querySelectorAll('.paper-title').length >= 5`, 45000, '论文集合渲染');
await sleep(1200);

const VIEWPORTS = [
  ['1280x800', 1280, 800],
  ['1440x900', 1440, 900],
];

for (const [tag, w, h] of VIEWPORTS) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await sleep(700);
  console.log('');
  console.log(`===== ${tag} =====`);

  // ---------- 研究地图 ----------
  await goMore('研究地图');
  const canvas = await ev(`(() => {
  const box = document.querySelector('.mapwork').getBoundingClientRect();
  const stage = document.querySelector('.mapstage').getBoundingClientRect();
  return { h: Math.round(box.height), w: Math.round(box.width), stageW: Math.round(stage.width), nodes: document.querySelectorAll('.mnode').length, edges: document.querySelectorAll('.medge').length };
})()`);
  check(`[${tag}] 画布高度在 440–560px`, canvas.h >= 440 && canvas.h <= 560, `${canvas.h}px`);
  check(`[${tag}] 画布画出 5 个节点与可见连线`, canvas.nodes === 5 && canvas.edges > 0, `节点 ${canvas.nodes} / 连线 ${canvas.edges}`);

  // 键盘：节点 Enter 打开详情 → 关闭 → 焦点回到原节点
  const nodeFocused = await keyOn('.mapstage .mnode', 0, 'Enter');
  await sleep(700);
  const opened = await ev(`(() => {
  const d = document.querySelector('.mapdetail');
  const stage = document.querySelector('.mapstage').getBoundingClientRect();
  const panel = d.getBoundingClientRect();
  return {
    open: d.classList.contains('open'),
    panelW: Math.round(panel.width),
    overlaps: !(panel.left >= stage.right - 1 || panel.right <= stage.left + 1),
    text: (d.innerText || '').slice(0, 40),
  };
})()`);
  check(`[${tag}] 键盘 Enter 可以打开节点详情`, nodeFocused && opened.open, opened.text.replace(/\n/g, ' '));
  check(`[${tag}] 详情面板与画布并列，不覆盖画布`, !opened.overlaps && opened.panelW > 240, `面板宽 ${opened.panelW}px`);
  // 详情打开状态的截图：直接看「画布 + 并列详情」的实际版面
  await shot(`地图-研究地图-详情打开-${tag}.png`);

  const closed = await ev(`(() => {
  const x = document.querySelector('.mapdetail .dh .x');
  if (!x) return null;
  x.click();
  return true;
})()`);
  await sleep(500);
  const focusBack = await ev(`(() => {
  const el = document.activeElement;
  return !!el && el.classList && el.classList.contains('mnode');
})()`);
  check(`[${tag}] 关闭详情后焦点回到原来的节点（键盘不迷路）`, closed === true && focusBack);

  // 键盘：连线 Enter
  const edgeFocused = await keyOn('.mapstage .medge', 0, 'Enter');
  await sleep(700);
  const edgeOpened = await ev(`(() => {
  const t = (document.querySelector('.mapdetail') || {}).innerText || '';
  return { open: document.querySelector('.mapdetail').classList.contains('open'), text: t.slice(0, 40) };
})()`);
  check(`[${tag}] 键盘 Enter 可以打开连线详情`, edgeFocused && edgeOpened.open, edgeOpened.text.replace(/\n/g, ' '));

  // 未选中元素仍可读（不透明度不低于 0.5）
  const opacities = await ev(`(() => {
  const nodes = [...document.querySelectorAll('.mapstage .mnode')].map((g)=>Number(getComputedStyle(g).opacity));
  const edges = [...document.querySelectorAll('.mapstage .medge path.line')].map((p)=>Number(getComputedStyle(p).opacity));
  return { minNode: Math.min(...nodes), minEdge: Math.min(...edges) };
})()`);
  check(`[${tag}] 选中后未选中节点仍可读（≥0.5）`, opacities.minNode >= 0.5, `最小 ${opacities.minNode}`);
  check(`[${tag}] 选中后未选中连线仍可读（≥0.45）`, opacities.minEdge >= 0.45, `最小 ${opacities.minEdge}`);

  // 关系可见性三态（2026-10-09 改版）：默认「全部」= 画布画出全部关系，不再默认藏起大部分
  await ev(`(() => { const x=document.querySelector('.mapdetail .dh .x'); if(x) x.click(); return true; })()`);
  await sleep(400);
  const measureRel = () => ev(`(() => {
  const t = (document.querySelector('.maphead-meta') || {}).innerText || '';
  const m = t.match(/关系\\s*(\\d+)\\s*条\\s*·\\s*当前显示\\s*(\\d+)\\s*条/);
  const hid = t.match(/隐藏\\s*(\\d+)\\s*条/);
  const on = document.querySelector('.relview .chip.on');
  return {
    chip: on ? on.textContent.trim() : '',
    chipCount: document.querySelectorAll('.relview .chip').length,
    total: m ? Number(m[1]) : -1,
    visible: m ? Number(m[2]) : -1,
    hidden: hid ? Number(hid[1]) : -1,
    edges: document.querySelectorAll('.mapstage .medge').length,
    reasonText: (t.match(/隐藏\\s*\\d+\\s*条：[^—\\n]*/) || [''])[0].trim(),
  };
})()`);
  const relDefault = await measureRel();
  check(
    `[${tag}] 关系可见性默认「全部」，画布画出全部关系（不再默认隐藏大部分）`,
    /^全部/.test(relDefault.chip) &&
      relDefault.total > 0 &&
      relDefault.visible === relDefault.total &&
      relDefault.edges === relDefault.visible,
    `默认=${relDefault.chip}｜总数 ${relDefault.total} / 显示 ${relDefault.visible} / 连线 ${relDefault.edges}`,
  );
  check(
    `[${tag}] 存在「全部 / 可用 / 待核查」三态控件`,
    relDefault.chipCount === 3,
    `控件数 ${relDefault.chipCount}`,
  );
  // 切到「可用」收窄：隐藏数必须 = 总数 − 显示数，并写清原因
  await ev(
    `(() => { const c=[...document.querySelectorAll('.relview .chip')].find((x)=>/^可用/.test(x.textContent.trim())); if(c) c.click(); return true; })()`,
  );
  await sleep(800);
  const relFiltered = await measureRel();
  check(
    `[${tag}] 切到「可用」后：隐藏数 = 总数 − 显示数，并写清隐藏原因`,
    /^可用/.test(relFiltered.chip) &&
      relFiltered.hidden === relFiltered.total - relFiltered.visible &&
      /关系不明确|待核查|无引文/.test(relFiltered.reasonText),
    `总数 ${relFiltered.total} − 显示 ${relFiltered.visible} = 隐藏 ${relFiltered.hidden}（${relFiltered.reasonText}）`,
  );
  check(
    `[${tag}] 收窄后画布连线数与状态行一致`,
    relFiltered.edges === relFiltered.visible,
    `显示 ${relFiltered.visible} / 连线 ${relFiltered.edges}`,
  );
  // 回到「全部」，再验「只看有证据关系」这条正交收窄
  await ev(
    `(() => { const c=[...document.querySelectorAll('.relview .chip')].find((x)=>/^全部/.test(x.textContent.trim())); if(c) c.click(); return true; })()`,
  );
  await sleep(700);
  /**
   * 2026-10-09 修：判据从 `Boolean(r.evidence)` 改为 `evidence.verified === true`（引文必须已通过定位校验）；
   * 同时修掉「全部 + 只看有证据」下隐藏原因统计为 0 的 bug（原判断写成 `bucket === relView`，
   * 而 relView === 'all' 时该式恒假）。
   */
  await ev(`(() => { const b=[...document.querySelectorAll('.mapopts button')].find((x)=>/筛选/.test(x.textContent)); if(b) b.click(); return true; })()`);
  await sleep(500);
  await ev(`(() => { const cb=document.querySelector('.mapopts input[type=checkbox]'); if(cb && !cb.checked) cb.click(); return true; })()`);
  await sleep(900);
  const relOnly = await measureRel();
  check(
    `[${tag}] 「全部 + 只看有证据」：隐藏数 = 总数 − 显示数，且写明是「无引文或未通过校验」`,
    relOnly.hidden === relOnly.total - relOnly.visible && /无引文或未通过校验/.test(relOnly.reasonText),
    `总数 ${relOnly.total} − 显示 ${relOnly.visible} = 隐藏 ${relOnly.hidden}（${relOnly.reasonText}）`,
  );
  check(
    `[${tag}] 「只看有证据」后画布连线数与状态行一致`,
    relOnly.visible > 0 && relOnly.edges === relOnly.visible,
    `显示 ${relOnly.visible} / 连线 ${relOnly.edges}`,
  );
  // 关掉收窄、收起弹层，回到默认态再截图
  await ev(`(() => { const cb=document.querySelector('.mapopts input[type=checkbox]'); if(cb && cb.checked) cb.click(); return true; })()`);
  await sleep(700);
  await ev(`(() => { const b=[...document.querySelectorAll('.mapopts button')].find((x)=>/筛选/.test(x.textContent)); if(b) b.click(); return true; })()`);
  await sleep(500);
  await shot(`地图-研究地图-${tag}.png`);

  // ---------- 方法提取（2026-10-10 按草稿逻辑重做：这里是「攒文件 → 一键分析」，不再列论文）----------
  await goMore('方法提取');
  const upload = await ev(`(() => ({
  zone: !!document.querySelector('.main-inner .upload-zone'),
  queued: document.querySelectorAll('.main-inner .filecard').length,
  empty: (document.querySelector('.main-inner .up-empty') || {}).textContent || '',
  start: (() => { const b = [...document.querySelectorAll('.main-inner button')].find((x)=>/开始梳理脉络/.test(x.textContent)); return b ? { text: b.textContent.trim(), disabled: b.disabled } : null; })(),
}))()`);
  check(
    `[${tag}] 方法提取页是上传页（拖拽区 + 待处理队列，队列为空）`,
    upload.zone === true && upload.queued === 0 && /尚未选择任何文件/.test(upload.empty),
    JSON.stringify(upload).slice(0, 160),
  );
  check(`[${tag}] 队列为空时「开始梳理脉络」不可点`, upload.start?.disabled === true, JSON.stringify(upload.start));
  await shot(`地图-方法提取-${tag}.png`);

  // ---------- 方法关系 ----------
  await goMore('方法关系图');
  await sleep(600);
  const graph = await ev(`(() => {
  // 主标 = 每个节点里的第一行（短名 · 年份）；第二行是完整标题
  const heads = [...document.querySelectorAll('.graph-wrap .gnode foreignObject > div > div:first-child')].map((d)=>d.textContent.trim());
  const titles = [...document.querySelectorAll('.graph-wrap .gnode foreignObject > div > div:nth-child(2)')].map((d)=>d.textContent.trim());
  return {
    heads,
    titles,
    svgNodes: document.querySelectorAll('.graph-wrap .gnode').length,
    svgEdges: document.querySelectorAll('.graph-wrap .grel').length,
    ariaLabels: [...document.querySelectorAll('.graph-wrap .gnode')].map((g)=>g.getAttribute('aria-label') || ''),
  };
})()`);
  check(
    `[${tag}] 关系图节点主标是稳定短名（不再是长标题硬截断）`,
    graph.heads.length === 5 && graph.heads.every((t) => /^(ResNet|ViT|DeiT|Swin|ConvNeXt)\b/.test(t)),
    graph.heads.join(' / '),
  );
  check(
    `[${tag}] 主标带年份，完整标题放在第二行`,
    graph.heads.every((t) => /·\s*(2015|2020|2021|2022)/.test(t)) && graph.titles.every((t) => t.length > 10),
    graph.titles[0]?.slice(0, 40),
  );
  check(
    `[${tag}] 节点 aria-label 含短名与完整标题（屏幕阅读器可读）`,
    graph.ariaLabels.length === 5 && graph.ariaLabels.every((a) => a.length > 10),
    graph.ariaLabels[0]?.slice(0, 50),
  );
  check(`[${tag}] 关系图的节点与连线都带键盘语义（role=button）`, graph.svgNodes > 0 && graph.svgEdges > 0, `节点 ${graph.svgNodes} / 连线 ${graph.svgEdges}`);
  const graphKb = await keyOn('.graph-wrap .grel', 0, 'Enter');
  await sleep(600);
  const graphOpened = await ev(`/关系图/.test(document.body.innerText) && !!document.querySelector('.card')`);
  check(`[${tag}] 关系图连线可用键盘 Enter 打开详情`, graphKb && graphOpened);
  await shot(`地图-方法关系-${tag}.png`);

  // ---------- 实验比较 ----------
  await goMore('实验可比性');
  await sleep(900);
  const exp = await ev(`(() => {
  const t = document.body.innerText || '';
  return { label: /推荐对照（最多 3 条/.test(t), hasMore: /显示其余 \\d+ 对|只看前 3 对/.test(t), rows: document.querySelectorAll('.main-inner .exprow3').length };
})()`);
  check(`[${tag}] 推荐对照明确标注「最多 3 条」`, exp.label);
  check(`[${tag}] 存在「显示其余 N 对 / 只看前 3 对」的显式展开`, exp.hasMore);
  await shot(`地图-实验比较-${tag}.png`);

  // ---------- 阅读路线 ----------
  await goMore('阅读路线');
  await sleep(900);
  const plan = await ev(`(() => ({ h: Math.round(document.querySelector('.main-inner').getBoundingClientRect().height), has: /阅读路线/.test(document.body.innerText) }))()`);
  check(`[${tag}] 阅读路线页可正常渲染`, plan.has && plan.h > 200, `内容高 ${plan.h}px`);
  await shot(`地图-阅读路线-${tag}.png`);
}

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
