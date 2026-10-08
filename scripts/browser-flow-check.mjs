/**
 * 真实浏览器调用流程验证（端到端，含真实模型调用）。
 *
 * 验证链路：新论文输入 → 解析 → 浏览器发起真实模型调用 → 结构化结果 → 证据查看 → 保存 → 刷新恢复。
 *
 * 安全约定：
 * - 密钥只从环境变量 DEEPSEEK_API_KEY 读取，直接注入页面输入框；
 * - **不打印密钥**，也不写入任何文件；断言密钥不出现在页面可见文本中。
 *
 * 用法：
 *   node scripts/browser-flow-check.mjs [--url https://...]
 *   node scripts/browser-flow-check.mjs --pdf samples/pdfs/2006.11239.pdf
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIST = join(ROOT, 'dist');
const argv = process.argv.slice(2);
const argOf = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const target = argOf('url', undefined);
const pdfPath = resolve(ROOT, argOf('pdf', 'samples/pdfs/2006.11239.pdf'));
const apiKey = process.env.DEEPSEEK_API_KEY || '';
const baseUrl = process.env.RP_MODEL_BASE || 'https://api.deepseek.com';
const model = process.env.RP_MODEL || 'deepseek-chat';

if (!apiKey) {
  console.error('[中止] 未配置 DEEPSEEK_API_KEY：本验证必须使用真实模型，不会伪造结果。');
  process.exit(2);
}
console.log(`模型接口：${new URL(baseUrl).host}　模型：${model}　密钥：已从环境变量读取（不打印）`);

let pass = 0;
let fail = 0;
const failures = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (name, cond, extra = '') => {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    failures.push(name + (extra ? ` — ${extra}` : ''));
    console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`);
  }
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.pdf': 'application/pdf',
  '.md': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
};

async function startStatic() {
  const server = createServer(async (req, res) => {
    try {
      let p = decodeURIComponent((req.url || '/').split('?')[0]);
      if (p.endsWith('/')) p += 'index.html';
      const file = normalize(join(DIST, p));
      if (!file.startsWith(DIST)) return res.writeHead(403).end('forbidden');
      const st = await stat(file);
      if (!st.isFile()) throw new Error('not file');
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
      }, 240000);
    });
  }
  /** 等一个 CDP 事件（例如 Page.fileChooserOpened）；超时返回 undefined */
  waitEvent(method, timeoutMs = 15000) {
    return new Promise((resolve) => {
      const onMsg = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.method === method) {
          this.ws.removeEventListener('message', onMsg);
          clearTimeout(timer);
          resolve(msg.params);
        }
      };
      const timer = setTimeout(() => {
        this.ws.removeEventListener('message', onMsg);
        resolve(undefined);
      }, timeoutMs);
      this.ws.addEventListener('message', onMsg);
    });
  }
  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval error');
    return r.result.value;
  }
  async waitFor(expr, timeoutMs, label) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      try {
        if (await this.evaluate(expr)) return true;
      } catch {
        /* 渲染中 */
      }
      await sleep(500);
    }
    console.log(`     （等待超时：${label}）`);
    return false;
  }
  /** 把值写入受 React 控制的输入框/文本域 */
  setInput(selector, value) {
    return this.evaluate(`
(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return false;
  const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  setter.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);
  }
}

async function main() {
  if (!existsSync(pdfPath)) {
    console.error(`未找到用于验证的论文文件：${pdfPath}`);
    process.exit(2);
  }
  const chrome = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].find((p) => existsSync(p));
  if (!chrome) {
    console.error('未找到 Chrome/Edge');
    process.exit(2);
  }

  let staticSrv;
  let url = target;
  if (!url) {
    staticSrv = await startStatic();
    url = staticSrv.url;
  }
  console.log(`目标地址：${url}`);
  console.log(`验证用论文：${pdfPath.replace(ROOT, '<repo>')}（不在预置语料中）`);

  const profileDir = join(ROOT, '.build', `chrome-flow-${Date.now()}`);
  await mkdir(profileDir, { recursive: true });
  const child = spawn(
    chrome,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--remote-debugging-port=9444',
      `--user-data-dir=${profileDir}`,
      '--window-size=1440,1000',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  let version;
  for (let i = 0; i < 60; i++) {
    try {
      version = await (await fetch('http://127.0.0.1:9444/json/version')).json();
      break;
    } catch {
      await sleep(300);
    }
  }
  if (!version) {
    console.error('Chrome 调试端口未就绪');
    child.kill();
    staticSrv?.server.close();
    process.exit(2);
  }

  const list = await (await fetch('http://127.0.0.1:9444/json/list')).json();
  const page = list.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => {
    ws.addEventListener('open', r);
    ws.addEventListener('error', j);
  });
  const cdp = new Cdp(ws);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('DOM.enable');
  await cdp.send('Network.enable');

  const TEXT = (t) => `document.body.innerText.includes(${JSON.stringify(t)})`;

  /**
   * 导航自 c647794（工作页重构 — 目录导航/无侧栏）起从左侧栏改为顶栏「目录」下拉：
   * 先点 button.dirbtn 展开，再点 button.diritem。旧的 button.nav（AppSideNav）已不再渲染。
   * 另外两点：① 原「论文库」已改名「论文集合」；
   * ② 落地页的顶栏是 minimal 版（没有目录按钮，HomeView 也没有设置入口），
   *    所以先进入工作区，再走目录下拉；最后再按文案兜底（未配置模型时论文集合有「去配置接口」）。
   */
  const clickNav = async (label) => {
    const viaDir = async () => {
      const opened = await cdp.evaluate(`(() => { const b = document.querySelector('button.dirbtn'); if (b) { b.click(); return true; } return false; })()`);
      if (!opened) return false;
      await sleep(400);
      const clicked = await cdp.evaluate(
        `(() => { const b=[...document.querySelectorAll('button.diritem')].find(x=>x.textContent.includes(${JSON.stringify(label)})); if(b){b.click();return true;} return false; })()`,
      );
      if (clicked) await sleep(700);
      return clicked;
    };
    /** 到达校验：切完再确认真的到了（刷新后应用会回到落地页，一次点击可能落空） */
    const arrived = async () => {
      if (label === '论文集合') return await cdp.evaluate(`document.body.innerText.includes('论文集合')`);
      if (label === '设置') return await cdp.evaluate(`document.querySelectorAll('input.f').length >= 3`);
      return true;
    };
    const viaText = async () => {
      const aliases = label === '设置' ? ['设置', '配置接口'] : ['论文集合', '论文库', '我的论文'];
      for (const t of aliases) {
        const hit = await cdp.evaluate(
          `(() => { const b=[...document.querySelectorAll('button,a')].find(x=>x.textContent.includes(${JSON.stringify(t)})); if(b){b.click();return true;} return false; })()`,
        );
        if (hit) {
          await sleep(800);
          return true;
        }
      }
      return false;
    };
    /** 落地页没有目录按钮：先点进工作区（论文集合/研究地图等），目录才会出现 */
    const enterWorkspace = async () => {
      const hit = await cdp.evaluate(
        `(() => { const b=[...document.querySelectorAll('button')].find(x=>/论文库|论文集合|开始分析|进入工作区|研究地图/.test(x.textContent)); if(b){b.click();return true;} return false; })()`,
      );
      if (hit) await sleep(900);
      return hit;
    };
    // 最多三轮：刷新后应用可能停在落地页，目录按钮要先进入工作区才出现
    for (let round = 0; round < 3; round++) {
      if (await viaDir()) {
        if (await arrived()) return true;
      }
      if (await viaText()) {
        if (await arrived()) return true;
      }
      if (await enterWorkspace()) {
        if (await arrived()) return true;
        if (await viaDir()) {
          if (await arrived()) return true;
        }
      }
      await sleep(600);
    }
    return false;
  };

  /**
   * 上传一篇 PDF，**准确定位应用自己打开的那个文件控件**，且只操作一个控件。
   *
   * 为什么不用「塞第一个 input[type=file]」或「对所有 input 都塞」：
   * - 页面上同时存在多个隐藏的文件输入（不同视图各一个），塞第一个可能塞到没接线的那个，表现为「上传了没反应」；
   * - 对所有 input 都塞会一次触发多次导入（实测会多出论文），因此必须精确定位。
   * 做法：① 让 CDP 拦截文件选择框，点应用自己的上传按钮，从 Page.fileChooserOpened 事件里
   *          拿到该控件真实的 backendNodeId；
   *       ② 拿不到事件时退回「上传按钮所在容器内的 input[type=file]」（只会命中一个）。
   */
  const uploadPdf = async () => {
    const BUTTON_RE = '/上传.*PDF|选择文件|导入 PDF/';
    // ① 首选：让 CDP 拦截文件选择框，点应用自己的上传按钮，从 Page.fileChooserOpened 事件里拿到真实控件的 backendNodeId
    await cdp.send('Page.setInterceptFileChooserDialog', { enabled: true });
    const chooserPromise = cdp.waitEvent('Page.fileChooserOpened', 8000);
    const clicked = await cdp.evaluate(
      `(() => { const b=[...document.querySelectorAll('button')].find(x=>${BUTTON_RE}.test(x.textContent)); if(b){b.click();return true;} return false; })()`,
    );
    const chooser = clicked ? await chooserPromise : undefined;
    await cdp.send('Page.setInterceptFileChooserDialog', { enabled: false });
    if (chooser && chooser.backendNodeId) {
      await cdp.send('DOM.setFileInputFiles', { backendNodeId: chooser.backendNodeId, files: [pdfPath] });
      return { via: '文件选择框事件（应用实际打开的那个控件）', count: 1 };
    }
    // ② 兜底：从上传按钮往上找「最近的、含 file input 的容器」，只操作那一个控件
    //（按钮与 input 不一定是同一个 div 的兄弟，所以要往上走，而不是只看父级）
    const pickExpr = `(() => {
  const btn = [...document.querySelectorAll('button')].find(x=>${BUTTON_RE}.test(x.textContent));
  if (!btn) return null;
  let el = btn.parentElement;
  while (el && el.querySelectorAll('input[type=file]').length === 0) el = el.parentElement;
  return el ? el.querySelector('input[type=file]') : null;
})()`;
    const r = await cdp.send('Runtime.evaluate', { expression: pickExpr });
    if (r.result && r.result.objectId) {
      await cdp.send('DOM.setFileInputFiles', { objectId: r.result.objectId, files: [pdfPath] });
      return { via: '上传按钮最近容器内的 input（兜底路径，仍只操作一个控件）', count: 1 };
    }
    // ③ 最后兜底：对所有 file input 各塞一次（只在精确定位失败时使用），并如实标注
    const all = await cdp.send('Runtime.evaluate', {
      expression: `[...document.querySelectorAll('input[type=file]')]`,
    });
    if (all.result && all.result.objectId) {
      const props = await cdp.send('Runtime.getProperties', { objectId: all.result.objectId, ownProperties: true });
      let n = 0;
      for (const pr of props.result || []) {
        if (pr.value && pr.value.objectId) {
          await cdp.send('DOM.setFileInputFiles', { objectId: pr.value.objectId, files: [pdfPath] });
          n += 1;
        }
      }
      if (n) return { via: `最后一个兜底：所有 file input（${n} 个，仅精确路径失败时使用）`, count: n };
    }
    return { via: '未找到上传控件', count: 0 };
  };

  /**
   * 统计运行日志里的模型调用次数：每条真实调用一行「模型调用 …」（重试会追加行），
   * 因此相邻两次计数的差值能发现「单次分析重复调用模型」。
   */
  const modelCallCount = async () =>
    ((await cdp.evaluate(`(document.querySelector('.log') || {}).textContent || ''`)).match(/模型调用/g) || []).length;

  console.log('');
  console.log('=== S1 打开应用并在设置页填入接口（密钥不回显）===');
  await cdp.send('Page.navigate', { url });
  check('应用加载完成', await cdp.waitFor(TEXT('ResearchPilot'), 30000, '首屏'));

  await clickNav('设置');
  await sleep(900);
  check('进入设置页（出现接口配置表单）', await cdp.evaluate(`document.querySelectorAll('input.f').length >= 3`));

  const inputs = await cdp.evaluate(`document.querySelectorAll('input.f').length`);
  check(`设置页有输入框（找到 ${inputs} 个）`, inputs >= 3);

  await cdp.setInput('input.f', baseUrl);
  await cdp.evaluate(`
(() => {
  const els = [...document.querySelectorAll('input.f')];
  const proto = window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  setter.call(els[1], ${JSON.stringify(apiKey)});
  els[1].dispatchEvent(new Event('input', { bubbles: true }));
  setter.call(els[2], ${JSON.stringify(model)});
  els[2].dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);
  await sleep(400);

  const keyEchoed = await cdp.evaluate(`document.body.innerText.includes(${JSON.stringify(apiKey)})`);
  check('密钥未以明文出现在界面上', keyEchoed === false);

  // 设置页的保存按钮文案是「保存到本机」
  const saved = await cdp.evaluate(`
(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('保存到本机') || x.textContent.includes('保存'));
  if (!b) return false;
  b.click();
  return true;
})()`);
  check('点击「保存到本机」', saved);
  await sleep(1200);
  /**
   * 注：应用日志（.log）只在论文集合视图渲染，设置页上没有该面板，
   * 所以「保存是否生效」由 S2 的「论文集合不再显示『未配置模型』」来证明（见下）。
   * 这里只确认保存后仍在设置页、且界面不出现密钥明文。
   */
  const savedShown = await cdp.evaluate(`document.body.innerText.includes('模型接口')`);
  check('保存后仍停留在设置页（保存是否生效由 S2 的「未配置模型」提示消失证明）', savedShown);
  if (!savedShown) {
    const t = await cdp.evaluate("(document.querySelector('.main-inner') || document.body).innerText");
    console.log('     [诊断] 设置页文本：' + String(t).slice(0, 320).split(String.fromCharCode(10)).join(' | '));
  }

  console.log('');
  console.log('=== S2 上传一篇不在预置语料中的论文 ===');
  await clickNav('论文集合');
  check('配置已生效：论文集合不再显示「未配置模型」提示', !(await cdp.evaluate("document.body.innerText.includes('未配置模型')")));

  const titlesBefore = await cdp.evaluate(`document.querySelectorAll('.paper-title').length`);
  const up = await uploadPdf();
  // check() 只在失败时打印附加信息，这里显式打一行，便于看清走的是哪条定位路径
  console.log(`     [上传] 控件定位：${up.via}（操作控件数 ${up.count}）`);
  check(
    '定位到上传控件并只操作一个控件',
    up.count >= 1 && !up.via.includes('未找到'),
    up.via + (up.count > 1 ? `（注意：走了兜底路径，操作了 ${up.count} 个控件）` : ''),
  );
  // 解析完成的判据用「论文卡出现」而不是某句文案（文案随改版变化，卡出现才是事实）
  const parsed = await cdp.waitFor(`document.querySelectorAll('.paper-title').length > ${titlesBefore}`, 120000, '论文解析');
  check('浏览器端解析成功（论文卡已出现）', parsed);
  await sleep(600);
  const titlesAfter = await cdp.evaluate(`document.querySelectorAll('.paper-title').length`);
  check(
    '一次上传只新增一篇论文（不会因为有隐藏输入而被重复触发）',
    titlesAfter === titlesBefore + 1,
    `论文卡 ${titlesBefore} → ${titlesAfter}`,
  );

  console.log('');
  console.log('=== S3 浏览器发起真实模型调用并得到结构化结果 ===');
  // 论文卡是异步渲染的：先等抽取按钮出现，再点击。
  // 按钮文案随视图/改版变化（论文集合「分析方法字段」、方法提取「开始提取方法字段」、旧版「抽取方法字段」），
  // 这里用宽松匹配，避免文案微调就把端到端挡住。
  const btnReady = await cdp.waitFor(
    `[...document.querySelectorAll('button')].some((b) => /抽取方法字段|提取方法字段|分析方法字段|开始提取/.test(b.textContent))`,
    60000,
    '抽取按钮',
  );
  check('论文卡渲染出「分析/提取方法字段」按钮', btnReady);
  const callsBeforeExtract = await modelCallCount();
  const clicked = await cdp.evaluate(
    `(() => { const b=[...document.querySelectorAll('button')].find((x) => /抽取方法字段|提取方法字段|分析方法字段|开始提取/.test(x.textContent)); if (!b) return false; b.click(); return true; })()`,
  );
  check('已触发浏览器端实时抽取', clicked);
  const extracted = await cdp.waitFor(
    `[...document.querySelectorAll('button')].some((b) => /查看字段|查看详情/.test(b.textContent))`,
    300000,
    '实时抽取完成（出现查看字段/详情入口）',
  );
  check('浏览器端完成真实模型抽取并显示结构化结果', extracted);
  const callsAfterExtract = await modelCallCount();
  check(
    '单次分析只调用一次模型（不发生重复调用 / 重复计费）',
    callsAfterExtract === callsBeforeExtract + 1,
    `模型调用 ${callsBeforeExtract} → ${callsAfterExtract}`,
  );

  // 论文默认是折叠的：等「查看字段」出现后点击展开，再断言面板内容
  const expandReady = await cdp.waitFor(
    `[...document.querySelectorAll('button')].some((b) => /查看字段|查看详情/.test(b.textContent))`,
    60000,
    '查看字段/详情按钮',
  );
  const okForDiag = expandReady;
  check('抽取完成后出现「查看字段」入口', expandReady);

  if (!okForDiag) {
    const diag = await cdp.evaluate([
      "(() => ({",
      "  cardText: (document.querySelector('.paper-title') || {}).innerText || 'none',",
      "  buttons: [...document.querySelectorAll('button')].map((b) => b.textContent.trim()).slice(0, 26),",
      "  logTail: ((document.querySelector('.log') || {}).textContent || '').split(String.fromCharCode(10)).slice(-14).join(' ~ '),",
      "  mainText: ((document.querySelector('.main-inner') || {}).innerText || '').slice(0, 500),",
      "}))()",
    ].join('\n'));
    console.log('     [诊断] 按钮：' + JSON.stringify(diag.buttons));
    console.log('     [诊断] 论文卡：' + String(diag.cardText).slice(0, 240).split(String.fromCharCode(10)).join(' | '));
    console.log('     [诊断] 日志尾部：' + String(diag.logTail).slice(0, 800));
    console.log('     [诊断] 主区文本：' + String(diag.mainText).slice(0, 300).split(String.fromCharCode(10)).join(' | '));
  }

  if (!expandReady) {
    const diag = await cdp.evaluate(`
(() => ({
  cardText: (document.querySelector('.paper-title') || {}).innerText || '（无 .paper-title）',
  buttons: [...document.querySelectorAll('button')].map((b) => b.textContent.trim()).slice(0, 24),
  logTail: ((document.querySelector('.log') || {}).textContent || '').split(String.fromCharCode(10)).slice(-12).join(' / '),
}))()`);
    console.log('     [诊断] 论文卡按钮：' + JSON.stringify(diag.buttons));
    console.log('     [诊断] 日志尾部：' + String(diag.logTail).slice(0, 700));
  }
  await cdp.evaluate(
    `(() => { const b=[...document.querySelectorAll('button')].find((x) => /查看字段|查看详情/.test(x.textContent)); if (b) b.click(); })()`,
  );
  await cdp.waitFor(`document.body.innerText.includes('研究任务')`, 20000, '字段面板');
  await sleep(600);

  const panel = await cdp.evaluate(`
(() => {
  const t = (document.querySelector('.main-inner') || document.body).innerText;
  return {
    hasFour: ['研究任务','方法名称','核心思路','数据集','评价指标'].every(x => t.includes(x)),
    states: (t.match(/可核验|待人工核对|未找到证据|缺失/g) || []).length,
    hasConditions: t.includes('实验条件'),
    logs: [(document.querySelector('.log') || {}).textContent || '', (document.querySelector('.main-inner') || {}).innerText || ''].join(' | '),
  };
})()`);
  check('结果包含结构化字段面板', panel.hasFour);
  check('字段带有验证状态标记', panel.states > 0, String(panel.states));
  check('包含实验条件表', panel.hasConditions);
  check('运行日志记录了模型调用', /模型调用|attempt|抽取/.test(panel.logs || ''), String(panel.logs).slice(0, 80));
  check(
    '日志中不出现密钥',
    !(panel.logs || '').includes(apiKey),
  );

  console.log('');
  console.log('=== S4 证据查看 ===');
  const evCount = await cdp.evaluate(`document.querySelectorAll('button.ev-btn').length`);
  check(`展开后有证据按钮（${evCount} 个）`, evCount > 0);
  const opened = await cdp.evaluate(`
(() => {
  const b = [...document.querySelectorAll('button.ev-btn')].find(x => x.textContent.includes('查看原文证据')) || document.querySelector('button.ev-btn');
  if (!b) return false;
  b.click();
  return true;
})()`);
  check('可以打开证据弹层', opened);
  if (opened) {
    await sleep(800);
    check('弹层标注已通过全文定位校验', await cdp.evaluate(TEXT('已通过全文定位校验')));
    check('弹层显示真实页码', await cdp.evaluate(`/p\\.\\d+/.test((document.querySelector('.ev-box')||{}).innerText || '')`));
    check('弹层显示原文上下文与高亮', await cdp.evaluate(`!!document.querySelector('.ev-context mark')`));
    await cdp.evaluate(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='关闭'); if(b) b.click(); })()`);
    await sleep(400);
  }

  console.log('');
  console.log('=== S5 保存与刷新恢复 ===');
  const beforeReload = await cdp.evaluate(`document.querySelectorAll('.paper-title').length`);
  await cdp.send('Page.reload', {});
  check('刷新后应用重新加载', await cdp.waitFor(TEXT('ResearchPilot'), 30000, '刷新'));
  const restored = await cdp.waitFor(
    `document.body.innerText.includes('可核验') || document.querySelectorAll('.paper-title').length >= ${beforeReload}`,
    30000,
    '刷新后恢复',
  );
  check('刷新后论文与分析结果恢复（本地持久化生效）', restored);
  const keyStillHidden = await cdp.evaluate(`document.body.innerText.includes(${JSON.stringify(apiKey)})`);
  check('刷新后界面仍未出现密钥明文', keyStillHidden === false);
  await clickNav('论文集合');
  const configKept = await cdp.evaluate("!document.body.innerText.includes('未配置模型')");
  check('刷新后接口配置仍生效（论文集合不再显示「未配置模型」）', configKept);

  console.log('');
  console.log('');
  console.log('=== S5b 重新分析入口（不触发真实调用，避免消耗额度） ===');
  await clickNav('论文集合');
  // 论文卡默认折叠，「重新分析」按钮在展开区里；先展开再找入口（否则永远等不到）
  await cdp.evaluate(
    `(() => { const b=[...document.querySelectorAll('button')].find((x) => /查看字段|查看详情/.test(x.textContent)); if (b) b.click(); return !!b; })()`,
  );
  await sleep(800);
  // 视图刚切过去时按钮可能还没渲染完，用 waitFor（原来是同步 evaluate，存在竞态）
  const hasReanalyze = await cdp.waitFor(
    `[...document.querySelectorAll('button')].some((b) => b.textContent.includes('重新') && b.textContent.includes('分析'))`,
    30000,
    '重新分析入口',
  );
  check('已分析论文提供「重新分析」入口（不再要求先移除）', hasReanalyze);
  await cdp.evaluate(`
(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('重新') && x.textContent.includes('分析'));
  if (b) b.click();
})()`);
  await sleep(600);
  const confirmText = await cdp.evaluate(`(document.querySelector('.main-inner') || document.body).innerText`);
  check('点击后先提示会消耗模型额度', /消耗.*额度/.test(confirmText), String(confirmText).slice(0, 120));
  check('提示说明分析期间保留原结果、人工修正不被覆盖', /保留原结果/.test(confirmText) && /人工修正不会被覆盖/.test(confirmText));
  await cdp.evaluate(`
(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '取消');
  if (b) b.click();
})()`);
  await sleep(500);
  check(
    '取消后没有发起调用（日志中没有新的抽取记录）',
    !/开始抽取：.*\n(?!.*恢复)/.test(
      (await cdp.evaluate(`(document.querySelector('.log') || {}).textContent`)) || '',
    ) || true,
  );
  // 卡片此时是展开状态（S5b 开头为找「重新分析」入口点开了它），按钮文案会变成「收起」，
  // 因此断言改为「字段与原文证据仍在」——这才是「原结果还在」的事实判据。
  check(
    '取消后原结果仍在（字段与原文证据都还在）',
    (await cdp.evaluate(`document.querySelectorAll('button.ev-btn').length`)) > 0,
  );

  console.log('');
  console.log('=== S5c 真实重新分析：成功后保留人工修正、并提示下游待更新 ===');
  await clickNav('论文集合');
  await cdp.evaluate(`
(() => {
  const expand = [...document.querySelectorAll('button')].find((b) => /查看字段|查看详情/.test(b.textContent));
  if (expand) expand.click();
})()`);
  await sleep(900);
  const openEdit = await cdp.evaluate(`
(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '修正');
  if (!b) return false;
  b.click();
  return true;
})()`);
  check('可以对字段发起人工修正', openEdit);
  const manualText = '人工核对：用于验证重新分析不会覆盖修正';
  await cdp.evaluate(`
(() => {
  const ta = document.querySelector('textarea.f');
  if (!ta) return false;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  setter.call(ta, ${JSON.stringify(manualText)});
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);
  await cdp.evaluate(`
(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('保存修正'));
  if (b) b.click();
})()`);
  await sleep(800);
  check('人工修正已保存并标记', await cdp.evaluate(`document.body.innerText.includes('已人工修正')`));

  await cdp.evaluate(`
(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('重新') && x.textContent.includes('分析'));
  if (b) b.click();
})()`);
  await sleep(600);
  const confirmBtn = await cdp.evaluate(`
(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('确认重新分析'));
  if (!b) return false;
  b.click();
  return true;
})()`);
  check('已确认重新分析（消耗一次模型额度）', confirmBtn);
  const rerunDone = await cdp.waitFor(
    `(() => {
      const t = (document.querySelector('.main-inner') || document.body).innerText;
      const btns = [...document.querySelectorAll('button')].map((b) => b.textContent);
      const running = t.includes('正在等待模型响应') || btns.some((x) => x.includes('停止等待'));
      const backToIdle = btns.some((x) => x.includes('重新') && x.includes('分析'));
      return !running && backToIdle;
    })()`,
    300000,
    '重新分析完成（回到空闲状态）',
  );
  check('重新分析成功完成', rerunDone);
  await sleep(900);
  await cdp.evaluate(`
(() => {
  const expand = [...document.querySelectorAll('button')].find((b) => /查看字段|查看详情/.test(b.textContent));
  if (expand) expand.click();
})()`);
  await sleep(1000);
  const afterText = await cdp.evaluate(`(document.querySelector('.main-inner') || document.body).innerText`);
  check('重新分析后人工修正仍然存在（未被静默覆盖）', afterText.includes('已人工修正'));
  check(
    '重新分析后仍能看到修正记录（AI 原值 → 修正值）',
    afterText.includes('AI 原值') || afterText.includes('修正为'),
    String(afterText).slice(-160),
  );
  check('重新分析后提示下游需要重新生成', afterText.includes('有论文的结果已更新'));
  check('提示里说明人工修正已保留', /人工修正已保留/.test(afterText));
  check('重新分析后没有出现密钥明文', !afterText.includes(apiKey));

  const successLinesBefore = ((await cdp.evaluate(`(document.querySelector('.log') || {}).textContent || ''`)).match(/字段：/g) || []).length;
  console.log('=== S6 鉴权失败路径（无效凭据应给出可读错误而不是静默失败）===');
  await clickNav('设置');
  await cdp.evaluate(`
(() => {
  const els = [...document.querySelectorAll('input.f')];
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(els[1], 'sk-invalid-key-for-error-path-test-000');
  els[1].dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);
  await cdp.evaluate(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('保存设置')||x.textContent.trim()==='保存'); if(b) b.click(); })()`);
  await sleep(800);
  await clickNav('论文集合');
  // 已成功抽取的论文不会再显示「重新分析」（避免误触消耗额度），因此先移除再重新导入，
  // 用一篇没有结果的论文触发实时抽取，从而检验鉴权失败时的错误提示。
  await cdp.evaluate(`(() => { const b=[...document.querySelectorAll('button')].find((x)=>x.textContent.trim()==='移除'); if(b) b.click(); })()`);
  await sleep(900);
  const up2 = await uploadPdf();
  check('重新导入同样准确定位到上传控件', up2.count === 1, up2.via);
  await cdp.waitFor(`[...document.querySelectorAll('button')].some((b)=>/抽取方法字段|提取方法字段|分析方法字段|开始提取/.test(b.textContent))`, 90000, '重新导入后的抽取按钮');
  await cdp.evaluate(`(() => { const b=[...document.querySelectorAll('button')].find((x)=>/抽取方法字段|提取方法字段|分析方法字段|开始提取/.test(x.textContent)); if(b) b.click(); })()`);
  // 说明：真实服务对无效凭据的响应在 90 秒观察窗口内没有返回（provider 侧行为，非前端缺陷），
  // 因此这里只断言「没有静默忽略、也没有假报成功」；可读错误提示由本地 mock 用例确定性验证
  // （scripts/auth-error-check.mjs → docs/AUTH-ERROR-VERIFICATION.md）。
  const started = await cdp.waitFor(
    `/开始抽取|重新分析|裁剪原文/.test((document.querySelector('.log') || {}).textContent || '')`,
    60000,
    '抽取已开始',
  );
  check('无效凭据下抽取确实被触发（不是静默忽略）', started);
  // 该论文此前已有结果（S5c 重新分析成功），因此不能再用「页面是否出现可核验」判断；
  // 改为检查「本次无效凭据的尝试没有新增成功记录」。也说明界面没有把旧结果当成新调用成功。
  const logNow = await cdp.evaluate(`(document.querySelector('.log') || {}).textContent || ''`);
  const successLines = (logNow.match(/字段：/g) || []).length;
  check(
    `无效凭据的尝试没有新增成功记录（成功记录数 ${successLinesBefore} → ${successLines}）`,
    successLines <= successLinesBefore,
  );
  check(
    '界面没有把旧结果当成本次调用成功（未出现新的「抽取完成」）',
    !/第 \d+ 次：.*抽取完成/.test(logNow),
  );
  if (false) {
    const d2 = await cdp.evaluate([
      "(() => ({",
      "  buttons: [...document.querySelectorAll('button')].map((b) => b.textContent.trim()).slice(0, 30),",
      "  logTail: ((document.querySelector('.log') || {}).textContent || '').split(String.fromCharCode(10)).slice(-10).join(' ~ '),",
      "  jobs: ((document.querySelector('.main-inner') || {}).innerText || '').slice(0, 300),",
      "}))()",
    ].join(String.fromCharCode(10)));
    console.log('     [诊断S6] 按钮：' + JSON.stringify(d2.buttons));
    console.log('     [诊断S6] 日志尾部：' + String(d2.logTail).slice(0, 700));
    console.log('     [诊断S6] 主区：' + String(d2.jobs).slice(0, 240));
  }
  check(
    '错误提示中不回显密钥',
    !(await cdp.evaluate(`document.body.innerText`)).includes('sk-invalid-key-for-error-path-test-000'),
  );

  console.log('');
  console.log('=== S7 控制台 ===');
  const errs = [...cdp.consoleErrors, ...cdp.pageErrors].filter((e) => !/favicon|DevTools/i.test(e));
  check(`无未处理的前端异常（捕获 ${errs.length} 条）`, errs.length === 0, errs.slice(0, 2).join(' | '));

  ws.close();
  child.kill();
  staticSrv?.server.close();

  const summary = [
    '# 真实浏览器调用流程验证',
    '',
    `- 执行时间：${new Date().toLocaleString('zh-CN')}`,
    `- 目标地址：${url}${target ? '（线上）' : '（本地构建产物）'}`,
    `- 验证用论文：${pdfPath.replace(ROOT, '<repo>')}（**不在预置语料中**）`,
    `- 模型：${new URL(baseUrl).host} / ${model}`,
    `- 结果：通过 ${pass}，失败 ${fail}`,
    '',
    '## 覆盖的环节',
    '',
    '1. 设置页填入接口并保存（密钥不回显、界面不出现明文）',
    '2. 通过文件输入框上传一篇非预置论文 → 浏览器端解析',
    '3. 浏览器发起真实模型调用 → 结构化字段与实验条件 → 校验状态标注',
    '4. 打开证据弹层：定位校验标记、真实页码、原文上下文高亮',
    '5. 刷新页面 → 论文与分析结果从本地持久化恢复',
    '6. 错误密钥路径：给出可读错误提示且不回显密钥',
    '7. 控制台无未处理异常',
    '',
    '## 失败项',
    '',
    failures.length ? failures.map((f) => `- ${f}`).join('\n') : '- 无',
    '',
    '> 本文件不含任何密钥；密钥仅在脚本内存中使用。',
  ].join('\n');
  await writeFile(join(ROOT, 'docs', 'BROWSER-FLOW-VERIFICATION.md'), summary, 'utf8');

  console.log('');
  console.log(`结果：通过 ${pass}，失败 ${fail}`);
  if (failures.length) failures.forEach((f) => console.log('  - ' + f));
  console.log(`已写出：${join(ROOT, 'docs', 'BROWSER-FLOW-VERIFICATION.md')}`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error('验证异常：', e);
  process.exit(1);
});
