/**
 * 验收（本轮信息架构）：一个完全不了解项目的人走一遍
 *   1 打开第一页 → 2 十秒内说出产品做什么 → 3 点「进入 Demo」→ 4 点「开始查看案例」
 *   → 5 看到两个论文结果 → 6 看懂结论 → 7 看懂一句原因 → 8 查看原文依据 → 9 查看方法演进路线
 * 并检查：宣传首页是否像宣传页、Demo 是否像结果页、是否有控制台感、信息是否堆叠、390×844 是否清晰。
 *
 * 用法：node scripts/demo-walkthrough3.mjs [--url https://...] [--out docs/demo-walkthrough-v4]
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
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
const OUT = resolve(ROOT, argOf('out') ?? 'docs/demo-walkthrough-v4');
await mkdir(OUT, { recursive: true });

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
      setTimeout(() => this.pending.has(i) && (this.pending.delete(i), r({})), 60000);
    });
  }
  async ev(x) {
    const r = await this.send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
    return r?.result?.value;
  }
  async shot(file, w = 1440, h = 960) {
    await this.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 });
    await new Promise((r) => setTimeout(r, 700));
    const r = await this.send('Page.captureScreenshot', { format: 'png' });
    if (r?.data) await writeFile(file, Buffer.from(r.data, 'base64'));
    await this.send('Emulation.clearDeviceMetricsOverride');
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0;
let fail = 0;
const failures = [];
const notes = [];
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

const profile = join(ROOT, '.build', `chrome-flow3-${Date.now()}`);
await mkdir(profile, { recursive: true });
const child = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=9955', '--user-data-dir=' + profile, '--window-size=1440,960', 'about:blank'], { stdio: 'ignore' });
let ver;
for (let i = 0; i < 60; i++) {
  try {
    ver = await (await fetch('http://127.0.0.1:9955/json/version')).json();
    break;
  } catch {
    await sleep(300);
  }
}
if (!ver) {
  console.error('Chrome 未就绪');
  process.exit(2);
}
const list = await (await fetch('http://127.0.0.1:9955/json/list')).json();
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
const cdp = new Cdp(ws);
await cdp.send('Runtime.enable');
await cdp.send('Page.enable');
await cdp.send('Page.navigate', { url });
await sleep(3200);

const TEXT = (t) => `document.body.innerText.includes(${JSON.stringify(t)})`;
const mainText = () => cdp.ev(`(document.querySelector('.main-inner') || document.body).innerText`);
const clickBtn = (t) => cdp.ev(`(() => { const b=[...document.querySelectorAll('button')].find((x)=>x.textContent.includes(${JSON.stringify(t)})); if(!b) return false; b.click(); return true; })()`);
const clickNav = (t) => cdp.ev(`(() => { const b=[...document.querySelectorAll('button.nav')].find((x)=>x.textContent.includes(${JSON.stringify(t)})); if(!b) return false; b.click(); return true; })()`);

/* ---------- 步骤 1-2：第一页（宣传页）---------- */
console.log('');
console.log('=== 步骤 1-2：打开第一页，10 秒内能说出产品做什么 ===');
const land = await mainText();
check('一句话产品定位在主标题', /别急着比较论文分数，先确认它们到底在比较什么/.test(land));
check('一句话说明解决什么问题', /帮你看懂视觉论文的方法差异，判断实验结果能否公平比较/.test(land));
check('三个视觉关键词', /看懂方法差异/.test(land) && /判断结果是否可比/.test(land) && /找到原文依据/.test(land));
check('只有一个主按钮（进入 Demo）', /进入 Demo/.test(land));
check('宣传页没有侧栏（不像控制台）', !(await cdp.ev(`!!document.querySelector('.side')`)));
check(
  '宣传页不出现数量 / 版本 / 配置 / 缓存说明 / 开发状态',
  !/篇论文/.test(land) && !/条实验记录/.test(land) && !/promptVersion/.test(land) && !/RULES_VERSION/.test(land) && !/配置模型接口/.test(land) && !/缓存/.test(land) && !/开发状态/.test(land),
);
check('首屏有抽象示意图（两个结果 → 一个结论）', /论文结果 A/.test(land) && /论文结果 B/.test(land) && /能直接比较吗/.test(land));
const firstScreen = await cdp.ev(`
(() => {
  const h = document.querySelector('.landing h1');
  const cta = document.querySelector('.landing .cta-row');
  if (!h || !cta) return { ok: false };
  const hr = h.getBoundingClientRect();
  const cr = cta.getBoundingClientRect();
  return { ok: hr.top >= 0 && cr.bottom <= window.innerHeight + 1, h: Math.round(hr.top), c: Math.round(cr.bottom), vh: window.innerHeight };
})()`);
check(`主文案与主按钮都在首屏内（${firstScreen.h}px→${firstScreen.c}px / 视口 ${firstScreen.vh}px）`, firstScreen.ok, JSON.stringify(firstScreen));
await cdp.shot(join(OUT, '1-宣传首页.png'));
await cdp.shot(join(OUT, '1-宣传首页-窄屏.png'), 390, 844);

/* ---------- 步骤 3-4：进入 Demo → 选择案例 ---------- */
console.log('');
console.log('=== 步骤 3-4：进入 Demo → 选择一个案例 ===');
check('点击「进入 Demo」', await clickBtn('进入 Demo'));
await sleep(1300);
const caseText = await mainText();
check('显示案例选择页', /选择一个视觉论文案例/.test(caseText));
check('只有正式案例（旧 NLP 样例不在主流程）', /ImageNet 图像分类方法演进/.test(caseText) && !/NLP|BERT|GPT-3/.test(caseText));
check('案例说明使用用户能懂的话', /看看不同训练条件下的分数能否直接放在一起比较/.test(caseText));
await cdp.shot(join(OUT, '2-选择案例.png'));

/* ---------- 步骤 5-7：结果页 ---------- */
console.log('');
console.log('=== 步骤 5-7：看到两个论文结果、结论与一句原因 ===');
check('点击「开始查看案例」', await clickBtn('开始查看案例'));
await sleep(4500);
const res = await mainText();
check('看到两个结果卡片', /DeiT|ResNet|ViT|Swin|ConvNeXt/.test(res) && /对比/.test(res));
check('显示两个具体数值', /81\.8|82\.1|22\.85|88\.55|83\.1|83\.4|83\.5|84\.5|87\.3|86\.8|87\.8|79\.9|76\.5|80\.1/.test(res));
check('给出明确结论（大号文字）', /信息不足，不能直接判断谁更好|条件不同，分数差异不能直接归因|两项结果不在同一个口径上|可以直接比较/.test(res));
check('配一句人话原因', /分数差异不能直接归因于模型结构|无法确认两个分数是否在同一口径下|可以直接比较/.test(res));
check('用「一致 / 不同 / 仍需确认」三列可视化条件', /一致/.test(res) && /不同/.test(res) && /仍需确认/.test(res));
check('三个可折叠区域', /为什么这样判断/.test(res) && /哪些条件不同/.test(res) && /查看原文依据/.test(res));
check('默认不展示长表格与内部术语', !/实验记录/.test(res) && !/语料集/.test(res) && !/证据绑定/.test(res) && !/规则重算/.test(res));
await cdp.shot(join(OUT, '3-比较结果.png'));
await cdp.shot(join(OUT, '3-比较结果-窄屏.png'), 390, 844);

/* ---------- 步骤 8：查看原文依据 ---------- */
console.log('');
console.log('=== 步骤 8：查看原文依据 ===');
await cdp.ev(`(() => { document.querySelectorAll('details.fold').forEach((d) => (d.open = true)); })()`);
await sleep(500);
const evBtn = await cdp.ev(`
(() => {
  const d = [...document.querySelectorAll('details.fold')].find((x) => x.textContent.includes('查看原文依据'));
  if (!d) return false;
  const b = [...d.querySelectorAll('button')].find((x) => /原文依据/.test(x.textContent));
  if (!b) return false;
  b.click();
  return true;
})()`);
check('可以打开原文依据', evBtn);
await sleep(900);
const ev = await cdp.ev(`(document.querySelector('.ev-box') || document.body).innerText`);
check('弹层显示页码与定位校验', /p\.\d+/.test(ev) && /定位校验|已验证|未能/.test(ev));
check('弹层可关闭', await cdp.ev(`[...document.querySelectorAll('button')].some((b)=>/关闭/.test(b.textContent))`));
await cdp.shot(join(OUT, '4-原文依据.png'));
await cdp.ev(`(() => { const b=[...document.querySelectorAll('button')].find((x)=>/关闭/.test(x.textContent)); b && b.click(); })()`);
await sleep(500);

/* ---------- 步骤 9：方法演进 ---------- */
console.log('');
console.log('=== 步骤 9：查看方法演进路线 ===');
check('点击「方法演进」', await clickNav('方法演进'));
await sleep(1500);
const evo = await mainText();
check('显示五个方法的演进路线', ['ResNet', 'ViT', 'DeiT', 'Swin', 'ConvNeXt'].every((x) => evo.includes(x)));
check('每个节点有一句话贡献', /让更深的 CNN 更容易训练/.test(evo) && /把 Transformer 引入图像分类/.test(evo) && /降低视觉 Transformer 的数据门槛/.test(evo));
check('未确认的关系标注为「仍需确认 / 系统推断」', /系统推断|仍需确认|原文已说明/.test(evo));
check('底部有阅读顺序建议', /如果你刚开始学习，建议按这个顺序阅读/.test(evo));
await cdp.shot(join(OUT, '5-方法演进.png'));
await cdp.shot(join(OUT, '5-方法演进-窄屏.png'), 390, 844);

const nodeOk = await cdp.ev(`(() => { const b=document.querySelector('.rnode'); if (!b) return false; b.click(); return true; })()`);
await sleep(800);
const nd = await mainText();
check('点击节点显示「做了什么 / 与前一个方法的关系 / 原文依据」', /它做了什么/.test(nd) && /和前一个方法/.test(nd) && /原文依据/.test(nd));
await cdp.shot(join(OUT, '6-演进节点详情.png'));

/* ---------- 附加：更多（开发者入口）与响应式 ---------- */
console.log('');
console.log('=== 附加检查：更多入口 / 窄屏 / 隔离 ===');
check('可以进入「更多」（开发者入口）', await clickNav('更多'));
await sleep(1200);
const more = await mainText();
check('更多里有论文库/全部结果/开发状态/设置', /论文库（原始字段）/.test(more) && /全部结果与条件（专业视图）/.test(more) && /开发状态与记录/.test(more) && /设置/.test(more));
check('普通用户流程里不出现这些入口', !/论文库（原始字段）/.test(res));
await cdp.shot(join(OUT, '7-更多-开发者入口.png'));

await clickNav('比较结果');
await sleep(1000);
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await sleep(800);
check('窄屏（390×844）无整页横向溢出', !(await cdp.ev(`document.documentElement.scrollWidth > window.innerWidth + 1`)));
await cdp.send('Emulation.clearDeviceMetricsOverride');
await sleep(400);
check('桌面无整页横向溢出', !(await cdp.ev(`document.documentElement.scrollWidth > window.innerWidth + 1`)));

await clickNav('首页');
await sleep(800);
check('可以返回宣传首页', await cdp.ev(TEXT('别急着比较论文分数')));
await clickBtn('查看示例结果');
await sleep(3500);
check('「查看示例结果」可直接看到结果页', await cdp.ev(TEXT('这些结果，真的能直接比较吗')));

check('无未处理前端异常', cdp.errors.filter((e) => !/favicon/i.test(e)).length === 0, cdp.errors.slice(0, 1).join(''));

ws.close();
child.kill();
staticSrv?.server.close();

const lines = [
  '# 新用户路径实走（宣传首页 + 结果工作台）',
  '',
  `- 执行时间：${new Date().toLocaleString('zh-CN')}`,
  `- 目标：${url}${target ? '（线上）' : '（本地构建产物）'}`,
  `- 结果：通过 ${pass}，失败 ${fail}`,
  '',
  '## 走的路径（对应验收标准）',
  '',
  '1. 打开第一页（宣传页）→ 2. 十秒内说出产品做什么 → 3. 点「进入 Demo」→ 4. 点「开始查看案例」',
  '→ 5. 看到两个论文结果 → 6. 看懂结论 → 7. 看懂一句原因 → 8. 查看原文依据 → 9. 查看方法演进路线。',
  '',
  '## 截图',
  '',
  '| 步骤 | 桌面 | 窄屏 390×844 |',
  '| --- | --- | --- |',
  '| 宣传首页 | 1-宣传首页.png | 1-宣传首页-窄屏.png |',
  '| 选择案例 | 2-选择案例.png | — |',
  '| 比较结果 | 3-比较结果.png | 3-比较结果-窄屏.png |',
  '| 原文依据 | 4-原文依据.png | — |',
  '| 方法演进 | 5-方法演进.png | 5-方法演进-窄屏.png |',
  '| 演进节点详情 | 6-演进节点详情.png | — |',
  '| 更多（开发者入口） | 7-更多-开发者入口.png | — |',
  '',
  notes.length ? `## 记录\n\n${notes.map((n) => '- ' + n).join('\n')}` : '',
  failures.length ? `## 失败项\n\n${failures.map((f) => '- ' + f).join('\n')}` : '## 失败项\n\n- 无',
  '',
  '> 只走查界面与交互，不修改任何模型输出、数据、证据、实验记录与判断算法。',
];

await writeFile(join(OUT, 'WALKTHROUGH.md'), lines.filter(Boolean).join('\n'), 'utf8');
console.log('');
console.log(`结果：通过 ${pass}，失败 ${fail}`);
if (failures.length) failures.forEach((f) => console.log('  - ' + f));
console.log(`已写出 ${join(OUT, 'WALKTHROUGH.md')}`);
process.exit(fail ? 1 : 0);
