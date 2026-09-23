/**
 * 表格行列关系的**版面级核查**（确定性，不调用模型）。
 *
 * 为什么需要：只靠文本无法确认「这个数值属于哪一列」——
 * 行标签和数值在同一行文本里，但列是纵向的：81.3 可能是 top-1，也可能是 top-5。
 * 因此这里读取 PDF 的文字坐标（pdfjs 的 transform），用几何关系核查：
 *   1) 数值所在的横向带（同一行）里是否有该模型的行标签；
 *   2) 数值所在列向上找到的列头文字是否与所报指标一致（top-1 / top-5 / AP 等）。
 *
 * 结果写回 index.json 的 experiment.verification.layout，
 * 并把 rowColConfirmed 改为「文本核查 + 版面核查」都通过才算确认。
 *
 * 用法：node scripts/table-binding-check.mjs --out public/samples-vision-core [--out ...]
 */

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const outs = args.reduce((acc, a, i) => (a === '--out' && args[i + 1] ? [...acc, args[i + 1]] : acc), []);
if (!outs.length) outs.push('public/samples-vision-core');

/* ---------- pdfjs（与项目解析链路同一套） ---------- */
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
import { pathToFileURL } from 'node:url';
pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')).href;

/** 读取每一页的文字块与坐标 */
async function readLayout(file) {
  const doc = await pdfjs.getDocument({ url: pathToFileURL(file).href, useSystemFonts: true, isEvalSupported: false }).promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const items = [];
    for (const it of content.items) {
      if (!it.str || !it.str.trim()) continue;
      const tr = it.transform ?? [];
      items.push({ str: it.str, x: Math.round(tr[4] ?? 0), y: Math.round(tr[5] ?? 0), w: Math.round(it.width ?? 0), h: Math.round(it.height ?? 0) });
    }
    pages.push(items);
    page.cleanup();
  }
  await doc.destroy();
  return pages;
}

const norm = (s) => (s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

/** 在指定页上找出「含该数值」的文字块，返回其坐标 */
function findValueItems(items, value) {
  const v = (value ?? '').trim();
  if (!v) return [];
  return items.filter((it) => it.str.includes(v));
}

/** 同一横向带（同一表格行）内的文字 */
const sameBand = (items, y, tol = 6) => items.filter((it) => Math.abs(it.y - y) <= tol);

/** 从某点的正上方寻找列头（x 接近、y 更大） */
function findColumnHeader(items, x, y, maxUp = 900) {
  // 列头形如 top-1 / FLOPs / AP box：含字母、短、以大写或数字开头
  const looksLikeHeader = (t) => {
    const v = t.trim();
    if (v.length < 2 || v.length > 28) return false; // 句子片段不算列头
    if (!/[A-Za-z]/.test(v)) return false; // 纯数字是同列其它行的数值
    if (/[.。;；]$/.test(v)) return false;
    if ((v.match(/\s+/g) || []).length > 3) return false; // 词数过多的句子不算
    return true;
  };
  const cands = items
    .filter((it) => it.y > y + 3 && it.y - y <= maxUp && Math.abs(it.x - x) <= 26 && looksLikeHeader(it.str))
    .sort((a, b) => a.y - b.y);
  return cands[0]?.str ?? undefined;
}

/** 列头文字与所报指标是否一致 */
function headerMatchesMetric(header, metric, value) {
  if (!header) return 'unknown';
  const h = norm(header);
  const m = norm(metric);
  const isTop1 = /top[\s-]?1/.test(m) || /top[\s-]?1/.test(norm(value === 'x' ? '' : ''));
  const isTop5 = /top[\s-]?5/.test(m);
  if (isTop1) return /top[\s-]?1|acc@1|top1/.test(h) ? true : /top[\s-]?5|top5|acc@5/.test(h) ? false : 'unknown';
  if (isTop5) return /top[\s-]?5|top5|acc@5/.test(h) ? true : /top[\s-]?1|top1|acc@1/.test(h) ? false : 'unknown';
  if (/map/.test(m)) return /ap|map/.test(h) ? true : 'unknown';
  if (/miou/.test(m)) return /miou|iou/.test(h) ? true : 'unknown';
  return 'unknown';
}

const report = [
  '# 表格行列关系的版面级核查（确定性，未调用模型）',
  '',
  `- 执行时间：${new Date().toLocaleString('zh-CN')}`,
  '- 方法：读取 PDF 文字坐标，核查「数值所在行是否含该模型行标签」与「数值所在列向上的列头是否与所报指标一致」。',
  '- 这是**版面几何核查**，比纯文本匹配更接近真实的行列对应；但仍不排除跨页表格、合并单元格等复杂情况。',
  '',
];

for (const outRel of outs) {
  const outDir = resolve(ROOT, outRel);
  const index = JSON.parse(await readFile(join(outDir, 'index.json'), 'utf8'));

  // 记录 pdf 文件路径：papers 里带 file？若没有则按 arxivId 在 samples/pdfs 下找
  const pdfByPaper = new Map();
  for (const p of index.papers) {
    let file = p.source?.url && /^samples/.test(p.source.url) ? resolve(ROOT, p.source.url) : null;
    if (!file) {
      const guess = [
        join(ROOT, 'samples', 'pdfs', `${p.id.replace(/^p_arxiv_/, '')}.pdf`),
        join(ROOT, 'samples', 'pdfs', 'vision', {
          'p_arxiv_1512.03385': '01_ResNet_2015.pdf',
          'p_arxiv_2010.11929': '02_ViT_2020.pdf',
          'p_arxiv_2012.12877': '03_DeiT_2020.pdf',
          'p_arxiv_2103.14030': '04_Swin_Transformer_2021.pdf',
          'p_arxiv_2201.03545': '05_ConvNeXt_2022.pdf',
        }[p.id] ?? ''),
      ].filter((x) => x && !x.endsWith('\\') && !x.endsWith('/'));
      file = guess.find((x) => {
        try {
          require('node:fs').accessSync(x);
          return true;
        } catch {
          return false;
        }
      });
    }
    if (file) pdfByPaper.set(p.id, file);
  }

  const layouts = new Map();
  for (const [paperId, file] of pdfByPaper) {
    try {
      layouts.set(paperId, await readLayout(file));
      console.log(`已读取版面：${paperId.slice(9)}（${layouts.get(paperId).length} 页）`);
    } catch (e) {
      console.log(`版面读取失败：${paperId} ${e.message}`);
    }
  }

  let confirmed = 0;
  let total = 0;
  const rows = [];

  for (const m of index.methods) {
    const pages = layouts.get(m.paperId);
    for (const e of m.experiments ?? []) {
      total++;
      const page = e.evidence?.page;
      let geo = { checked: false, rowInBand: false, header: undefined, headerMatch: 'unknown', valueFound: false };

      if (pages && page && pages[page - 1]) {
        const items = pages[page - 1];
        const vals = findValueItems(items, e.metricValue);
        if (vals.length) {
          geo.valueFound = true;
          // 取最可能的那个：与行标签出现在同一带的优先
          let target = vals[0];
          const rowLabel = norm(e.table?.rowLabel);
          for (const v of vals) {
            const band = sameBand(items, v.y);
            if (rowLabel && band.some((it) => norm(it.str).includes(rowLabel))) {
              target = v;
              break;
            }
          }
          const band = sameBand(items, target.y);
          geo.rowInBand = !!rowLabel && band.some((it) => norm(it.str).includes(rowLabel));
          geo.header = findColumnHeader(items, target.x, target.y);
          geo.headerMatch = headerMatchesMetric(geo.header, e.metricName, e.metricValue);
          geo.checked = true;
          geo.bandText = band.map((it) => it.str).join(' ').slice(0, 120);
        }
      }

      // 综合判定：文本核查（引文+表题+行标签定位）与版面核查都要通过
      const textOk = e.verification?.quoteLocated !== false && e.verification?.tableCaptionLocated !== false && e.verification?.rowLabelLocated !== false;
      const rowColConfirmed = !!textOk && geo.checked && geo.rowInBand && geo.headerMatch === true;
      if (rowColConfirmed) confirmed++;

      e.verification = {
        ...(e.verification ?? {}),
        rowColConfirmed,
        layout: {
          checked: geo.checked,
          valueFound: geo.valueFound,
          rowInBand: geo.rowInBand,
          columnHeader: geo.header,
          columnMatchesMetric: geo.headerMatch,
          bandText: geo.bandText,
        },
      };
      const issues = (e.verification.issues ?? []).filter((x) => !x.startsWith('版面核查'));
      if (!geo.checked) issues.push('版面核查：未能在该页找到该数值的文字块');
      else if (!geo.rowInBand) issues.push('版面核查：该数值所在行未找到模型行标签');
      else if (geo.headerMatch !== true) issues.push(`版面核查：列头与指标无法确认一致（列头=${geo.header ?? '未找到'}）`);
      else issues.push(`版面核查：行标签与列头一致（列头=${geo.header}）`);
      e.verification.issues = issues;

      rows.push({
        paper: m.paperId.slice(9),
        variant: e.modelVariant,
        metric: `${e.metricName}=${e.metricValue}`,
        band: geo.rowInBand,
        header: geo.header ?? '—',
        match: geo.headerMatch,
        confirmed: rowColConfirmed,
      });
    }
  }

  index.tableBindingCheckedAt = new Date().toISOString();
  await writeFile(join(outDir, 'index.json'), JSON.stringify(index, null, 2), 'utf8');

  report.push(`## ${outRel}`, '', `- 实验记录 ${total} 条；**文本核查 + 版面核查都通过**的：${confirmed} 条`, '');
  report.push('| 论文 | 模型变体 | 记录值 | 数值行含行标签 | 列头（向上找） | 列头与指标一致 | 行列确认 |');
  report.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (const r of rows) {
    report.push(`| ${r.paper} | ${r.variant} | ${r.metric} | ${r.band ? '是' : '否'} | ${r.header} | ${r.match === true ? '一致' : r.match === false ? '**不一致**' : '无法确认'} | ${r.confirmed ? '✅' : '⚠️ 待核查'} |`);
  }
  report.push('');
  console.log(`${outRel}：实验 ${total} 条，行列确认 ${confirmed} 条`);
}

report.push(
  '## 判定口径',
  '',
  '- ✅ 行列确认 = 引文/表题/行标签文本核查通过，**且**版面核查显示该数值所在行含该模型行标签、该数值所在列向上的列头与所报指标一致。',
  '- ⚠️ 待核查 = 上述任一条不成立。此时该记录**不参与**「可直接比较」，只能作为待核查信息展示，不补猜。',
  '- 局限：跨页表格、合并单元格、图片化表格无法用文字坐标核查，会落在「待核查」。',
  '',
);
await writeFile(join(ROOT, 'docs', 'EXPERIMENT-TABLE-CHECK.md'), report.join('\n'), 'utf8');
console.log('已写出 docs/EXPERIMENT-TABLE-CHECK.md');
