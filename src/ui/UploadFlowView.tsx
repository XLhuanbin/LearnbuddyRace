import React, { useRef, useState } from 'react';
import type { Method, Paper } from '../core/types';
import type { JobState } from './Library';
import { verifiedOf } from './Library';
import { FIELD_KEYS_ORDER } from '../core/cache';
import { METHOD_FIELD_LABELS, FIELD_STATUS_TEXT } from '../core/types';
import { buildMethodProfile, shortContribution } from '../core/grouping';
import type { CorpusScope } from '../core/corpus';
import { effectiveFieldValue } from '../core/effective';
import { FlowBar, NextStep, PageHead, Status } from './common';
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
  /** 重新解析 PDF（会真正重跑解析；必要时要用户重新选一次文件） */
  onReparse: (paperId: string) => void;
  /** 这份 PDF 现在能否直接重解析（文件还在本次会话的内存里） */
  canReparseInPlace: (paperId: string) => boolean;
  onCancel: (paperId: string) => void;
  onEnterMap: () => void;
  onOpenPaper: (paperId: string) => void;
  /** 刚刚导入的论文：默认选中它并给出醒目入口 */
  lastImportedId?: string | null;
  /** 切到「我上传的论文」/「案例」范围（列表与计数会一起跟着走） */
  onUseOwnScope: () => void;
  onUseCaseScope: () => void;
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
 * 方法提取：顶部**一条**全局流程，下面是「左侧论文列表 + 右侧当前论文详情」。
 * 每篇论文只在列表里占一行（名称 / 当前阶段 / 状态）；完整时间线与字段证据只显示当前选中的这一篇。
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
  onReparse,
  canReparseInPlace,
  onCancel,
  onEnterMap,
  onOpenPaper,
  lastImportedId,
  onUseOwnScope,
  onUseCaseScope,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [sel, setSel] = useState<string | null>(null);
  /** 用户手动选过哪一篇（导入后要自动跳到刚导入的那一篇） */
  const [touched, setTouched] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteTitle, setPasteTitle] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [draft, setDraft] = useState(config);

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
   * 无论哪种，**列表 / 页头计数 / 当前选中 / 抽取入口都取自同一个 `shown`**。
   */
  const listMode: 'case' | 'own' = scope.mode === 'own' || (casePapers.length === 0 && ownPapers.length > 0) ? 'own' : 'case';
  const shown = listMode === 'own' ? ownPapers : casePapers;
  /** 自传论文存在但当前看的是案例列表 → 必须给出醒目入口（不能静默藏着） */
  const hiddenOwn = listMode === 'case' && ownPapers.length > 0 ? ownPapers.length : 0;
  /** 待处理：还没生成方法结果的论文（与总数/完成数同一个集合） */
  const pendingCount = shown.filter((p) => p.parseStatus !== 'failed' && !methods.some((m) => m.paperId === p.id)).length;
  const hasMethod = (p: Paper) => methods.some((m) => m.paperId === p.id);
  const doneCount = shown.filter(hasMethod).length;
  const needModel = !modelReady && shown.some((p) => p.parseStatus === 'ok' && !hasMethod(p));

  /**
   * 默认选中「最需要注意」的那一篇：刚导入的 > 失败 > 进行中 > 未完成 > 第一篇。
   * 「刚导入」优先，是为了让用户上传完立刻看到自己那篇论文的抽取入口。
   */
  const autoSel =
    (lastImportedId && shown.some((p) => p.id === lastImportedId) ? lastImportedId : null) ??
    shown.find((p) => p.parseStatus === 'failed' || jobs[p.id]?.status === 'failed')?.id ??
    shown.find((p) => jobs[p.id]?.status === 'running')?.id ??
    shown.find((p) => p.parseStatus === 'ok' && !hasMethod(p))?.id ??
    shown[0]?.id ??
    null;
  // 用户没手动选过时，始终跟随 autoSel（这样导入后会自动跳到刚导入的那一篇）
  const currentId = (touched ? sel : null) ?? autoSel;
  const current = shown.find((p) => p.id === currentId);
  const currentMethod = current ? methods.find((m) => m.paperId === current.id) : undefined;
  const currentJob = current ? jobs[current.id] : undefined;
  const currentSteps = current ? stepsOf(current, currentMethod, currentJob, modelReady) : [];
  const failedStep = currentSteps.find((s) => s.state === 'failed');
  const verified = currentMethod ? verifiedOf(currentMethod) : 0;
  const withValue = currentMethod ? FIELD_KEYS_ORDER.filter((k) => currentMethod.fields[k]?.value).length : 0;
  const cur = currentSteps.find((s) => s.state === 'running') ?? currentSteps.find((s) => s.state === 'failed') ?? currentSteps.find((s) => s.state === 'waiting') ?? currentSteps[4];

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

  /** 方法短名：与论文集合 / 研究地图使用同一套派生规则 */
  const shortNameOf = (m: Method) => buildMethodProfile(m, papers.find((x) => x.id === m.paperId), papers).shortName;

  return (
    <div>
      <PageHead
        title="方法提取"
        sub="先看提取出了多少个方法，再看每篇论文的方法结果；处理时间线与字段证据都收在下面。"
        badges={
          <div className="resultsum">
            <strong>{methods.length ? `已提取 ${methods.length} 个方法` : '尚未提取方法'}</strong>
            <span className="sub">
              {methods.length
                ? `来自 ${new Set(methods.map((m) => m.paperId)).size} 篇论文；可以查看方法结果或进入研究地图。`
                : '选择 PDF 文件或粘贴论文正文即可开始；未配置模型时只有演示案例能离线出结果。'}
            </span>
          </div>
        }
        actions={
          <button className="btn primary" onClick={() => fileRef.current?.click()}>
            选择 PDF 文件
          </button>
        }
      />

      {/* 处理时间线：只作辅助状态，默认收起 */}
      <details className="fold stepline">
        <summary>处理时间线（上传论文 → 解析文本 → 提取方法字段 → 校验原文证据 → 进入研究地图）</summary>
        <div className="fold-body">
          <FlowBar steps={overview} />
        </div>
      </details>

      <div className="toolbar" style={{ borderBottom: 'none', paddingTop: 0 }}>
        <button className="btn ghost" onClick={() => setPasteOpen((v) => !v)}>
          粘贴论文正文
        </button>
        <button className="btn ghost" onClick={onEnterMap} disabled={!methods.length}>
          进入研究地图
        </button>
        <span className="spacer" />
        <span className="lab">等待模型不会显示成「分析完成」</span>
      </div>

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

      {pasteOpen && (
        <div className="quiet-group tint" style={{ marginTop: 0 }}>
          <label className="f">论文标题</label>
          <input className="f" value={pasteTitle} onChange={(e) => setPasteTitle(e.target.value)} placeholder="例如：Attention Is All You Need" />
          <label className="f" style={{ marginTop: 10 }}>
            论文正文（按页分隔存储，证据定位能力与 PDF 一致）
          </label>
          <textarea className="f" rows={5} value={pasteText} onChange={(e) => setPasteText(e.target.value)} />
          <div className="row" style={{ marginTop: 8 }}>
            <button
              className="btn primary sm"
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
            <span className="small dim">解析在本机完成；字段抽取需要模型接口</span>
          </div>
        </div>
      )}

      {needModel && (
        <div className="quiet-group tint" style={{ borderColor: 'var(--warn-line)', background: 'var(--warn-soft)' }}>
          <div className="row" style={{ gap: 8, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <Status kind="warn">第 03 步需要模型接口</Status>
            <span className="small">解析已经完成并保留；要继续到「提取方法字段」需要模型接口。密钥只保存在本机浏览器，不会写入任何产物。</span>
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
            <button className="btn primary sm" onClick={() => onSaveConfig(draft)}>
              保存并继续
            </button>
            <button className="btn sm" onClick={() => onTest(draft)} disabled={testing}>
              {testing ? '测试中…' : '测试连接'}
            </button>
            {testResult && <span className="small dim">{testResult}</span>}
          </div>
        </div>
      )}

      {/* 刚导入的论文：明确告诉用户「在哪里、被选中了、抽取入口在右边」 */}
      {lastImportedId &&
        (() => {
          const just = shown.find((p) => p.id === lastImportedId);
          if (!just) return null;
          const t = just.title.length > 52 ? just.title.slice(0, 52) + '…' : just.title;
          return (
            <div className="justbar" role="status">
              <Status kind="ok">刚刚导入</Status>
              <span className="small">
                已选中「<strong>{t}</strong>」，右侧就是它的处理进度与抽取入口。
              </span>
              {listMode === 'own' ? (
                <button className="btn ghost sm" onClick={onUseCaseScope}>
                  切回{scope.meta.label}
                </button>
              ) : null}
            </div>
          );
        })()}

      {/* 自传论文存在、但当前显示的是案例列表 → 醒目入口，绝不静默藏着（实测问题 1） */}
      {hiddenOwn > 0 && (
        <div className="ownentry" role="status">
          <div>
            <strong>你上传的 {hiddenOwn} 篇论文不在当前列表里</strong>
            <span className="small dim">（列表显示的是{scope.meta.label}的 {casePapers.length} 篇预置论文）</span>
          </div>
          <button className="btn primary sm" onClick={onUseOwnScope}>
            查看我上传的 {hiddenOwn} 篇论文 →
          </button>
        </div>
      )}

      {shown.length > 0 ? (
        <div className="work2">
          {/* 左：论文列表（只显示名称 / 当前阶段 / 状态） */}
          <div className="work2-list">
            <div className="secthead">
              <h3>论文列表（{shown.length}）</h3>
              <span className="sub">
                {listMode === 'own' ? '我上传的论文' : scope.meta.label} · 共 {shown.length} 篇 · 已完成 {doneCount} 篇
                {pendingCount ? ' · 待处理 ' + pendingCount + ' 篇' : ''}
              </span>
            </div>
            {shown.map((p) => {
              const m = methods.find((x) => x.paperId === p.id);
              const job = jobs[p.id];
              const steps = stepsOf(p, m, job, modelReady);
              const bad = steps.find((s) => s.state === 'failed');
              const c = steps.find((s) => s.state === 'running') ?? bad ?? steps.find((s) => s.state === 'waiting') ?? steps[4];
              const state = job?.status === 'running' ? 'running' : bad ? 'failed' : m ? 'done' : 'waiting';
              return (
                <button
                  key={p.id}
                  className={`pitem${p.id === currentId ? ' on' : ''}${p.id === lastImportedId ? ' just' : ''}`}
                  onClick={() => {
                    setSel(p.id);
                    setTouched(true);
                  }}
                  aria-current={p.id === currentId ? 'true' : undefined}
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
            })}
          </div>

          {/* 右：当前论文详情 */}
          <div className="work2-detail">
            {current ? (
              <>
                <div className="detail-head">
                  <h3>{current.title}</h3>
                  {/* PDF 首页排版多变，猜出来的标题必须标明「待确认」，不能当成已确认标题 */}
                  {titleNeedsConfirm(current) && (
                    <span className="titleflag" title="这个标题是从 PDF 首页猜出来的，还没有在原文里核验">
                      标题待确认
                    </span>
                  )}
                  {currentMethod && <span className="mname">{shortNameOf(currentMethod)}</span>}
                  <Status
                    kind={currentJob?.status === 'running' ? 'info' : currentMethod ? (currentMethod.cached ? 'cached' : 'live') : failedStep ? 'bad' : 'pending'}
                  >
                    {currentJob?.status === 'running' ? '进行中' : currentMethod ? '字段已生成' : failedStep ? '失败' : '等待中'}
                  </Status>
                </div>

                {currentMethod && (
                  <p className="detail-idea">
                    {shortContribution(effectiveFieldValue(currentMethod, 'coreIdea')) || '尚未提取到核心思路'}
                  </p>
                )}

                <details className="fold">
                  <summary>查看处理细节（当前阶段 · 已完成步骤 · 字段与证据数量）</summary>
                  <div className="fold-body">
                <dl className="kvlist">
                  <div>
                    <dt>当前阶段</dt>
                    <dd>
                      {cur.no} {cur.name}（{STATE_TEXT[cur.state]}）
                    </dd>
                  </div>
                  <div>
                    <dt>当前结果</dt>
                    <dd>{cur.result}</dd>
                  </div>
                  <div>
                    <dt>已完成步骤</dt>
                    <dd>
                      {currentSteps.filter((s) => s.state === 'done').length}/5 步（{currentSteps.filter((s) => s.state === 'done').map((s) => s.name).join('、') || '尚未开始'}）
                    </dd>
                  </div>
                  <div>
                    <dt>字段数量</dt>
                    <dd>{currentMethod ? `${withValue}/7 有值` : '尚未提取'}</dd>
                  </div>
                  <div>
                    <dt>证据数量</dt>
                    <dd>{currentMethod ? (verified > 0 ? `${verified}/7 已通过定位校验` : '未通过定位校验') : '暂无证据'}</dd>
                  </div>
                  <div>
                    <dt>下一步</dt>
                    <dd>
                      {current.parseStatus === 'failed'
                        ? '重新选择这份 PDF 重新解析（扫描件需要先做 OCR）'
                        : !currentMethod
                          ? modelReady
                            ? '开始提取方法字段'
                            : '配置模型后提取字段'
                          : '进入研究地图，或打开论文集合看字段证据'}
                    </dd>
                  </div>
                </dl>
                  </div>
                </details>

                <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                  {current.parseStatus === 'ok' && !currentMethod && (
                    <button className="btn primary sm" disabled={!!currentJob && currentJob.status === 'running'} onClick={() => onExtract(current.id, false)}>
                      {modelReady ? '开始提取字段' : '配置模型后提取'}
                    </button>
                  )}
                  {current.parseStatus === 'failed' && (
                    /* 这里必须是**真正重新解析 PDF**：不能拿模型抽取冒充解析重试（实测问题 2）。
                       浏览器不会长期保留用户选过的文件，所以必要时会请他重新选一次。 */
                    <button className="btn primary sm" onClick={() => onReparse(current.id)}>
                      {canReparseInPlace(current.id) ? '重新解析这份 PDF' : '重新选择 PDF 并重新解析'}
                    </button>
                  )}
                  {currentJob?.status === 'running' && (
                    <button className="btn sm" onClick={() => onCancel(current.id)}>
                      停止等待
                    </button>
                  )}
                  <button className="btn ghost sm" onClick={() => onOpenPaper(current.id)} disabled={!currentMethod}>
                    在论文集合里打开
                  </button>
                  <button className="btn ghost sm" onClick={onEnterMap} disabled={!methods.length}>
                    进入研究地图 →
                  </button>
                </div>

                {failedStep && (
                  <div className="confirmbar" style={{ background: 'var(--bad-soft)', borderColor: 'var(--bad-line)' }}>
                    <div className="t">
                      <strong>失败在哪一步：</strong>
                      {failedStep.no} {failedStep.name}
                      <br />
                      <strong>失败原因：</strong>
                      {failedStep.no === '02' ? current.parseError || '未能从该文件解析出文本层' : currentJob?.error || '模型调用未成功返回'}
                      <br />
                      <strong>如何重试：</strong>
                      {failedStep.no === '02'
                        ? '点上面的「重新选择 PDF 并重新解析」——它会真的重跑一次 PDF 解析（必要时请你重新选一次文件）；扫描件需要先做 OCR，系统不会返回空结果冒充成功。'
                        : '点上面的「开始提取字段」；也可以先在设置里检查接口地址、模型名与额度。换个 PDF 解析失败不是模型问题，不是在这里重试。'}
                      <br />
                      <strong>已完成的数据：</strong>
                      {current.parseStatus === 'ok'
                        ? '全文与页码解析结果保留，上一次的方法字段（如有）不会被覆盖。'
                        : '论文元数据（标题、页数、内容哈希）已保存，移除前一直保留。'}
                    </div>
                  </div>
                )}

                  <details className="fold">
                    <summary>查看处理过程与原文依据（处理时间线 · 字段 · 证据）</summary>
                    <div className="fold-body">
                {/* 完整时间线：只显示当前这一篇 */}
                <div className="secthead">
                  <h3>处理时间线</h3>
                  <span className="sub">每一步的真实状态与已得到的结果</span>
                </div>
                <div className="quiet-group" style={{ marginTop: 0, borderTop: 'none', paddingTop: 0 }}>
                  {currentSteps.map((s) => (
                    <div className="lnrow" key={s.no}>
                      <span className="no">{s.no}</span>
                      <span className="nm">{s.name}</span>
                      <span className={`stt ${s.state}`}>{STATE_TEXT[s.state]}</span>
                      <span className="res">
                        {s.result}
                        {s.next && <span className="dim"> · 下一步：{s.next}</span>}
                      </span>
                    </div>
                  ))}
                </div>

                {currentMethod && (
                  <>
                    <div className="secthead">
                      <h3>字段与证据</h3>
                      <span className="sub">首屏只显示 3 个关键字段，其余默认收起</span>
                    </div>
                    <div className="quiet-group" style={{ marginTop: 0, borderTop: 'none', paddingTop: 0 }}>
                      {FIELD_KEYS_ORDER.length > 0 && (
                        <details className="fold" style={{ marginTop: 10 }}>
                          <summary>查看字段与原文依据（共 {FIELD_KEYS_ORDER.length} 项）</summary>
                          <div className="fold-body">
                            {FIELD_KEYS_ORDER.map((k) => {
                              const f = currentMethod.fields[k];
                              return (
                                <div className="method-field-row" key={k}>
                                  <span className="nm">{METHOD_FIELD_LABELS[k]}</span>
                                  <span className={`stt ${f.evidence?.verified ? 'done' : f.status === 'missing' ? 'failed' : 'waiting'}`}>
                                    {FIELD_STATUS_TEXT[f.status]}
                                  </span>
                                  <span className="value">
                                    {f.value ? f.value.slice(0, 96) + (f.value.length > 96 ? '…' : '') : '未提取到'}
                                    {f.evidence
                                      ? f.evidence.verified
                                        ? ` · 引文已定位（p.${f.evidence.page ?? '?'}）`
                                        : ' · 引文未通过校验'
                                      : ' · 无引文'}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </details>
                      )}
                    </div>
                  </>
                )}
                    </div>
                  </details>
              </>
            ) : (
              <p className="small dim" style={{ margin: 0 }}>
                左侧选择一篇论文查看它的处理详情。
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="quiet-group tint">
          <p className="small dim" style={{ margin: 0 }}>
            还没有上传论文。选一个 PDF 或粘贴正文即可开始；解析失败会给出原因，不会静默返回空结果。
          </p>
        </div>
      )}

      {shown.length > 0 && (
        <p className="nextline">
          <button className="linkbtn" onClick={onEnterMap} disabled={!methods.length}>
            进入研究地图 →
          </button>
          <span className="small dim">（{shown.length} 篇论文 · 已完成字段提取 {doneCount} 篇）</span>
        </p>
      )}
    </div>
  );
}
