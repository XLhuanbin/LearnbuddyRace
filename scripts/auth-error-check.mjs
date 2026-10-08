/**
 * 鉴权失败路径的确定性验证。
 *
 * 为什么不直接用真实接口：实测把无效凭据发给真实服务后，请求在观察窗口内没有返回，
 * 无法在合理时间内判定错误提示是否正确。因此这里用**本地 mock 服务**返回 401，
 * 在浏览器里走同一条前端代码路径，验证「错误被识别为鉴权失败并给出可读提示」。
 *
 * 不涉及任何真实密钥。
 *
 * 用法：node scripts/auth-error-check.mjs
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
const failures = [];
const check = (n, c, e = '') => {
  if (c) {
    pass++;
    console.log(`  ✓ ${n}`);
  } else {
    fail++;
    failures.push(n + (e ? ` — ${e}` : ''));
    console.log(`  ✗ ${n}${e ? ' — ' + e : ''}`);
  }
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.pdf': 'application/pdf',
  '.svg': 'image/svg+xml',
};

/** mock 模型服务：始终返回 401（带 CORS 头，模拟真实服务的鉴权失败响应） */
function startMockModel() {
  const server = createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }
    if (req.url?.includes('/chat/completions')) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Authentication Fails, Your api key is invalid', type: 'authentication_error' } }));
      return;
    }
    res.writeHead(404).end('not found');
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, port: server.address().port })));
}

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
    this.pageErrors = [];
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve: rs, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(JSON.stringify(m.error))) : rs(m.result);
        return;
      }
      if (m.method === 'Runtime.exceptionThrown') {
        this.pageErrors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
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
          reject(new Error('CDP timeout: ' + method));
        }
      }, 120000);
    });
  }
  async evaluate(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
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
      await sleep(400);
    }
    console.log(`     （等待超时：${label}）`);
    return false;
  }
}

async function main() {
  const pdf = join(ROOT, 'samples/pdfs/2006.11239.pdf');
  if (!existsSync(pdf)) {
    console.error('缺少验证用 PDF');
    process.exit(2);
  }
  const chrome = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome',
  ].find((p) => existsSync(p));
  if (!chrome) {
    console.error('未找到 Chrome/Edge');
    process.exit(2);
  }

  const mock = await startMockModel();
  const site = await startStatic();
  const wrongKey = 'sk-invalid-key-for-auth-path-test';
  const mockBase = `http://127.0.0.1:${mock.port}`;
  console.log(`mock 模型服务：${mockBase}（始终返回 401）`);
  console.log(`本地站点：${site.url}`);

  const profileDir = join(ROOT, '.build', `chrome-auth-${Date.now()}`);
  await mkdir(profileDir, { recursive: true });
  const child = spawn(
    chrome,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--remote-debugging-port=9555',
      `--user-data-dir=${profileDir}`,
      '--window-size=1280,900',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  let ver;
  for (let i = 0; i < 60; i++) {
    try {
      ver = await (await fetch('http://127.0.0.1:9555/json/version')).json();
      break;
    } catch {
      await sleep(300);
    }
  }
  if (!ver) {
    console.error('Chrome 未就绪');
    process.exit(2);
  }
  const list = await (await fetch('http://127.0.0.1:9555/json/list')).json();
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

  console.log('');
  console.log('=== 鉴权失败路径（本地 mock 返回 401）===');
  await cdp.send('Page.navigate', { url: site.url });
  check('应用加载', await cdp.waitFor(`document.body.innerText.includes('ResearchPilot')`, 30000, '首屏'));

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

  // 填入 mock 地址 + 无效凭据
  await clickNav('设置');
  await sleep(800);
  await cdp.evaluate(`
(() => {
  const els = [...document.querySelectorAll('input.f')];
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  const set = (el, v) => { setter.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
  set(els[0], ${JSON.stringify(mockBase)});
  set(els[1], ${JSON.stringify(wrongKey)});
  set(els[2], 'mock-model');
  return true;
})()`);
  await sleep(400);
  await cdp.evaluate(`(() => { const b=[...document.querySelectorAll('button')].find((x)=>x.textContent.includes('保存到本机')); if(b) b.click(); })()`);
  await sleep(900);

  // 导入论文并抽取
  await clickNav('论文集合');
  await sleep(600);
  // 精确定位上传控件：上传按钮所在容器内的 file input。
  // （不要对所有 input[type=file] 都塞文件 —— 页面有多个隐藏输入，那样会一次触发多次导入。）
  const rUp = await cdp.send('Runtime.evaluate', {
    expression: `(() => {
  const btn = [...document.querySelectorAll('button')].find(x=>/上传.*PDF|选择文件|导入 PDF/.test(x.textContent));
  if (!btn) return null;
  let el = btn.parentElement;
  while (el && el.querySelectorAll('input[type=file]').length === 0) el = el.parentElement;
  return el ? el.querySelector('input[type=file]') : null;
})()`,
  });
  if (!(rUp.result && rUp.result.objectId)) {
    // 定位失败就明确报错中止：不做「对所有 file input 都塞一次」的兜底（那会操作到无关控件）
    throw new Error('未定位到上传控件（按钮匹配不到，或按钮与 file input 不在同一容器层级）；已中止，且没有操作任何 file input。');
  }
  await cdp.send('DOM.setFileInputFiles', { objectId: rUp.result.objectId, files: [pdf] });
  console.log('     [上传] 已通过「上传按钮最近容器内的那一个 file input」提交论文（只操作这一个控件）');
  // 抽取按钮文案随视图/改版变化（论文集合「分析方法字段」、方法提取「开始提取方法字段」、旧「抽取方法字段」）
  const btnReady = await cdp.waitFor(`[...document.querySelectorAll('button')].some((b)=>/抽取方法字段|提取方法字段|分析方法字段|开始提取/.test(b.textContent))`, 90000, '抽取按钮');
  check('论文导入后出现抽取按钮', btnReady);
  if (!btnReady) {
    // 失败时把页面状态打出来：上传/解析/集合切换都可能出问题，别只报一个超时
    const dump = await cdp.evaluate(`
(() => {
  const t = document.body.innerText;
  return {
    fileInputs: document.querySelectorAll('input[type=file]').length,
    paperTitles: document.querySelectorAll('.paper-title').length,
    buttons: [...document.querySelectorAll('button')].map((b) => b.textContent.trim()).filter(Boolean).slice(0, 20),
    parseOk: t.includes('解析成功'),
    logExcerpt: ((document.querySelector('.log') || {}).innerText || '').slice(0, 300),
    textExcerpt: t.slice(0, 320),
  };
})()`);
    console.log('     [诊断] ' + JSON.stringify(dump, null, 1).split(String.fromCharCode(10)).join(String.fromCharCode(10) + '     '));
  }
  await cdp.evaluate(`(() => { const b=[...document.querySelectorAll('button')].find((x)=>/抽取方法字段|提取方法字段|分析方法字段|开始提取/.test(x.textContent)); if(b) b.click(); })()`);

  const hintShown = await cdp.waitFor(
    `document.body.innerText.includes('鉴权失败') || document.body.innerText.includes('401') || document.body.innerText.includes('API Key 是否有效')`,
    90000,
    '鉴权失败提示',
  );
  check('鉴权失败时给出可读提示（含 401 / API Key 提示）', hintShown);

  // 失败原因现在由可见提示条（ModelError 的 auth 文案）呈现，不只在日志面板里；
  // 断言放宽为「日志或页面任一处明确写出原因」，意图不变：不允许静默失败。
  const panel = await cdp.evaluate(`((document.querySelector('.log') || {}).innerText || '')`);
  const pageText = await cdp.evaluate(`document.body.innerText`);
  check(
    '失败原因被明确写出（日志或页面提示，不是静默失败）',
    /失败|鉴权|401/.test(panel) || /失败|鉴权|401/.test(pageText),
    String(panel || pageText).slice(-200),
  );
  check('失败后没有生成任何结构化结果（不假报成功）', !(await cdp.evaluate(`document.body.innerText.includes('可核验')`)));
  check('提示中不回显凭据', !panel.includes(wrongKey));
  check('无未处理前端异常', cdp.pageErrors.filter((e) => !/favicon/i.test(e)).length === 0);

  ws.close();
  child.kill();
  mock.server.close();
  site.server.close();

  await writeFile(
    join(ROOT, 'docs', 'AUTH-ERROR-VERIFICATION.md'),
    [
      '# 鉴权失败路径验证（本地 mock，确定性）',
      '',
      `- 执行时间：${new Date().toLocaleString('zh-CN')}`,
      `- 方式：本地启动 mock 模型服务（始终返回 HTTP 401，带 CORS 头），浏览器走同一条前端代码路径`,
      `- 不使用真实密钥；mock 地址：${mockBase}`,
      `- 结果：通过 ${pass}，失败 ${fail}`,
      '',
      '## 为什么不用真实接口',
      '',
      '实测把无效凭据发给真实服务后，请求在 90 秒观察窗口内没有返回，无法在合理时间内判定提示是否正确。',
      '因此改用 mock 做确定性验证；真实接口的异常响应行为记录为「未验证」而不是「通过」。',
      '',
      '## 检查项',
      '',
      '- 鉴权失败时给出可读提示（401 / API Key 提示）',
      '- 日志记录失败原因，不是静默失败',
      '- 失败后不生成结构化结果（不假报成功）',
      '- 提示中不回显凭据',
      '- 无未处理前端异常',
      '',
      failures.length ? `## 失败项\n\n${failures.map((f) => '- ' + f).join('\n')}` : '## 失败项\n\n- 无',
      '',
    ].join('\n'),
    'utf8',
  );
  console.log('');
  console.log(`结果：通过 ${pass}，失败 ${fail}`);
  if (failures.length) failures.forEach((f) => console.log('  - ' + f));
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error('异常：', e);
  process.exit(1);
});
