import React, { useState } from 'react';
import type { Evidence, FieldKey, Method, MethodFieldResult, Paper } from '../core/types';
import { FIELD_STATUS_TEXT, METHOD_FIELD_LABELS } from '../core/types';
import { contextAround } from '../core/text';

export function Tag({ kind = '', children }: { kind?: string; children: React.ReactNode }) {
  return <span className={`tag ${kind}`}>{children}</span>;
}

export function Banner({
  kind = 'info',
  icon,
  children,
}: {
  kind?: 'info' | 'warn' | 'bad' | 'ok';
  icon?: string;
  children: React.ReactNode;
}) {
  const ico = icon ?? { info: 'ℹ', warn: '⚠', bad: '⛔', ok: '✓' }[kind];
  return (
    <div className={`banner ${kind}`}>
      <span className="ico">{ico}</span>
      <div>{children}</div>
    </div>
  );
}

/** 证据弹层：展示页码、匹配方式、原文上下文 */
export function EvidencePopover({
  evidence,
  paper,
  fieldLabel,
  onClose,
}: {
  evidence: Evidence;
  paper?: Paper;
  fieldLabel: string;
  onClose: () => void;
}) {
  const hasText = !!paper?.rawText;
  const canShowSpan = hasText && evidence.start !== undefined && evidence.end !== undefined;
  const ctx = canShowSpan ? contextAround(paper!.rawText, evidence.start!, evidence.end!) : undefined;

  return (
    <div className="ev-pop" onClick={onClose}>
      <div className="ev-box" onClick={(e) => e.stopPropagation()}>
        <header>
          <strong>{fieldLabel} · 原文证据</strong>
          {evidence.verified ? (
            <Tag kind="ok">已通过全文定位校验</Tag>
          ) : (
            <Tag kind="bad">未通过校验</Tag>
          )}
          {evidence.page !== undefined && <Tag>p.{evidence.page}</Tag>}
          {evidence.section && <Tag>{evidence.section}</Tag>}
          <span className="spacer" />
          <button className="btn ghost" onClick={onClose}>
            关闭
          </button>
        </header>
        <div className="body">
          <div className="ev-meta">
            <span>论文：{paper?.title || evidence.paperId}</span>
            <span>
              定位方式：
              {evidence.verified
                ? evidence.matchType === 'loose'
                  ? '忽略标点/连字符后定位'
                  : '原文精确匹配'
                : evidence.matchType === 'partial'
                  ? '仅前段可定位'
                  : '未能定位'}
            </span>
            {evidence.verified && evidence.start !== undefined && (
              <span className="mono">
                偏移 {evidence.start}–{evidence.end}
              </span>
            )}
          </div>

          {evidence.verified && ctx ? (
            <>
              <div className="ev-context">
                …{ctx.before}
                <mark>{ctx.quote}</mark>
                {ctx.after}…
              </div>
              <p className="small dim" style={{ marginTop: 12 }}>
                上下文取自该论文解析后的第 {evidence.page} 页附近文本（前后各约 420 字符）。
              </p>
            </>
          ) : (
            <>
              <Banner kind="warn">
                {evidence.verifyNote || '该引文未能定位到论文原文。'}
                <br />
                系统不会把无法定位的引文当作有效证据展示，也不显示伪造的页码。
              </Banner>
              {evidence.quote && (
                <div className="ev-quote" style={{ borderLeftColor: 'var(--bad)' }}>
                  <div className="small dim" style={{ marginBottom: 4 }}>
                    模型给出的引文（未通过校验，仅作对照）
                  </div>
                  {evidence.quote}
                </div>
              )}
              {ctx && (
                <>
                  <p className="small dim" style={{ margin: '14px 0 6px' }}>
                    实际匹配到的原文位置（说明模型引文的哪一部分是真的）：
                  </p>
                  <div className="ev-context">
                    …{ctx.before}
                    <mark style={{ background: 'rgba(224,162,60,.22)' }}>{ctx.quote}</mark>
                    {ctx.after}…
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const FIELD_STATUS_TAG: Record<MethodFieldResult['status'], { kind: string; text: string }> = {
  verified: { kind: 'ok', text: FIELD_STATUS_TEXT.verified },
  unverified: { kind: 'warn', text: FIELD_STATUS_TEXT.unverified },
  no_evidence: { kind: 'warn', text: FIELD_STATUS_TEXT.no_evidence },
  missing: { kind: 'bad', text: FIELD_STATUS_TEXT.missing },
};

export function FieldCard({
  field,
  result,
  paper,
  override,
  onOverride,
  onOpenEvidence,
}: {
  field: FieldKey;
  result: MethodFieldResult;
  paper?: Paper;
  override?: { newValue: string; at: number };
  onOverride: (field: FieldKey, value: string) => void;
  onOpenEvidence: (e: Evidence, label: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const tag = FIELD_STATUS_TAG[result.status];
  const label = METHOD_FIELD_LABELS[field];

  return (
    <div className="field">
      <div className="field-head">
        <span className="field-name">{label}</span>
        <Tag kind={tag.kind}>{tag.text}</Tag>
        {override && <Tag kind="info">已人工修正</Tag>}
        <span className="spacer" />
        <button
          className="btn ghost sm"
          onClick={() => {
            setDraft(override?.newValue ?? result.value ?? '');
            setEditing((v) => !v);
          }}
        >
          {editing ? '取消' : '修正'}
        </button>
      </div>

      {editing ? (
        <div>
          <textarea
            className="f"
            rows={3}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="填写你核对后的内容；留空表示标记为该字段无可靠信息"
          />
          <div className="row" style={{ marginTop: 6 }}>
            <button
              className="btn primary sm"
              onClick={() => {
                onOverride(field, draft.trim());
                setEditing(false);
              }}
            >
              保存修正
            </button>
            <span className="small dim">原 AI 结果会保留在修正记录中</span>
          </div>
        </div>
      ) : override ? (
        <>
          <div className="field-value">{override.newValue || '（用户标记为无可靠信息）'}</div>
          {result.value && (
            <div className="field-note">
              AI 原值：<span className="dim">{result.value}</span>
            </div>
          )}
        </>
      ) : (
        <div className={`field-value ${!result.value ? 'none' : ''}`}>
          {result.value || (result.note?.includes('论文未报告') ? '论文未报告' : '未提取到')}
        </div>
      )}

      {!editing && result.note && result.status !== 'verified' && <div className="field-note">{result.note}</div>}

      {!editing && result.evidence &&
        (result.evidence.verified ? (
          <button className="ev-btn" onClick={() => onOpenEvidence(result.evidence!, label)}>
            查看原文证据 · p.{result.evidence.page ?? '?'}
          </button>
        ) : (
          <button className="ev-btn bad" onClick={() => onOpenEvidence(result.evidence!, label)}>
            {result.status === 'unverified' ? '引文未通过校验 · 查看说明' : '查看对照'}
          </button>
        ))}

      {!editing && !result.evidence && result.value && (
        <div className="field-note" style={{ color: 'var(--warn)' }}>
          未找到证据：模型未提供原文引文，该值不作为可核验结论。
        </div>
      )}
    </div>
  );
}

/** 生成并触发浏览器下载 */
export function downloadText(filename: string, content: string, mime = 'text/plain') {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * 状态徽标：颜色 + 圆点 + 文字，三重表达（不依赖颜色单独传达状态）。
 * kind 对应设计令牌里的状态语义：ok / warn / bad / info / cached / live / stale / pending
 */
export function Status({ kind = 'info', children }: { kind?: string; children: React.ReactNode }) {
  return (
    <span className={`status ${kind}`}>
      <span className="dot" aria-hidden="true" />
      {children}
    </span>
  );
}

/**
 * 页面间「下一步」提示：一个明确的主按钮 + 一个次要返回入口，避免同屏多个同优先级按钮。
 */
export function NextStep({
  title,
  desc,
  actionLabel,
  onAction,
  secondary,
}: {
  title: string;
  desc: string;
  actionLabel: string;
  onAction: () => void;
  secondary?: { label: string; onAction: () => void };
}) {
  return (
    <div className="next">
      <div className="t">
        <b>下一步：{title}</b>
        <span>{desc}</span>
      </div>
      <button className="btn primary sm" onClick={onAction}>
        {actionLabel}
      </button>
      {secondary && (
        <button className="btn ghost sm" onClick={secondary.onAction}>
          {secondary.label}
        </button>
      )}
    </div>
  );
}

/**
 * 状态图例：说明本项目用到的状态含义（评审/新用户可据此理解色块）。
 */
export function StatusLegend() {
  return (
    <div className="legend">
      <span className="k">
        <Status kind="live">实时分析</Status>本次调用模型生成
      </span>
      <span className="k">
        <Status kind="cached">缓存案例</Status>离线真实模型生成、界面标明来源
      </span>
      <span className="k">
        <Status kind="manual">人工修正</Status>用户改写过的字段
      </span>
      <span className="k">
        <Status kind="ok">已核验</Status>证据与范围都满足要求
      </span>
      <span className="k">
        <Status kind="pending">待核查</Status>依据不足或版面行列未确认，不作为结论
      </span>
      <span className="k">
        <Status kind="insufficient">信息不足</Status>条件取值未知，无法直接比较
      </span>
      <span className="k">
        <Status kind="stale">已过期</Status>规则或提示词已变更，需重算
      </span>
    </div>
  );
}
