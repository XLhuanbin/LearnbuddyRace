import React, { useRef, useState } from 'react';
import type { Method, Paper } from '../core/types';
import type { JobState } from './Library';
import { verifiedOf } from './Library';
import { FIELD_KEYS_ORDER } from '../core/cache';
import type { CorpusScope } from '../core/corpus';
import { Status } from './common';
import type { ImportResult } from '../App';

interface Props {
  papers: Paper[];
  /** 当前分析范围（案例 = 当前语料全部论文；我上传 = 用户自传）。计数必须与它一致 */
  scope: CorpusScope;
  methods: Method[];
  jobs: Record<string, JobState>;
  modelReady: boolean;
  config: { baseUrl: string; apiKey: string; model: string };
  onSaveConfig: (c: { baseUrl: string; apiKey: string; model: string }) => void | Promise<void>;
  onTest: (c: { baseUrl: string; apiKey: string; model: string }) => void;
  testing: boolean;
  testResult?: string;
  onPaste: (title: string, text: string) => void;
  /**
   * 草稿的前端逻辑：把攒好的文件一次性交给底层分析（导入解析 → 已配置模型时逐篇抽取），
   * 返回**逐文件**的真实结果，队列据此按文件如实显示状态。
   */
  onAnalyze: (files: File[]) => Promise<ImportResult[]>;
  onEnterMap: () => void;
  /** 点队列里的一篇 → 跳去论文集合看详情（字段/证据/重解析/取消都在那） */
  onOpenPaper: (paperId: string) => void;
  lastImportedId?: string | null;
  onUseOwnScope: () => void;
  onUseCaseScope: () => void;
  /** 页脚的真实导航（兼容新增：草稿页脚指向的「使用指南 / 法律条款」并不存在，改为真实入口） */
  onGo?: (tab: string) => void;
}

type StepState = 'done' | 'running' | 'waiting' | 'failed';

interface Step {
  no: string;
  name: string;
  desc: string;
  result: string;
  next: string;
  state: StepState;
}

const STATE_TEXT: Record<StepState, string> = { done: '已完成', running: '进行中', waiting: '等待中', failed: '失败' };

/**
 * 五步处理流程：上传论文 → 解析文本 → 提取方法字段 → 校验原文证据 → 进入研究地图。
 * 每一步都给出真实状态与已得到的结果；等待模型绝不显示成「分析完成」。
 */
function stepsOf(p: Paper, m: Method | undefined, job: JobState | undefined, modelReady: boolean): Step[] {
  const parsed = p.parseStatus === 'ok';
  const parseFailed = p.parseStatus === 'failed';
  const extracting = job?.status === 'running';
  const extractFailed = job?.status === 'failed';
  const canceled = job?.status === 'canceled';
  const hasMethod = !!m;
  const verified = m ? verifiedOf(m) : 0;
  const withValue = m ? FIELD_KEYS_ORDER.filter((k) => m.fields[k]?.value).length : 0;

  return [
    {
      no: '01',
      name: '上传论文',
      desc: '文件进入本机浏览器',
      state: 'done',
      result: `${p.pageCount ?? '?'} 页 · ${p.charCount ?? '?'} 字符`,
      next: '解析出全文与页码，供证据定位使用',
    },
    {
      no: '02',
      name: '解析文本',
      desc: '本机完成，不上传服务器',
      state: parseFailed ? 'failed' : parsed ? 'done' : 'waiting',
      result: parseFailed ? `失败：${p.parseError || '未知原因'}` : parsed ? '已得到按页存储的全文' : '等待解析',
      next: '调用模型抽取 7 个方法字段',
    },
    {
      no: '03',
      name: '提取方法字段',
      desc: '需要模型接口',
      state: extractFailed ? 'failed' : extracting ? 'running' : hasMethod ? 'done' : 'waiting',
      result: extracting
        ? `正在等待模型响应（${job?.message || '已发出请求'}）—— 等待不代表完成`
        : hasMethod
          ? `已得到 ${withValue}/7 个字段有值${m?.cached ? '（缓存结果）' : ''}`
          : extractFailed
            ? `失败：${job?.error || '模型调用失败'}`
            : canceled
              ? '已停止等待：本次调用未完成，原结果保留'
              : modelReady
                ? '等待开始'
                : '未配置模型：不会产生替代结果',
      next: '把每条引文回到论文全文做定位校验',
    },
    {
      no: '04',
      name: '校验原文证据',
      desc: '引文必须能在全文中定位',
      state: hasMethod ? (verified > 0 ? 'done' : 'waiting') : 'waiting',
      result: hasMethod
        ? verified > 0
          ? `${verified}/7 个字段的引文已通过全文定位校验`
          : '没有字段通过定位校验，统一标「待人工核对 / 未找到证据」'
        : '等待方法字段',
      next: '进入研究地图，看方法分组与真实关系',
    },
    {
      no: '05',
      name: '进入研究地图',
      desc: '看分组、关系与阅读顺序',
      state: hasMethod ? 'done' : 'waiting',
      result: hasMethod ? '可以进入研究地图' : '需要先完成方法字段提取',
      next: '',
    },
  ];
}

/** 队列里的一项：占位 = 已攒下但还没分析的文件 */
interface Queued {
  id: string;
  file: File;
  /** 分析后拿到的真实结果（没有 = 还没分析） */
  result?: ImportResult;
}

const uid = () => Math.random().toString(36).slice(2, 11);
const sizeMB = (n: number) => (n / 1024 / 1024).toFixed(2);

/**
 * 方法提取页 —— **按 Superdesign 草稿 a6947252 的前端逻辑与美术实现**。
 *
 * 草稿的逻辑（本页严格照此实现，底层已改来适配它）：
 *   1. 拖拽/浏览 → 文件进入「待处理队列」（文件卡：图标 + 文件名 + 大小 • PDF + 悬停删除），计数「N 个文件」
 *   2. 「开始梳理脉络」→ 按钮变「分析中…」+ 转圈，拖拽区变灰且禁用
 *   3. 分析卡出现 → 进度条 + 大号百分比 + 步骤文案；完成时按钮变绿「分析完成」
 *
 * 与草稿的唯一差别：草稿那 45% / 「预计剩余 1分20秒」是写死的假进度，
 * 这里换成**真实的**步骤进度（同一套结构，只换数值来源）；
 * 每个文件卡下面额外给一行**真实状态**（已解析 / 提取中 / 解析失败…），这行草稿没有、是必需的诚实信息。
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
  onPaste,
  onAnalyze,
  onEnterMap,
  onOpenPaper,
  lastImportedId,
  onUseOwnScope,
  onUseCaseScope,
  onGo,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [queue, setQueue] = useState<Queued[]>([]);
  const [phase, setPhase] = useState<'idle' | 'running' | 'done'>('idle');
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteTitle, setPasteTitle] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [draft, setDraft] = useState(config);
  const [dragOver, setDragOver] = useState(false);

  const running = phase === 'running';
  const stayAsIs = phase !== 'idle';

  const casePapers = scope.presetPapers;
  const ownPapers = scope.ownPapers;
  const listMode: 'case' | 'own' = scope.mode === 'own' || (casePapers.length === 0 && ownPapers.length > 0) ? 'own' : 'case';
  const hiddenOwn = listMode === 'case' && ownPapers.length > 0 ? ownPapers.length : 0;
  const hasMethod = (p: Paper) => methods.some((m) => m.paperId === p.id);
  const needModel = !modelReady && papers.some((p) => p.parseStatus === 'ok' && !hasMethod(p));

  /** 把攒下的文件加进队列（按 名字+大小 去重，避免同一个文件重复占位） */
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

  /** 「开始梳理脉络」：把没分析过的文件交给底层一次性分析，再把逐文件结果贴回队列 */
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

  /** 队列里所有文件对应的论文（用于页级总览与到论文集合的跳转） */
  const queuedPapers = queue.map((x) => x.result?.paper).filter(Boolean) as Paper[];
  const stagePapers = queuedPapers.length ? queuedPapers : papers;

  /** 页级总览：把每篇的状态合并成一条流程（取最靠后的真实进度） */
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
      {
        no: '04',
        name: '校验原文证据',
        state: anyVerified ? 'done' : anyMethod ? 'running' : 'waiting',
        result: anyVerified ? '至少一篇已通过定位' : anyMethod ? '正在逐条定位' : '等待方法字段',
      },
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

  /** 每个文件卡下面那行**真实状态**（草稿没有，但必须给） */
  const statusOf = (q: Queued): { text: string; tone: 'ok' | 'bad' | 'run' | 'mute' } => {
    const r = q.result;
    if (!r) return { text: '等待分析', tone: 'mute' };
    if (r.error) return { text: `异常：${r.error}`, tone: 'bad' };
    if (r.skipped) return { text: r.skipped, tone: 'mute' };
    const p = r.paper;
    if (!p) return { text: '未入库', tone: 'bad' };
    if (p.parseStatus === 'failed') return { text: `解析失败：${p.parseError || '未知原因'}`, tone: 'bad' };
    const job = jobs[p.id];
    if (job?.status === 'running') return { text: `提取中：${job.message || '等待模型响应'}`, tone: 'run' };
    if (methods.some((m) => m.paperId === p.id)) return { text: '已完成：字段与证据已生成', tone: 'ok' };
    if (job?.status === 'failed') return { text: `提取失败：${job.error || '模型调用失败'}`, tone: 'bad' };
    return { text: modelReady ? '已解析，等待提取' : '已解析；未配置模型，不会产生替代结果', tone: 'mute' };
  };

  const pickFiles = () => fileRef.current?.click();

  return (
    <div className="uppage">
      <div className="up-main">
        {/* Editorial Accent（草稿原样） */}
        <div className="up-spine" aria-hidden="true" />

        {/* Hero（草稿结构：eyebrow → h1 → 一句说明） */}
        <section className="up-hero">
          <div className="up-hero-in">
            <p className="up-eyebrow">方法提取 · Step 01 — 上传论文</p>
            <h1 className="up-title">上传并梳理你的论文</h1>
            <p className="up-lede">支持 PDF 批量导入。我们将自动识别方法论框架并生成你的研究地图。</p>
          </div>
        </section>

        {hiddenOwn > 0 && (
          <div className="ownentry" role="status" style={{ marginBottom: 24 }}>
            <div>
              <strong>你上传的 {hiddenOwn} 篇论文不在当前列表里</strong>
              <span className="small dim">
                （列表显示的是{scope.meta.label}的 {casePapers.length} 篇预置论文）
              </span>
            </div>
            <button className="btn-primary" onClick={onUseOwnScope}>
              查看我上传的 {hiddenOwn} 篇论文 →
            </button>
          </div>
        )}

        <section className="up-grid">
          {/* Left: Upload Zone */}
          <div className="up-col-main">
            <div
              className={`upload-zone${dragOver ? ' drag-over' : ''}${running ? ' is-dim' : ''}`}
              role="button"
              tabIndex={0}
              aria-label="拖拽 PDF 至此，或点击浏览本地文件"
              aria-disabled={running}
              onClick={() => !running && pickFiles()}
              onKeyDown={(e) => {
                if (running) return;
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  pickFiles();
                }
              }}
              onDragOver={(e) => {
                e.preventDefault();
                if (!running) setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                if (running) return;
                const f = e.dataTransfer?.files;
                if (f && f.length) addFiles(f);
              }}
            >
              <div className="up-zone-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17.5 18a4.5 4.5 0 0 0 .5-8.97A6 6 0 0 0 6.1 10.2 4 4 0 0 0 6.5 18h11Z" />
                  <path d="M12 12v6M9.5 14.5 12 12l2.5 2.5" />
                </svg>
              </div>
              <h3 className="up-zone-title">拖拽 PDF 至此</h3>
              <p className="up-zone-sub">或点击此处浏览本地文件 (支持多选)</p>
              <button
                className="btn-ghost"
                disabled={running}
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
                multiple
                style={{ display: 'none' }}
                onChange={(e) => {
                  if (e.target.files?.length) addFiles(e.target.files);
                  e.target.value = '';
                }}
              />
            </div>

            {/* 分析进度卡：草稿是「开始时才出现」，这里同样只在分析中 / 已分析过时出现 */}
            {stayAsIs && (
              <div className="up-prog">
                <div className="up-prog-head">
                  <div>
                    <h4 className="up-prog-title">{progTitle}</h4>
                    <p className="up-prog-step">{progStepLabel}</p>
                  </div>
                  <span className="up-prog-pct">{pct}%</span>
                </div>
                <div className="up-prog-track">
                  <div className="up-prog-fill" style={{ width: `${pct}%` }} />
                </div>
                <div className="up-prog-foot">
                  <span>{`共 ${stepTotal} 步 · 已完成 ${stepDone} 步`}</span>
                  <span className="up-prog-note">
                    <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round">
                      <circle cx="12" cy="12" r="9" />
                      <path d="M12 11v5M12 8h.01" />
                    </svg>
                    {progNote}
                  </span>
                </div>
              </div>
            )}

            {/* 粘贴论文正文（原页面功能，兼容保留） */}
            {pasteOpen && (
              <div className="up-prog up-paste">
                <div className="up-prog-head" style={{ marginBottom: 8 }}>
                  <h4 className="up-prog-title">粘贴论文正文</h4>
                </div>
                <label className="f">论文标题</label>
                <input
                  className="f"
                  value={pasteTitle}
                  onChange={(e) => setPasteTitle(e.target.value)}
                  placeholder="例如：Attention Is All You Need"
                />
                <label className="f" style={{ marginTop: 10 }}>
                  论文正文（按页分隔存储，证据定位能力与 PDF 一致）
                </label>
                <textarea className="f" rows={5} value={pasteText} onChange={(e) => setPasteText(e.target.value)} />
                <div className="row" style={{ marginTop: 8, gap: 8, flexWrap: 'wrap' }}>
                  <button
                    className="btn-primary"
                    disabled={!pasteTitle.trim() || pasteText.trim().length < 200}
                    onClick={() => {
                      onPaste(pasteTitle.trim(), pasteText.trim());
                      setPasteTitle('');
                      setPasteText('');
                      setPasteOpen(false);
                    }}
                  >
                    进入流程（解析这段正文）
                  </button>
                  <button className="btn-ghost" onClick={() => setPasteOpen(false)}>
                    收起
                  </button>
                  <span className="small dim">解析在本机完成；字段抽取需要模型接口</span>
                </div>
              </div>
            )}

            {/* 模型配置（原页面功能，兼容保留） */}
            {needModel && (
              <div className="up-prog" style={{ borderColor: 'var(--warn-line)', background: 'var(--warn-soft)' }}>
                <div className="up-prog-head" style={{ marginBottom: 8 }}>
                  <div>
                    <h4 className="up-prog-title">第 03 步需要模型接口</h4>
                    <p className="up-prog-step">解析已经完成并保留；密钥只保存在本机浏览器，不会写入任何产物。</p>
                  </div>
                  <Status kind="warn">未配置</Status>
                </div>
                <div className="grid2">
                  <div>
                    <label className="f">接口地址（OpenAI 兼容）</label>
                    <input className="f" value={draft.baseUrl} onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })} placeholder="https://api.deepseek.com/v1" />
                  </div>
                  <div>
                    <label className="f">模型名</label>
                    <input className="f" value={draft.model} onChange={(e) => setDraft({ ...draft, model: e.target.value })} placeholder="deepseek-chat" />
                  </div>
                </div>
                <label className="f" style={{ marginTop: 10 }}>
                  密钥
                </label>
                <input className="f" type="password" value={draft.apiKey} onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })} placeholder="sk-…" />
                <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                  <button className="btn-primary" onClick={() => onSaveConfig(draft)}>
                    保存并继续
                  </button>
                  <button className="btn-ghost" onClick={() => onTest(draft)} disabled={testing}>
                    {testing ? '测试中…' : '测试连接'}
                  </button>
                  {testResult && <span className="small dim">{testResult}</span>}
                </div>
              </div>
            )}
          </div>

          {/* Right: 待处理队列（草稿结构原样） */}
          <div className="up-col-side">
            <div className="up-side">
              <div className="up-side-head">
                <h4 className="up-side-title">待处理队列</h4>
                <span className="up-count">{`${queue.length} 个文件`}</span>
              </div>

              <div className="up-list">
                {queue.length > 0 ? (
                  queue.map((q) => {
                    const st = statusOf(q);
                    const p = q.result?.paper;
                    const clickable = !!p;
                    return (
                      <div key={q.id} className={`filecard${p && p.id === lastImportedId ? ' just' : ''}`}>
                        <div className="fc-icon" aria-hidden="true">
                          <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M14 3v5h5" />
                            <path d="M19 21H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h9l5 5v12a1 1 0 0 1-1 1Z" />
                            <path d="M8 13h8M8 17h5" />
                          </svg>
                        </div>
                        <div className="fc-body">
                          {clickable ? (
                            <button className="fc-name" onClick={() => onOpenPaper(p!.id)} title="在论文集合里查看详情">
                              {q.file.name}
                            </button>
                          ) : (
                            <p className="fc-name">{q.file.name}</p>
                          )}
                          <p className="fc-meta">{`${sizeMB(q.file.size)} MB • PDF`}</p>
                          {/* 草稿没有这一行；每个文件的真实状态必须如实给出来 */}
                          <p className={`fc-status ${st.tone}`}>{st.text}</p>
                        </div>
                        <button className="fc-x" onClick={() => removeFile(q.id)} disabled={running} aria-label={`移除 ${q.file.name}`} title="移除">
                          <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round">
                            <path d="M18 6 6 18M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    );
                  })
                ) : (
                  <div className="up-empty">
                    <p>尚未选择任何文件</p>
                  </div>
                )}
              </div>

              <div className="up-side-foot">
                <button
                  className={`btn-primary${running ? ' is-running' : ''}${phase === 'done' ? ' is-done' : ''}`}
                  disabled={running || !queue.some((x) => !x.result)}
                  onClick={() => void start()}
                >
                  {running ? (
                    <>
                      <svg className="spin" viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round">
                        <path d="M12 3a9 9 0 1 0 9 9" />
                      </svg>
                      分析中...
                    </>
                  ) : phase === 'done' ? (
                    '分析完成'
                  ) : (
                    '开始梳理脉络'
                  )}
                </button>
                <button className="btn-ghost" onClick={() => setPasteOpen((v) => !v)}>
                  粘贴论文正文
                </button>
                <p className="up-fineprint">
                  解析在本机浏览器完成，论文不会上传到服务器；只有在你配置模型接口后，才会把解析出的正文送去抽取。密钥只保存在本机。
                </p>
              </div>
            </div>
          </div>
        </section>
      </div>

      <footer className="up-foot">
        <div className="up-foot-in">
          <div className="up-foot-brand">
            <span className="b">ResearchPilot</span>
            {/* 2026-10-10：恢复草稿原文。它是定位标语（不是与事实不符的编造），
                而且必须是英文才能吃到 .up-foot-tag 的 uppercase + letter-spacing，改成中文那套字距就没了。 */}
            <span className="up-foot-tag">Privacy &amp; Trust First</span>
          </div>
          <div className="up-foot-links">
            <button className="text-link" onClick={() => onGo?.('landing')}>
              返回首页
            </button>
            <button className="dimlink" onClick={() => onGo?.('library')}>
              查看论文集合
            </button>
            <button className="dimlink" onClick={() => onGo?.('settings')}>
              打开设置
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
