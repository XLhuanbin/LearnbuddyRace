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

  // 填入 mock 地址 + 无效凭据
  await cdp.evaluate(`(() => { const b=[...document.querySelectorAll('button.nav')].find(x=>x.textContent.includes('设置')); if(b) b.click(); })()`);
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
  await cdp.evaluate(`(() => { const b=[...document.querySelectorAll('button.nav')].find(x=>x.textContent.includes('论文库')); if(b) b.click(); })()`);
  await sleep(600);
  const doc = await cdp.send('DOM.getDocument', { depth: -1 });
  const probe = await cdp.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: 'input[type=file]' });
  await cdp.send('DOM.setFileInputFiles', { nodeId: probe.nodeId, files: [pdf] });
  const btnReady = await cdp.waitFor(`[...document.querySelectorAll('button')].some((b)=>b.textContent.includes('抽取方法字段'))`, 90000, '抽取按钮');
  check('论文导入后出现抽取按钮', btnReady);
  await cdp.evaluate(`(() => { const b=[...document.querySelectorAll('button')].find((x)=>x.textContent.includes('抽取方法字段')); if(b) b.click(); })()`);

  const hintShown = await cdp.waitFor(
    `document.body.innerText.includes('鉴权失败') || document.body.innerText.includes('401') || document.body.innerText.includes('API Key 是否有效')`,
    90000,
    '鉴权失败提示',
  );
  check('鉴权失败时给出可读提示（含 401 / API Key 提示）', hintShown);

  const panel = await cdp.evaluate(`((document.querySelector('.log') || {}).innerText || '')`);
  check('日志记录了失败原因而不是静默失败', /失败|鉴权|401/.test(panel), String(panel).slice(-200));
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
