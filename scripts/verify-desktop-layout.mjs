/**
 * 本脚本随仓库提交（scripts/ 下），可直接在有 Chrome 的机器上运行；设 CHROME_PATH 可指定浏览器。
 *
 * 桌面端验收走查（本轮：只验收电脑端 1280×800 与 1440×900）
 *
 * 用系统 Chrome 无头 + CDP 在真实 DOM 上量，不做"看图说话"：
 *   横向溢出 / 主内容宽度 / 实心主按钮数量 / 页面标题字号一致性 /
 *   关键正文最小字号 / 折叠区默认是否收起 / 首屏不滚动可见的关键内容 / 是否有嵌套卡片
 * 并在每个视口为每个页面存一张截图。
 *
 * 用法：node .build/verify-desktop.mjs [--url http://...]
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
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
const SHOTS = join(ROOT, 'docs', 'desktop-verify');

const argv = process.argv.slice(2);
const urlArgIdx = argv.indexOf('--url');
const externalUrl = urlArgIdx >= 0 ? argv[urlArgIdx + 1] : undefined;

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0;
let fail = 0;
const failures = [];
const report = [];
function check(name, cond, extra = '') {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}${extra ? ` 〔${extra}〕` : ''}`);
  } else {
    fail++;
    failures.push(name + (extra ? ` — ${extra}` : ''));
    console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`);
  }
}
function note(k, v) {
  report.push(`  ${k} = ${v}`);
  console.log(`  · ${k} = ${v}`);
}

async function startStaticServer() {
  const server = createServer(async (req, res) => {
    try {
      let p = decodeURIComponent((req.url || '/').split('?')[0]);
      if (p.endsWith('/')) p += 'index.html';
      const f = normalize(join(DIST, p));
      if (!f.startsWith(DIST)) return res.writeHead(403).end();
      const st = await stat(f);
      if (!st.isFile()) throw new Error('nf');
      res.writeHead(200, { 'Content-Type': MIME[extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(await readFile(f));
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, url: `http://127.0.0.1:${server.address().port}/` };
}

const CHROME = resolveChrome();

const VIEWPORTS = [
  ['1280x800', 1280, 800],
  ['1440x900', 1440, 900],
];
const PAGES = ['论文集合', '方法提取', '研究地图', '实验可比性', '阅读路线'];

async function main() {
  if (!CHROME) {
    console.error('未找到 Chrome/Edge，无法执行桌面验收。');
    process.exit(2);
  }
  let staticSrv;
  let target = externalUrl;
  if (!target) {
    staticSrv = await startStaticServer();
    target = staticSrv.url;
  }
  console.log(`桌面验收目标：${target}`);

  const profile = join(ROOT, '.build', 'desktop-' + Date.now());
  mkdirSync(profile, { recursive: true });
  mkdirSync(SHOTS, { recursive: true });
  const port = 9444;
  const child = spawn(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--hide-scrollbars',
      `--remote-debugging-port=${port}`,
      '--user-data-dir=' + profile,
      '--window-size=1440,900',
      target,
    ],
    { stdio: 'ignore' },
  );

  let list = null;
  for (let i = 0; i < 80; i++) {
    try {
      list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      if (list.some((t) => t.type === 'page')) break;
    } catch {
      /* retry */
    }
    await sleep(300);
  }
  const page = (list || []).find((t) => t.type === 'page');
  if (!page) {
    console.error('无法连接到浏览器调试端口。');
    child.kill();
    process.exit(2);
  }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0;
  const pending = new Map();
  const pageErrors = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const cb = pending.get(m.id);
      pending.delete(m.id);
      cb(m.result);
      return;
    }
    if (m.method === 'Runtime.exceptionThrown') {
      pageErrors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    }
  });
  const send = (method, params = {}) => {
    const i = ++id;
    ws.send(JSON.stringify({ id: i, method, params }));
    return new Promise((r) => pending.set(i, r));
  };
  const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }))?.result?.value;
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(SHOTS, name), Buffer.from(r.data, 'base64'));
  };
  const click = (t) =>
    ev(`(() => { const b=[...document.querySelectorAll('button')].find((x)=>(x.textContent||'').replace(/\\s+/g,' ').trim().includes(${JSON.stringify(t)})); if(!b) return false; b.click(); return true; })()`);
  const waitFor = async (expr, timeoutMs, label) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      if (await ev(expr)) return true;
      await sleep(300);
    }
    console.log(`     （等待超时：${label}）`);
    return false;
  };
  const goMore = async (cardText) => {
    await ev(`(() => { const b = document.querySelector('.mapbrand .dirbtn'); if (b) b.click(); return true; })()`);
    await sleep(900);
    const ok = await ev(
      `(() => { const b=[...document.querySelectorAll('button')].find((x)=>x.textContent.includes(${JSON.stringify(cardText)})); if(!b) return false; b.click(); return true; })()`,
    );
    await sleep(1500);
    return ok;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await sleep(3400);

  // 载入正式视觉案例
  await click('体验视觉论文案例');
  await waitFor(`document.querySelectorAll('.paper-title').length >= 5`, 45000, '视觉案例加载');
  await sleep(1200);

  /** 单页测量 */
  const measure = async () =>
    ev(`(() => {
  const de = document.documentElement;
  const inner = document.querySelector('.main-inner');
  const r = inner ? inner.getBoundingClientRect() : null;
  const inView = (el) => { const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0 && b.bottom > 0 && b.top < window.innerHeight; };
  const primaries = [...document.querySelectorAll('.main-inner button.btn.primary, .main-inner button.primary')].filter(inView);
  // 页面主标题：论文集合/方法提取/实验可比性/阅读路线用 .pgtitle，研究地图用自己的 .maphead 里的大标题，
  // 两者都是 h2 —— 统一按 h2 取，避免「地图页找不到标题」这种假失败。
  const title = document.querySelector('.main-inner h2');
  const wide = [...document.querySelectorAll('.main-inner *')].filter((el) => {
    const b = el.getBoundingClientRect();
    return b.width > 0 && b.right > de.clientWidth + 1;
  }).map((el) => el.className && String(el.className).split(' ')[0]);
  const folds = [...document.querySelectorAll('.main-inner details.fold')];
  // 页头状态色：只看页头容器，不把表格/图例里的状态算进来
  const headChips = [...document.querySelectorAll('.main-inner .pagehead .status, .main-inner .maphead .status, .main-inner .pghead .status')];
  const statusChips = new Set(headChips.map((s) => String(s.className).replace('status', '').trim()));
  const isMeta = (el) => /(meta|dim|lab|small|tag|chip|status|kv|footnote)/.test(String(el.className));
  let floorFs = 99;
  let floorSample = '';
  let sentFs = 99;
  let sentSample = '';
  for (const el of document.querySelectorAll('.main-inner p, .main-inner li, .main-inner td, .main-inner span, .main-inner div, .main-inner strong')) {
    if (!inView(el)) continue;
    if (el.querySelector('p, li, td, span, div, strong')) continue;
    const t = (el.textContent || '').trim();
    if (t.length < 6) continue;
    const cls = String(el.className).split(' ')[0] || el.tagName;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (fs && fs < floorFs) { floorFs = fs; floorSample = cls + '：「' + t.slice(0, 16) + '…」'; }
    // 「承载解释的整句」：20 字以上、不是元数据类
    if (t.length >= 20 && t.length <= 400 && !isMeta(el) && fs && fs < sentFs) {
      sentFs = fs;
      sentSample = cls + '：「' + t.slice(0, 16) + '…」';
    }
  }
  return {
    clientW: de.clientWidth,
    scrollW: de.scrollWidth,
    mainW: r ? Math.round(r.width) : 0,
    mainLeft: r ? Math.round(r.left) : 0,
    primaries: primaries.length,
    titleFs: title ? parseFloat(getComputedStyle(title).fontSize) : 0,
    wideCount: wide.length,
    wideSample: wide.slice(0, 4),
    foldAll: folds.length,
    foldUnexpected: folds.filter((d) => d.open && !d.hasAttribute('open')).length,
    foldExplicit: folds.filter((d) => d.hasAttribute('open')).length,
    headChipCount: headChips.length,
    statusKinds: [...statusChips],
    floorFs: floorFs === 99 ? 0 : floorFs,
    floorSample,
    sentFs: sentFs === 99 ? 0 : sentFs,
    sentSample,
  };
})()`);

  const firstScreen = async () =>
    ev(`(() => {
  const inView = (el) => { const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0 && b.bottom > 0 && b.top < window.innerHeight - 4; };
  const titles = [...document.querySelectorAll('.main-inner .lrow .paper-title')].filter(inView);
  const exGroups = [...document.querySelectorAll('.main-inner .exgroup')].filter(inView);
  const railSteps = [...document.querySelectorAll('.main-inner .railstep')].filter(inView);
  const nodes = [...document.querySelectorAll('.main-inner .mnode')].filter(inView);
  const summary = [...document.querySelectorAll('.main-inner .resultsum, .main-inner .routesum')].filter(inView);
  const rowsLeft = [...document.querySelectorAll('.main-inner .rowsleft li, .main-inner .nxt li, .main-inner .steps li')].filter(inView).length;
  return {
    论文行: titles.length,
    论文首两行: titles.slice(0, 2).map((e) => e.textContent.trim().slice(0, 26)),
    实验分组: exGroups.length,
    路线步骤: railSteps.length,
    地图节点: nodes.length,
    摘要区: summary.length,
    未产出: rowsLeft,
  };
})()`);

  for (const [tag, w, h] of VIEWPORTS) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    await sleep(800);
    console.log('');
    console.log(`===== 视口 ${tag} =====`);
    let titleFsRef = 0;
    for (const pageName of PAGES) {
      const nav = await goMore(pageName);
      if (nav === false) {
        check(`[${tag}] 可以进入「${pageName}」`, false);
        continue;
      }
      await sleep(900);
      const m = await measure();
      const fs = await firstScreen();
      console.log(`  —— ${pageName} ——`);
      check(`[${tag}/${pageName}] 无整页横向溢出`, m.scrollW <= m.clientW + 1, `scrollW=${m.scrollW} clientW=${m.clientW}`);
      check(`[${tag}/${pageName}] 主内容内无越界元素`, m.wideCount === 0, m.wideCount ? `越界 ${m.wideCount} 个：${m.wideSample.join(',')}` : '0 个');
      check(`[${tag}/${pageName}] 首屏实心主按钮 ≤ 1`, m.primaries <= 1, `实测 ${m.primaries}`);
      // 字号规则（项目自己的口径）：12px 只给不承载关键解释的元数据；承载解释的整句用 --fs-aux(13.5px) 及以上
      check(`[${tag}/${pageName}] 无可见文字低于 12px（字号下限）`, m.floorFs >= 12 || m.floorFs === 0, `最小 ${m.floorFs}px ${m.floorSample}`);
      check(`[${tag}/${pageName}] 承载解释的整句正文 ≥ 13.5px`, m.sentFs >= 13.5 || m.sentFs === 0, `最小 ${m.sentFs}px ${m.sentSample}`);
      check(`[${tag}/${pageName}] 页头状态色 ≤ 3 种`, m.statusKinds.length <= 3, `页头 ${m.headChipCount} 个标签 / ${m.statusKinds.length} 种（${m.statusKinds.join('/')}）`);
      check(
        `[${tag}/${pageName}] 没有「意外展开」的折叠区（展开必须来自源码显式 open）`,
        m.foldUnexpected === 0,
        `意外 ${m.foldUnexpected} 个；共 ${m.foldAll} 个折叠区，其中源码显式 open ${m.foldExplicit} 个`,
      );
      if (titleFsRef === 0) titleFsRef = m.titleFs;
      else check(`[${tag}/${pageName}] 页面标题字号与其它页一致`, m.titleFs === titleFsRef, `${m.titleFs} vs ${titleFsRef}`);
      note(`[${tag}/${pageName}] 主内容宽度`, `${m.mainW}px（左边距 ${m.mainLeft}px，视口 ${m.clientW}px）`);
      note(`[${tag}/${pageName}] 首屏（不滚动）`, JSON.stringify(fs));
      await shot(`D-${pageName}-${tag}.png`);
    }

    // 首页：本轮不重做，只做「不溢出 + 首屏关键内容可见」的回归检查
    await ev(`(() => { const b = document.querySelector('.brand-title, .logo'); if (b) b.click(); return true; })()`);
    await sleep(1500);
    const homeM = await measure();
    const homeText = await ev(`(document.body.innerText || '').slice(0, 4000)`);
    console.log('  —— 首页 ——');
    check(`[${tag}/首页] 无整页横向溢出`, homeM.scrollW <= homeM.clientW + 1, `scrollW=${homeM.scrollW} clientW=${homeM.clientW}`);
    check(`[${tag}/首页] 首屏可见主文案与主按钮`, /梳理|方法|阅读/.test(homeText) && homeM.primaries >= 1, `主按钮 ${homeM.primaries}`);
    await shot(`D-首页-${tag}.png`);
  }

  await send('Emulation.clearDeviceMetricsOverride');
  console.log('');
  const errs = pageErrors.filter((e) => !/favicon/i.test(String(e)));
  check('走查期间无未处理的前端异常', errs.length === 0, errs.slice(0, 2).join(' | '));

  console.log('');
  console.log('—— 测量明细 ——');
  console.log(report.join('\n'));
  console.log('');
  console.log(`结果：通过 ${pass}，失败 ${fail}`);
  if (failures.length) {
    console.log('失败项：');
    for (const f of failures) console.log(`  - ${f}`);
  }
  console.log(`截图：${SHOTS}`);

  child.kill();
  if (staticSrv) staticSrv.server.close();
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error('桌面验收异常：', e);
  process.exit(2);
});
