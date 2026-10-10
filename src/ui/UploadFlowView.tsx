import React, { useRef, useState } from 'react';
import type { Method, Paper } from '../core/types';
import type { JobState } from './Library';
import { verifiedOf } from './Library';
import { FIELD_KEYS_ORDER } from '../core/cache';
import type { CorpusScope } from '../core/corpus';
import { DraftIcon } from '../draft-icons';
import type { ImportResult } from '../App';

interface Props {
  papers: Paper[];
  scope: CorpusScope;
  methods: Method[];
  jobs: Record<string, JobState>;
  modelReady: boolean;
  config: { baseUrl: string; apiKey: string; model: string };
  onSaveConfig: (c: { baseUrl: string; apiKey: string; model: string }) => void | Promise<void>;
  onTest: (c: { baseUrl: string; apiKey: string; model: string }) => void;
  testing: boolean;
  testResult?: string;
  /** 保留字段：本页按草稿重写后不再有「粘贴正文」入口（草稿没有），但接口先留着，避免改 App 的接线 */
  onPaste?: (title: string, text: string) => void;
  /** 草稿的前端逻辑：把攒好的文件一次性交给底层分析（导入解析 → 已配置模型时逐篇抽取），返回逐文件结果 */
  onAnalyze: (files: File[]) => Promise<ImportResult[]>;
  onEnterMap: () => void;
  onOpenPaper: (paperId: string) => void;
  lastImportedId?: string | null;
  onUseOwnScope: () => void;
  onUseCaseScope: () => void;
  onGo?: (tab: string) => void;
}

type StepState = 'done' | 'running' | 'waiting' | 'failed';
interface Step {
  no: string;
  name: string;
  state: StepState;
  result: string;
}

/**
 * 五步处理流程（真实状态，不用百分比或转圈代替）。
 */
function stepsOf(p: Paper, m: Method | undefined, job: JobState | undefined, modelReady: boolean): Step[] {
  const parsed = p.parseStatus === 'ok';
  const parseFailed = p.parseStatus === 'failed';
  const extracting = job?.status === 'running';
  const extractFailed = job?.status === 'failed';
  const hasMethod = !!m;
  const verified = m ? verifiedOf(m) : 0;
  const withValue = m ? FIELD_KEYS_ORDER.filter((k) => m.fields[k]?.value).length : 0;

  return [
    { no: '01', name: '上传论文', state: 'done', result: `${p.pageCount ?? '?'} 页 · ${p.charCount ?? '?'} 字符` },
    {
      no: '02',
      name: '解析文本',
      state: parseFailed ? 'failed' : parsed ? 'done' : 'waiting',
      result: parseFailed ? `失败：${p.parseError || '未知原因'}` : parsed ? '已得到按页存储的全文' : '等待解析',
    },
    {
      no: '03',
      name: '提取方法字段',
      state: extractFailed ? 'failed' : extracting ? 'running' : hasMethod ? 'done' : 'waiting',
      result: extracting
        ? `正在等待模型响应（${job?.message || '已发出请求'}）`
        : hasMethod
          ? `已得到 ${withValue}/7 个字段有值`
          : extractFailed
            ? `失败：${job?.error || '模型调用失败'}`
            : modelReady
              ? '等待开始'
              : '未配置模型：不会产生替代结果',
    },
    {
      no: '04',
      name: '校验原文证据',
      state: hasMethod ? (verified > 0 ? 'done' : 'waiting') : 'waiting',
      result: hasMethod ? (verified > 0 ? `${verified}/7 个字段的引文已通过全文定位校验` : '没有字段通过定位校验') : '等待方法字段',
    },
    { no: '05', name: '进入研究地图', state: hasMethod ? 'done' : 'waiting', result: hasMethod ? '可以进入研究地图' : '需要先完成方法字段提取' },
  ];
}

/** 队列里的一项：占位 = 已攒下但还没分析的文件 */
interface Queued {
  id: string;
  file: File;
  result?: ImportResult;
}

const uid = () => Math.random().toString(36).slice(2, 11);
const sizeMB = (n: number) => (n / 1024 / 1024).toFixed(2);

/**
 * 方法提取页 —— **按 Superdesign 草稿 a6947252 的标记逐行搬过来的**。
 *
 * 标记与类名照草稿原样（Tailwind 工具类 + 草稿自带 .upload-zone / .file-card / .btn-primary / .text-link 等），
 * 结构也照草稿：内容在 `<main class="max-w-[var(--content-max)] mx-auto px-6 …">` 里，
 * `<footer>` 是它的**兄弟节点**（所以页脚通栏到屏幕两边，和页眉一样）。
 *
 * 与草稿的差异（仅以下 4 类，逐处注明）：
 *  1) 草稿 `pt-32` 是给它自己的 **fixed** 头部留位；本项目顶栏是 sticky（在文档流内），
 *     故本页改用 `pt-14`，使「顶栏底 → 内容顶」的视觉间距与草稿一致（约 56px），而不是照抄会让内容多下移 72px 的数值。
 *  2) 草稿的假数据一律换成真实来源：进度条 45%→真实百分比、`预计剩余时间: 1分20秒`→真实的「共 N 步 · 已完成 M 步」、
 *     `正在提取核心算法参数...`→当前步骤的真实结果。
 *  3) 草稿的虚假承诺不采纳：「所有上传文件将进行加密处理」→ 实为本机解析、不上传（改成真实说法）；
 *     草稿页脚/协议里指向的「数据使用协议 / 使用指南 / 法律条款」并不存在 → 换成真实入口。
 *  4) 文件卡多一行**真实状态**（等待分析 / 已解析 / 提取中 / 解析失败…）——草稿没有，但必须如实给出。
 */
export function UploadFlowView({
  papers,
  scope,
  methods,
  jobs,
  modelReady,
  config,
  onSaveConfig,
  onTest,
  testing,
  testResult,
  onAnalyze,
  onOpenPaper,
  lastImportedId,
  onUseOwnScope,
  onGo,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [queue, setQueue] = useState<Queued[]>([]);
  const [phase, setPhase] = useState<'idle' | 'running' | 'done'>('idle');
  const [draft, setDraft] = useState(config);
  const [dragOver, setDragOver] = useState(false);

  const running = phase === 'running';
  const showAnalysis = phase !== 'idle';
  const casePapers = scope.presetPapers;
  const ownPapers = scope.ownPapers;
  const listMode: 'case' | 'own' = scope.mode === 'own' || (casePapers.length === 0 && ownPapers.length > 0) ? 'own' : 'case';
  const hiddenOwn = listMode === 'case' && ownPapers.length > 0 ? ownPapers.length : 0;
  const hasMethod = (p: Paper) => methods.some((m) => m.paperId === p.id);
  const needModel = !modelReady && papers.some((p) => p.parseStatus === 'ok' && !hasMethod(p));

  const addFiles = (files: FileList | File[]) => {
    const list = Array.from(files);
    if (!list.length) return;
    setQueue((q) => {
      const seen = new Set(q.map((x) => `${x.file.name}|${x.file.size}`));
      const next = [...q];
      for (const f of list) {
        const key = `${f.name}|${f.size}`;
        if (seen.has(key)) continue;
        seen.add(key);
        next.push({ id: uid(), file: f });
      }
      return next;
    });
    if (phase === 'done') setPhase('idle');
  };

  const removeFile = (id: string) => {
    if (running) return;
    setQueue((q) => q.filter((x) => x.id !== id));
  };

  const start = async () => {
    const todo = queue.filter((x) => !x.result);
    if (!todo.length || running) return;
    setPhase('running');
    try {
      const results = await onAnalyze(todo.map((x) => x.file));
      setQueue((q) => {
        const next = [...q];
        let i = 0;
        for (const item of next) {
          if (item.result) continue;
          next[next.indexOf(item)] = { ...item, result: results[i] };
          i++;
        }
        return next;
      });
    } finally {
      setPhase('done');
    }
  };

  const queuedPapers = queue.map((x) => x.result?.paper).filter(Boolean) as Paper[];
  const stagePapers = queuedPapers.length ? queuedPapers : papers;

  const overview: { no: string; name: string; state: StepState; result: string }[] = (() => {
    const anyUploaded = stagePapers.length > 0;
    const anyParsed = stagePapers.some((p) => p.parseStatus === 'ok');
    const allParseFailed = stagePapers.length > 0 && stagePapers.every((p) => p.parseStatus === 'failed');
    const extracting = stagePapers.some((p) => jobs[p.id]?.status === 'running');
    const anyExtractFailed = stagePapers.some((p) => jobs[p.id]?.status === 'failed');
    const anyMethod = stagePapers.some(hasMethod);
    const anyVerified = stagePapers.some((p) => {
      const m = methods.find((x) => x.paperId === p.id);
      return m ? verifiedOf(m) > 0 : false;
    });
    const doneCount = stagePapers.filter(hasMethod).length;
    return [
      { no: '01', name: '上传论文', state: anyUploaded ? 'done' : 'waiting', result: anyUploaded ? `${stagePapers.length} 篇` : '还没有论文' },
      {
        no: '02',
        name: '解析文本',
        state: allParseFailed && !anyParsed ? 'failed' : anyParsed ? 'done' : anyUploaded ? 'running' : 'waiting',
        result: anyParsed ? `${stagePapers.filter((p) => p.parseStatus === 'ok').length} 篇已解析` : allParseFailed ? '全部失败' : '等待解析',
      },
      {
        no: '03',
        name: '提取方法字段',
        state: anyExtractFailed && !anyMethod ? 'failed' : extracting ? 'running' : anyMethod ? 'done' : 'waiting',
        result: anyMethod ? `${doneCount} 篇已生成` : extracting ? '等待模型响应' : modelReady ? '等待开始' : '未配置模型',
      },
      { no: '04', name: '校验原文证据', state: anyVerified ? 'done' : anyMethod ? 'running' : 'waiting', result: anyVerified ? '至少一篇已通过定位' : anyMethod ? '正在逐条定位' : '等待方法字段' },
      { no: '05', name: '进入研究地图', state: anyMethod ? 'done' : 'waiting', result: anyMethod ? '可以进入' : '需先完成提取' },
    ];
  })();

  const stepTotal = overview.length;
  const stepDone = overview.filter((s) => s.state === 'done').length;
  const pct = Math.round((stepDone / stepTotal) * 100);
  const anyRunning = overview.some((s) => s.state === 'running');
  const progTitle = phase === 'done' && pct === 100 ? '方法论梳理已完成' : anyRunning || running ? '正在深度分析方法论...' : '等待开始梳理';
  const curOv =
    overview.find((s) => s.state === 'running') ??
    overview.find((s) => s.state === 'failed') ??
    overview.find((s) => s.state === 'waiting') ??
    overview[overview.length - 1];
  const progStepLabel = `步骤: ${curOv.no} ${curOv.name} (${stepDone}/${stepTotal})`;
  const progNote = curOv.result.slice(0, 42);

  /** 每个文件卡下面那行**真实状态**（草稿没有，但必须如实给） */
  const statusOf = (q: Queued): { text: string; cls: string } => {
    const r = q.result;
    if (!r) return { text: '等待分析', cls: 'text-[var(--fg-3)]' };
    if (r.error) return { text: `异常：${r.error}`, cls: 'text-red-600' };
    if (r.skipped) return { text: r.skipped, cls: 'text-[var(--fg-3)]' };
    const p = r.paper;
    if (!p) return { text: '未入库', cls: 'text-red-600' };
    if (p.parseStatus === 'failed') return { text: `解析失败：${p.parseError || '未知原因'}`, cls: 'text-red-600' };
    const job = jobs[p.id];
    if (job?.status === 'running') return { text: `提取中：${job.message || '等待模型响应'}`, cls: 'text-[var(--accent)]' };
    if (methods.some((m) => m.paperId === p.id)) return { text: '已完成：字段与证据已生成', cls: 'text-emerald-700' };
    if (job?.status === 'failed') return { text: `提取失败：${job.error || '模型调用失败'}`, cls: 'text-red-600' };
    return { text: modelReady ? '已解析，等待提取' : '已解析；未配置模型，不会产生替代结果', cls: 'text-[var(--fg-3)]' };
  };

  const pickFiles = () => fileRef.current?.click();

  return (
    <div className="uppage">
      {/* 草稿：<main class="max-w-[var(--content-max)] mx-auto px-6 pt-32 pb-64 relative"> */}
      <div className="max-w-[var(--content-max)] mx-auto px-6 pt-14 pb-64 relative">
        {/* Editorial Accent */}
        <div className="editorial-spine-thin hidden lg:block" aria-hidden="true" />

        {/* Hero */}
        <section className="mb-16 ml-0 lg:ml-20">
          <div className="flex flex-col gap-4">
            <p className="text-[var(--fg-3)] tracking-[0.3em] uppercase text-xs font-bold">Step 01 — Data Ingestion</p>
            <h1 className="text-4xl md:text-5xl font-serif font-bold tracking-tight text-[var(--fg)]">上传并梳理你的论文</h1>
            {/* 草稿写「Word 及主流学术格式」，本项目只支持 PDF —— 只改与事实不符的内容 */}
            <p className="text-[var(--fg-2)] text-lg max-w-2xl leading-relaxed">支持 PDF 批量导入。我们将自动识别方法论框架并生成你的研究地图。</p>
          </div>
        </section>

        {/* Main Upload Section */}
        <section className="grid grid-cols-12 gap-10 ml-0 lg:ml-20">
          {/* Left: Upload Zone */}
          <div className="col-span-12 lg:col-span-7 space-y-8">
            {/* 草稿没有这个横幅；自传论文存在但当前显示案例列表时，必须给用户醒目入口 */}
            {hiddenOwn > 0 && (
              <div data-own-entry className="bg-[var(--accent-soft)] border border-[var(--accent-line)] rounded-[20px] p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div className="text-sm text-[var(--fg)]">
                  <strong>你上传的 {hiddenOwn} 篇论文不在当前列表里</strong>
                  <span className="text-[var(--fg-3)]">（列表显示的是{scope.meta.label}的 {casePapers.length} 篇预置论文）</span>
                </div>
                <button className="btn-primary shrink-0" onClick={onUseOwnScope}>
                  查看我上传的 {hiddenOwn} 篇论文 →
                </button>
              </div>
            )}

            <div
              className={`upload-zone rounded-[20px] p-12 md:p-20 text-center flex flex-col items-center justify-center cursor-pointer group${dragOver ? ' drag-over' : ''}`}
              role="button"
              tabIndex={0}
              aria-label="拖拽 PDF 至此，或点击此处浏览本地文件"
              onClick={pickFiles}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  pickFiles();
                }
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const f = e.dataTransfer?.files;
                if (f && f.length) addFiles(f);
              }}
            >
              <div className="w-20 h-20 bg-[var(--accent-soft)] rounded-full flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                <DraftIcon name="upload-cloud" className="text-4xl text-[var(--accent)]" />
              </div>
              <h3 className="text-2xl font-serif font-bold mb-3">拖拽文件至此</h3>
              <p className="text-[var(--fg-3)] mb-8">或点击此处浏览本地文件 (支持多选)</p>
              <button
                className="btn-ghost"
                onClick={(e) => {
                  e.stopPropagation();
                  pickFiles();
                }}
              >
                浏览文件
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="application/pdf,.pdf"
                className="hidden"
                multiple
                onChange={(e) => {
                  if (e.target.files?.length) addFiles(e.target.files);
                  e.target.value = '';
                }}
              />
            </div>

            {/* Analysis Progress（草稿是 Initially Hidden，开始时才出现） */}
            {showAnalysis && (
              <div className="space-y-6">
                <div className="bg-white rounded-[20px] border border-[var(--line)] p-8 shadow-sm">
                  <div className="flex justify-between items-center mb-4">
                    <div>
                      <h4 className="text-lg font-bold">{progTitle}</h4>
                      <p className="text-sm text-[var(--fg-3)]">{progStepLabel}</p>
                    </div>
                    <span className="text-2xl font-serif font-black text-[var(--accent)]">{pct}%</span>
                  </div>
                  <div className="w-full bg-[var(--bg-3)] h-2 rounded-full overflow-hidden mb-4">
                    <div className="progress-bar-inner bg-[var(--accent)] h-full" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="flex justify-between text-xs text-[var(--fg-3)]">
                    {/* 草稿这里是「预计剩余时间: 1分20秒」（写死的假数据）→ 换成真实步数 */}
                    <span>{`共 ${stepTotal} 步 · 已完成 ${stepDone} 步`}</span>
                    <span className="flex items-center gap-1 italic">
                      <DraftIcon name="info" className="text-xs" />
                      {progNote}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* 草稿没有这块；但未配置模型时抽取无法进行，必须就地把接口配置给出来（不让用户先去找设置） */}
            {needModel && (
              <div className="bg-white rounded-[20px] border border-[var(--line)] p-8 shadow-sm space-y-4">
                <div className="flex justify-between items-center">
                  <div>
                    <h4 className="text-lg font-bold">提取方法字段需要模型接口</h4>
                    <p className="text-sm text-[var(--fg-3)]">解析已经完成并保留；密钥只保存在本机浏览器，不会写入任何产物。</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-[var(--fg-3)] mb-1">接口地址（OpenAI 兼容）</label>
                    <input className="w-full border border-[var(--line-2)] rounded-[8px] px-3 py-2 text-sm bg-white" value={draft.baseUrl} onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })} placeholder="https://api.deepseek.com/v1" />
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--fg-3)] mb-1">模型名</label>
                    <input className="w-full border border-[var(--line-2)] rounded-[8px] px-3 py-2 text-sm bg-white" value={draft.model} onChange={(e) => setDraft({ ...draft, model: e.target.value })} placeholder="deepseek-chat" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-[var(--fg-3)] mb-1">密钥</label>
                  <input className="w-full border border-[var(--line-2)] rounded-[8px] px-3 py-2 text-sm bg-white" type="password" value={draft.apiKey} onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })} placeholder="sk-…" />
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                  <button className="btn-primary" onClick={() => onSaveConfig(draft)}>
                    保存并继续
                  </button>
                  <button className="btn-ghost" onClick={() => onTest(draft)} disabled={testing}>
                    {testing ? '测试中…' : '测试连接'}
                  </button>
                  {testResult && <span className="text-xs text-[var(--fg-3)]">{testResult}</span>}
                </div>
              </div>
            )}
          </div>

          {/* Right: File List & Action */}
          <div className="col-span-12 lg:col-span-5">
            <div className="bg-[var(--bg-2)] border border-[var(--line)] rounded-[20px] p-8 sticky top-32">
              <div className="flex justify-between items-center mb-6">
                <h4 className="font-serif font-bold text-xl">待处理队列</h4>
                <span className="text-xs font-bold bg-[var(--accent-soft)] text-[var(--accent)] px-2 py-1 rounded">{`${queue.length} 个文件`}</span>
              </div>
              <div className="space-y-4 max-h-[400px] overflow-y-auto mb-8 pr-2 custom-scrollbar">
                {queue.length > 0 ? (
                  queue.map((q) => {
                    const st = statusOf(q);
                    const p = q.result?.paper;
                    return (
                      <div key={q.id} className={`file-card flex items-center gap-4 group${p && p.id === lastImportedId ? ' ring-1 ring-[var(--accent-line)]' : ''}`} data-file-card>
                        <div className="w-10 h-10 bg-[var(--bg-3)] rounded flex items-center justify-center text-[var(--accent)] shrink-0">
                          <DraftIcon name="file-text" className="text-xl" />
                        </div>
                        <div className="flex-1 min-w-0">
                          {p ? (
                            <button data-file-name className="text-sm font-bold truncate block w-full text-left hover:text-[var(--accent)]" onClick={() => onOpenPaper(p.id)} title="在论文集合里查看详情">
                              {q.file.name}
                            </button>
                          ) : (
                            <p data-file-name className="text-sm font-bold truncate">{q.file.name}</p>
                          )}
                          <p className="text-[10px] text-[var(--fg-3)] uppercase">{`${sizeMB(q.file.size)} MB • PDF`}</p>
                          {/* 草稿没有这一行；每个文件的真实状态必须如实给出 */}
                          <p data-file-status className={`text-[10px] mt-0.5 leading-relaxed ${st.cls}`}>{st.text}</p>
                        </div>
                        <button data-file-remove className="text-[var(--fg-3)] hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => removeFile(q.id)} disabled={running} aria-label={`移除 ${q.file.name}`} title="移除">
                          <DraftIcon name="x" className="text-lg" />
                        </button>
                      </div>
                    );
                  })
                ) : (
                  <div className="text-center py-10" data-queue-empty>
                    <p className="text-[var(--fg-3)] text-sm">尚未选择任何文件</p>
                  </div>
                )}
              </div>
              <div className="pt-6 border-t border-[var(--line)] space-y-4">
                <button
                  className={`w-full disabled:opacity-50 disabled:cursor-not-allowed ${phase === 'done' ? 'btn-primary is-done' : 'btn-primary'}`}
                  disabled={running || !queue.some((x) => !x.result)}
                  onClick={() => void start()}
                >
                  {running ? (
                    <>
                      <DraftIcon name="loader-2" className="animate-spin mr-2" />
                      分析中...
                    </>
                  ) : phase === 'done' ? (
                    '分析完成'
                  ) : (
                    '开始梳理脉络'
                  )}
                </button>
                {/* 草稿这里承诺「所有上传文件将进行加密处理」——本项目是本机解析、根本不上传，按铁律改成真实说法；
                    草稿指向的「数据使用协议」也不存在，不保留不存在的承诺。 */}
                <p className="text-[10px] text-[var(--fg-3)] text-center px-4 leading-relaxed">
                  解析在本机浏览器完成，论文不会上传到服务器；只有在你配置模型接口后，才会把解析出的正文送去抽取。密钥只保存在本机。
                </p>
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* 草稿：<footer class="border-t border-[var(--line)] bg-white py-12">，是 <main> 的兄弟节点（通栏） */}
      <footer className="border-t border-[var(--line)] bg-white py-12">
        <div className="max-w-[var(--content-max)] mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-4">
            <span className="font-serif font-bold">ResearchPilot</span>
            <span className="text-xs text-[var(--fg-3)] uppercase tracking-widest border-l border-[var(--line)] pl-4">Privacy &amp; Trust First</span>
          </div>
          {/* 草稿的「使用指南 / 法律条款」在本项目里并不存在 → 换成真实入口（结构与样式照草稿） */}
          <div className="flex gap-8 text-sm">
            <button className="text-link" onClick={() => onGo?.('landing')}>
              返回首页
            </button>
            <button className="text-[var(--fg-3)] hover:text-[var(--fg)]" onClick={() => onGo?.('library')}>
              查看论文集合
            </button>
            <button className="text-[var(--fg-3)] hover:text-[var(--fg)]" onClick={() => onGo?.('settings')}>
              打开设置
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
