import React, { useRef, useState } from 'react';
import type { Method, Paper } from '../core/types';
import type { JobState } from './Library';
import { Status } from './common';

interface Props {
  papers: Paper[];
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
  onCancel: (paperId: string) => void;
  onEnterMap: () => void;
  onOpenPaper: (paperId: string) => void;
}

/**
 * 上传自己的论文：解析 → （需要时）就地配置模型 → 抽取 → 进入同一个研究地图工作区。
 * 只上传 1 篇时给单篇理解结果，并明确提示「加更多论文才能得到跨论文关系」，不编造关系。
 */
export function UploadFlowView({
  papers,
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
  onCancel,
  onEnterMap,
  onOpenPaper,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteTitle, setPasteTitle] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [draft, setDraft] = useState(config);

  const ownPapers = papers.filter((p) => (p.corpusId ?? 'user-import') === 'user-import');
  const shown = ownPapers.length ? ownPapers : papers.slice(-3);
  const needModel = !modelReady && shown.some((p) => p.parseStatus === 'ok' && !methods.some((m) => m.paperId === p.id));

  return (
    <div>
      <h2 className="page">上传我的论文</h2>
      <p className="lead">
        支持带文本层的 PDF（单文件不超过 120 页）；也可以直接粘贴论文正文。解析在本地浏览器完成，抽取需要模型接口。
      </p>

      <div className="card">
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <button className="btn primary" onClick={() => fileRef.current?.click()}>
            选择 PDF 文件
          </button>
          <button className="btn" onClick={() => setPasteOpen((v) => !v)}>
            粘贴论文正文
          </button>
          {papers.length > 0 && (
            <button className="btn ghost" onClick={onEnterMap}>
              进入研究地图
            </button>
          )}
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
          <div style={{ marginTop: 14, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
            <label className="f">论文标题</label>
            <input className="f" value={pasteTitle} onChange={(e) => setPasteTitle(e.target.value)} placeholder="例如：Attention Is All You Need" />
            <label className="f" style={{ marginTop: 10 }}>
              论文正文（按页分隔存储，证据定位能力与 PDF 一致）
            </label>
            <textarea className="f" rows={6} value={pasteText} onChange={(e) => setPasteText(e.target.value)} />
            <button
              className="btn primary sm"
              style={{ marginTop: 8 }}
              disabled={!pasteTitle.trim() || pasteText.trim().length < 200}
              onClick={() => {
                onPaste(pasteTitle.trim(), pasteText.trim());
                setPasteTitle('');
                setPasteText('');
                setPasteOpen(false);
              }}
            >
              解析这段正文
            </button>
          </div>
        )}
      </div>

      {needModel && (
        <div className="card" style={{ borderColor: 'var(--warn-line)', background: 'var(--warn-soft)' }}>
          <div className="row" style={{ gap: 8, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <Status kind="warn">需要模型接口</Status>
            <span className="small">
              解析已完成，但要抽取出方法字段需要模型接口。可以就地填写（密钥只保存在本机浏览器，不会写入任何产物）。
            </span>
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

      {shown.length > 0 && (
        <>
          <h3 style={{ margin: '20px 0 10px' }}>处理进度</h3>
          {shown.map((p) => {
            const m = methods.find((x) => x.paperId === p.id);
            const job = jobs[p.id];
            return (
              <div className="paper" key={p.id}>
                <div className="paper-head">
                  <div className="meta">
                    <div className="paper-title">{p.title}</div>
                    <div className="paper-sub">
                      <span>{p.pageCount ?? '?'} 页</span>
                      <span>{p.charCount ?? '?'} 字符</span>
                      {p.parseStatus === 'failed' && <span style={{ color: 'var(--bad)' }}>解析失败：{p.parseError}</span>}
                    </div>
                    <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                      <Status kind={p.parseStatus === 'ok' ? 'ok' : 'bad'}>{p.parseStatus === 'ok' ? '解析完成' : '解析失败'}</Status>
                      {job?.status === 'running' && <Status kind="info">正在分析（{job.message}）</Status>}
                      {job?.status === 'canceled' && <Status kind="pending">已停止等待（本次调用未完成）</Status>}
                      {job?.error && <Status kind="bad">分析失败</Status>}
                      {m && <Status kind="ok">方法字段已生成</Status>}
                      {m && <Status kind="manual">{m.cached ? '缓存案例' : '实时分析'}</Status>}
                    </div>
                    {job?.error && (
                      <p className="small" style={{ color: 'var(--bad)', margin: '8px 0 0' }}>
                        {job.error}
                      </p>
                    )}
                  </div>
                  <div className="row" style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    {p.parseStatus === 'ok' && !m && (
                      <button className="btn primary sm" disabled={!!job && job.status === 'running'} onClick={() => onExtract(p.id, false)}>
                        {modelReady ? '分析方法字段' : '配置模型后分析'}
                      </button>
                    )}
                    {p.parseStatus === 'failed' && (
                      <button className="btn sm" onClick={() => onExtract(p.id, true)}>
                        重试解析
                      </button>
                    )}
                    {job?.status === 'running' && (
                      <button className="btn sm" onClick={() => onCancel(p.id)}>
                        停止等待
                      </button>
                    )}
                    {m && (
                      <button className="btn sm" onClick={() => onOpenPaper(p.id)}>
                        看单篇理解
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          <div className="next">
            <div className="t">
              <b>
                {papers.length === 1
                  ? '目前只有 1 篇论文：可以看单篇理解，但跨论文的关系与阅读路线需要至少 2 篇'
                  : `已有 ${papers.length} 篇论文：可以进入研究地图`}
              </b>
              <span>
                {papers.length === 1
                  ? '再加 1 篇同方向的论文，就能得到方法关系与阅读顺序；系统不会为单篇论文编造跨论文关系。'
                  : '研究地图里可以看方法分组、方法之间的真实关系，以及你的阅读顺序。'}
              </span>
            </div>
            <button className="btn primary" onClick={onEnterMap} disabled={papers.length === 0}>
              进入研究地图
            </button>
          </div>
        </>
      )}

      {shown.length === 0 && (
        <p className="small dim">还没有上传论文。选一个 PDF 或粘贴正文即可开始；解析失败会给出原因，不会静默返回空结果。</p>
      )}
    </div>
  );
}
