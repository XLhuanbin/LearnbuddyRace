/**
 * 运行核心回归测试：用 esbuild 打包 tests/core.test.ts 后交给 node 执行。
 *   node scripts/test.mjs
 */

import { spawnSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const buildDir = join(ROOT, '.build');
await mkdir(buildDir, { recursive: true });

const out = join(buildDir, `core.test.${process.pid}.mjs`);
const bin = join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'esbuild.cmd' : 'esbuild');

const b = spawnSync(
  bin,
  [join(ROOT, 'tests/core.test.ts'), '--bundle', '--format=esm', '--platform=node', '--target=node20', '--outfile=' + out],
  { stdio: 'inherit', cwd: ROOT, shell: process.platform === 'win32' },
);
if (b.status !== 0) process.exit(1);

const r = spawnSync(process.execPath, [out], { stdio: 'inherit', cwd: ROOT });
process.exit(r.status ?? 1);
