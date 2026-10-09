import React, { useRef, useState } from 'react';
import type { Method, Paper } from '../core/types';
import type { JobState } from './Library';
import { verifiedOf } from './Library';
import { FIELD_KEYS_ORDER } from '../core/cache';
import { buildMethodProfile, shortContribution } from '../core/grouping';
import type { CorpusScope } from '../core/corpus';
import { effectiveFieldValue } from '../core/effective';
import { FlowBar, Status } from './common';
import { titleNeedsConfirm } from '../core/rules';

interface Props {
  papers: Paper[];
  /** 当前分析范围（案例 = 当前语料全部论文；我上传 = 用户自传）。论文列表必须与它一致 */
  scope: CorpusScope;
  methods: Method[];
  jobs: Record<string, JobState>;
  modelReady: boolean;
  config: { baseUrl: string; apiKey: string; model: string };
  onSaveConfig: (c: { baseUrl: string; apiKey: string; model: string }) => void | Promise<void>;
  onTest: (c: { baseUrl: string; apiKey: string; model: string }) => void;
  testing: boolean;
  testResult?: string;
  onImport: (files: FileList) => void;
  onPaste: (title: string, text: string) => void;
  onExtract: (paperId: string, force: boolean) => void;
  onEnterMap: () => void;
  /** 点队列里的一篇 → 跳去论文集合看详情（字段/证据/重解析/取消都在那） */
  onOpenPaper: (paperId: string) => void;
  /** 刚刚导入的论文：默认高亮并给出醒目入口 */
  lastImportedId?: string | null;
  /** 切到「我上传的论文」/「案例」范围（列表与计数会一起跟着走） */
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
  /** 已经得到的结果（真实状态，不用百分比或转圈代替） */
  result: string;
  /** 下一步会产生什么 */
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

/**
 * 方法提取页。
 *
 * **外观按 Superdesign 草稿 a6947252「论文上传与分析」逐元素严格复刻**：
 * 左侧 40px 细脊线、eyebrow + 超大衬线标题 + 一句说明的首屏、12 栅格 7/5 两栏、
 * 虚线拖拽区、白底分析进度卡（标题 + 步骤 + 大号百分比 + 进度条 + 底部两行小字）、
 * sticky 待处理队列卡、通栏页脚 —— 结构与数值都照草稿，不改外观组件。
 *
 * **只替换了与事实不符的内容**，并**移除了草稿没有、纯属重复的「每篇论文详情」**：
 * 字段/证据/重解析/取消等按篇功能都在「论文集合」页，本页只负责「上传 → 看进度 → 进队列」，
 * 点队列里的一篇会跳到论文集合看详情。
 *
 * 为兼容不得不加的部分（已注明）：顶栏是 sticky 而非草稿的 fixed，故 main 不照抄 pt-32；
 * 原页面的真实功能（粘贴正文、五步 FlowBar、模型配置）作为左栏追加卡片保留。
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
  onImport,
  onPaste,
  onExtract,
  onEnterMap,
  onOpenPaper,
  lastImportedId,
  onUseOwnScope,
  onUseCaseScope,
  onGo,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteTitle, setPasteTitle] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [draft, setDraft] = useState(config);
  const [dragOver, setDragOver] = useState(false);

  /**
   * 论文列表用**当前分析范围**的论文，和导航 / 地图 / 实验比较是同一个集合。
   * 旧实现写成 papers.slice(-3)：案例模式下只显示最后 3 篇，既和页头总数不一致，
   * 也让前两篇（ResNet / ViT）根本点不开 —— 这是一处静默的业务截断，已删除。
   */
  const casePapers = scope.presetPapers;
  const ownPapers = scope.ownPapers;
  /**
   * 列表范围规则（与全局分析范围保持一致）：
   * - 只要进入过 own 范围（导入后 App 会切过去），就显示我上传的论文；
   * - 案例里一篇都没有但用户有自传论文时，也显示自传论文（否则页面会是空的）；
   * - 其余情况显示案例。
   * 无论哪种，**列表 / 计数 / 抽取入口都取自同一个 `shown`**。
   */
  const listMode: 'case' | 'own' = scope.mode === 'own' || (casePapers.length === 0 && ownPapers.length > 0) ? 'own' : 'case';
  const shown = listMode === 'own' ? ownPapers : casePapers;
  /** 自传论文存在但当前看的是案例列表 → 必须给出醒目入口（不能静默藏着） */
  const hiddenOwn = listMode === 'case' && ownPapers.length > 0 ? ownPapers.length : 0;
  const pendingExtract = shown.filter((p) => p.parseStatus === 'ok' && !methods.some((m) => m.paperId === p.id));
  const hasMethod = (p: Paper) => methods.some((m) => m.paperId === p.id);
  const doneCount = shown.filter(hasMethod).length;
  const needModel = !modelReady && shown.some((p) => p.parseStatus === 'ok' && !hasMethod(p));

  /** 页面级总览：把每篇的状态合并成一条流程（取最靠后的真实进度） */
  const overview: { no: string; name: string; state: StepState; result: string }[] = (() => {
    const anyUploaded = shown.length > 0;
    const anyParsed = shown.some((p) => p.parseStatus === 'ok');
    const allParseFailed = shown.length > 0 && shown.every((p) => p.parseStatus === 'failed');
    const extracting = shown.some((p) => jobs[p.id]?.status === 'running');
    const anyExtractFailed = shown.some((p) => jobs[p.id]?.status === 'failed');
    const anyMethod = shown.some(hasMethod);
    const anyVerified = shown.some((p) => {
      const m = methods.find((x) => x.paperId === p.id);
      return m ? verifiedOf(m) > 0 : false;
    });
    return [
      { no: '01', name: '上传论文', state: anyUploaded ? 'done' : 'waiting', result: anyUploaded ? `${shown.length} 篇` : '还没有论文' },
      {
        no: '02',
        name: '解析文本',
        state: allParseFailed && !anyParsed ? 'failed' : anyParsed ? 'done' : anyUploaded ? 'running' : 'waiting',
        result: anyParsed ? `${shown.filter((p) => p.parseStatus === 'ok').length} 篇已解析` : allParseFailed ? '全部失败' : '等待解析',
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

  /** 进度卡的三个真实数值（结构与草稿一致，只是数值来自真实步骤而不是写死的 45%） */
  const stepTotal = overview.length;
  const stepDone = overview.filter((s) => s.state === 'done').length;
  const pct = Math.round((stepDone / stepTotal) * 100);
  const anyRunning = overview.some((s) => s.state === 'running');
  const progTitle = pct === 100 ? '方法论梳理已完成' : anyRunning ? '正在深度分析方法论...' : '等待开始梳理';
  const curOv =
    overview.find((s) => s.state === 'running') ??
    overview.find((s) => s.state === 'failed') ??
    overview.find((s) => s.state === 'waiting') ??
    overview[overview.length - 1];
  const progStepLabel = `步骤: ${curOv.no} ${curOv.name} (${stepDone}/${stepTotal})`;
  const progNote = curOv.result.slice(0, 42);

  /** 方法短名：与论文集合 / 研究地图使用同一套派生规则 */
  const shortNameOf = (m: Method) => buildMethodProfile(m, papers.find((x) => x.id === m.paperId), papers).shortName;

  const pickFiles = () => fileRef.current?.click();

  return (
    <div className="uppage">
      <div className="up-main">
        {/* Editorial Accent（草稿原样） */}
        <div className="up-spine" aria-hidden="true" />

        {/* Hero（草稿结构：eyebrow → h1 → 一句说明，flex col gap-4） */}
        <section className="up-hero">
          <div className="up-hero-in">
            <p className="up-eyebrow">方法提取 · Step 01 — 上传论文</p>
            <h1 className="up-title">上传并梳理你的论文</h1>
            <p className="up-lede">
              支持 PDF 批量导入。我们将自动识别方法论框架并生成你的研究地图。
            </p>
          </div>
        </section>

        {/* 自传论文存在、但当前显示的是案例列表 → 醒目入口，绝不静默藏着 */}
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

        {/* Main Upload Section：grid 12 gap-10 */}
        <section className="up-grid">
          {/* Left: Upload Zone（col-span-7 space-y-8） */}
          <div className="up-col-main">
            {/* 拖拽区（草稿结构与类名原样，接真实文件输入） */}
            <div
              className={`upload-zone${dragOver ? ' drag-over' : ''}`}
              role="button"
              tabIndex={0}
              aria-label="拖拽 PDF 至此，或点击浏览本地文件"
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
                if (f && f.length) onImport(f);
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
                  if (e.target.files?.length) onImport(e.target.files);
                  e.target.value = '';
                }}
              />
            </div>

            {/* 分析进度卡（草稿结构与样式原样；数值换成真实的步骤进度） */}
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

            {/* 五步真实流程（原页面功能，兼容保留；草稿没有等价物） */}
            <div className="up-prog">
              <FlowBar steps={overview} />
            </div>

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

            {/* 刚导入的论文：明确告诉用户「在哪里、可以去论文集合看详情」 */}
            {lastImportedId &&
              (() => {
                const just = shown.find((p) => p.id === lastImportedId);
                if (!just) return null;
                const t = just.title.length > 52 ? just.title.slice(0, 52) + '…' : just.title;
                return (
                  <div className="justbar" role="status">
                    <Status kind="ok">刚刚导入</Status>
                    <span className="small">
                      已导入「<strong>{t}</strong>」，可在论文集合里查看详情与抽取。
                    </span>
                    {listMode === 'own' ? (
                      <button className="btn ghost sm" onClick={onUseCaseScope}>
                        切回{scope.meta.label}
                      </button>
                    ) : null}
                  </div>
                );
              })()}

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

          {/* Right: File List & Action（col-span-5） */}
          <div className="up-col-side">
            <div className="up-side">
              <div className="up-side-head">
                <h4 className="up-side-title">待处理队列</h4>
                <span className="up-count">{`${shown.length} 个文件`}</span>
              </div>

              <div className="up-list">
                {shown.length > 0 ? (
                  shown.map((p) => {
                    const m = methods.find((x) => x.paperId === p.id);
                    const job = jobs[p.id];
                    const steps = stepsOf(p, m, job, modelReady);
                    const bad = steps.find((s) => s.state === 'failed');
                    const c = steps.find((s) => s.state === 'running') ?? bad ?? steps.find((s) => s.state === 'waiting') ?? steps[4];
                    const state = job?.status === 'running' ? 'running' : bad ? 'failed' : m ? 'done' : 'waiting';
                    return (
                      <button
                        key={p.id}
                        className={`up-row${p.id === lastImportedId ? ' just' : ''}`}
                        onClick={() => onOpenPaper(p.id)}
                        title="在论文集合里查看详情"
                      >
                        <span className="nm">
                          {p.title}
                          {titleNeedsConfirm(p) && (
                            <span className="titleflag" title="PDF 首页排版多变，这个标题是猜出来的，还没在原文里核验">
                              标题待确认
                            </span>
                          )}
                        </span>
                        <span className="mname">{m ? shortNameOf(m) : '尚未提取方法'}</span>
                        <span className="idea">
                          {m ? shortContribution(effectiveFieldValue(m, 'coreIdea')) || '尚未提取到核心思路' : '还没有方法结果'}
                        </span>
                        <span className="st">
                          <i className={`dot ${state === 'done' ? 'ok' : state === 'failed' ? 'bad' : state === 'running' ? 'run' : 'mute'}`} />
                          {m ? '已完成' : `${c.no} ${c.name} · ${STATE_TEXT[c.state]}`}
                        </span>
                      </button>
                    );
                  })
                ) : (
                  <div className="up-empty">
                    <p>尚未选择任何文件</p>
                    <p style={{ marginTop: 8, fontSize: 12 }}>
                      解析失败会给出原因，不会静默返回空结果。
                    </p>
                  </div>
                )}
              </div>

              <div className="up-side-foot">
                <button
                  className="btn-primary"
                  disabled={!pendingExtract.length}
                  onClick={() => {
                    if (pendingExtract.length) onExtract(pendingExtract[0].id, false);
                  }}
                >
                  开始梳理脉络
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

      {/* footer：border-t bg-white py-12（草稿结构原样） */}
      <footer className="up-foot">
        <div className="up-foot-in">
          <div className="up-foot-brand">
            <span className="b">ResearchPilot</span>
            <span className="up-foot-tag">本机解析 · 结论带原文依据</span>
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
