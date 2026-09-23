/**
 * 下载样例论文（arXiv 公开预印本）。
 *
 * 仓库不直接分发论文 PDF，避免版权问题；运行本脚本即可在本地获得相同文件。
 *   node samples/download-samples.mjs
 */

import { mkdir, writeFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dir = join(__dirname, 'pdfs');

const PAPERS = [
  { id: '1706.03762', title: 'Attention Is All You Need' },
  { id: '1810.04805', title: 'BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding' },
  { id: '1907.11692', title: 'RoBERTa: A Robustly Optimized BERT Pretraining Approach' },
  { id: '1910.01108', title: 'DistilBERT, a distilled version of BERT: smaller, faster, cheaper and lighter' },
  { id: '2005.14165', title: 'Language Models are Few-Shot Learners' },
];

await mkdir(dir, { recursive: true });

for (const p of PAPERS) {
  const file = join(dir, `${p.id}.pdf`);
  try {
    const st = await stat(file);
    if (st.size > 10000) {
      console.log(`已存在，跳过：${p.id}.pdf（${(st.size / 1024 / 1024).toFixed(1)} MB）`);
      continue;
    }
  } catch {
    /* 不存在则下载 */
  }
  const url = `https://arxiv.org/pdf/${p.id}`;
  console.log(`下载 ${p.id} …`);
  const res = await fetch(url, { headers: { 'User-Agent': 'ResearchPilot-dev/0.1 (educational use)' } });
  if (!res.ok) {
    console.error(`失败：HTTP ${res.status} ${url}`);
    continue;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(file, buf);
  console.log(`完成：${p.id}.pdf（${(buf.length / 1024 / 1024).toFixed(1)} MB）——${p.title}`);
}

console.log('');
console.log(`样例目录：${resolve(dir)}`);
console.log('这些 PDF 通过 arXiv 公开链接获取，版权归原作者，仅用于本地开发与演示验证。');
