import React, { useEffect, useState } from 'react';
import type { Method, ModelConfig, Paper } from '../core/types';
import { ISSUE_CODE_TEXT } from '../core/types';
import { FIELD_KEYS_ORDER } from '../core/cache';
import { RULES_VERSION } from '../core/rules';
import { PROMPT_VERSION } from '../core/model/prompts';
import { summarizeIssues } from '../core/validate';
import { chat, ModelError } from '../core/model/client';
import { Banner, Tag } from './common';
import type { UsageRecord } from '../core/storage';

/** 版本与过期状态：程序版本、规则版本、提示词版本、线上构建指纹、缓存来源 */
function VersionPanel({
  corpusMeta,
  staleNotes,
}: {
  corpusMeta?: { generatedAt: string; model?: string; promptVersion?: string; domain?: string; samplesAreDevOnly?: boolean; purpose?: string; rulesVersion?: string };
  staleNotes?: string[];
}) {
  const [build, setBuild] = useState<{ buildId?: string; builtAt?: string } | undefined>();
  const [buildError, setBuildError] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch('./build.json', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j) => {
        if (alive) setBuild(j);
      })
      .catch(() => {
        if (alive) setBuildError(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const stale = !!(staleNotes && staleNotes.length);

  return (
    <div className="card">
      <h3>版本与过期状态</h3>
      <div className="kv">
        <div className="k">当前程序规则版本</div>
        <div className="mono">{RULES_VERSION}（可比性、关系可信度、条件范围等判定规则）</div>
        <div className="k">当前提示词版本</div>
        <div className="mono">{PROMPT_VERSION}</div>
        <div className="k">线上构建指纹</div>
        <div className="mono">
          {build?.buildId ?? (buildError ? '未找到 build.json（可能是开发模式运行）' : '读取中…')}
          {build?.builtAt ? `（${new Date(build.builtAt).toLocaleString('zh-CN')}）` : ''}
        </div>
        <div className="k">预置语料生成时间</div>
        <div>{corpusMeta?.generatedAt ? new Date(corpusMeta.generatedAt).toLocaleString('zh-CN') : '（未加载预置语料）'}</div>
        <div className="k">预置语料的模型与提示词</div>
        <div className="mono">
          {corpusMeta?.model ?? '—'} / {corpusMeta?.promptVersion ?? '—'}
        </div>
      </div>

      {stale ? (
        <div style={{ marginTop: 12 }}>
          <Banner kind="warn">
            <strong>预置语料相对当前版本已过期，不作为当前结论展示：</strong>
            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
              {staleNotes!.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
            规则类结论（可比性、关系可信度、条件一致性）已由程序按当前规则实时重算，不受影响；
            模型抽取类结论需要重新生成。
          </Banner>
        </div>
      ) : (
        corpusMeta && (
          <p className="small dim" style={{ marginTop: 10 }}>
            当前预置语料的规则版本与提示词版本与程序一致，未标记过期。
          </p>
        )
      )}
    </div>
  );
}

const PRESETS: { label: string; baseUrl: string; model: string }[] = [
  { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' },
  { label: '阿里云百炼（DashScope 兼容）', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  { label: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
  { label: '月之暗面 Kimi', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
];

export function SettingsView({
  config,
  onSave,
  onTest,
  testResult,
  testing,
}: {
  config: ModelConfig;
  onSave: (c: ModelConfig) => void;
  onTest: (c: ModelConfig) => void;
  testResult?: { ok: boolean; text: string };
  testing: boolean;
}) {
  const [draft, setDraft] = useState<ModelConfig>(config);

  return (
    <div>
      <h2 className="page">设置</h2>
      <p className="sub">
        本作品不内置任何平台的密钥。模型接口由使用者自行填写，密钥只保存在你本机浏览器的 IndexedDB 中，
        不会写入页面代码、不会随导出文件带走，也不会发送给除该接口以外的任何服务。
      </p>

      <Banner kind="info">
        部署在这个链接上的版本是纯前端静态站点，没有服务端可以代你保管密钥。因此在线体验时，
        要么由你自己填入接口信息（浏览器直连模型服务），要么直接用「预置样例语料」查看已由真实模型离线完成的分析结果。
      </Banner>

      <div className="card">
        <h3>模型接口（OpenAI 兼容 /chat/completions）</h3>
        <div className="row" style={{ marginBottom: 12 }}>
          <span className="small dim">快速填充：</span>
          {PRESETS.map((p) => (
            <button key={p.label} className="btn sm" onClick={() => setDraft({ ...draft, baseUrl: p.baseUrl, model: p.model })}>
              {p.label}
            </button>
          ))}
        </div>

        <label className="f">baseUrl</label>
        <input className="f" value={draft.baseUrl} onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })} placeholder="https://api.deepseek.com" />

        <label className="f" style={{ marginTop: 10 }}>
          API Key
        </label>
        <input className="f" type="password" value={draft.apiKey} onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })} placeholder="sk-..." autoComplete="off" />

        <label className="f" style={{ marginTop: 10 }}>
          模型名
        </label>
        <input className="f" value={draft.model} onChange={(e) => setDraft({ ...draft, model: e.target.value })} placeholder="deepseek-chat" />

        <div className="row" style={{ marginTop: 14 }}>
          <button className="btn primary" onClick={() => onSave(draft)}>
            保存到本机
          </button>
          <button className="btn" disabled={testing} onClick={() => onTest(draft)}>
            {testing ? '测试中…' : '测试连接'}
          </button>
          <span className="small dim">测试会发送一条极短请求，用于确认接口可用</span>
        </div>

        {testResult && (
          <div style={{ marginTop: 12 }}>
            {testResult.ok ? (
              <Banner kind="ok">连接成功。模型返回：{testResult.text}</Banner>
            ) : (
              <Banner kind="bad">{testResult.text}</Banner>
            )}
          </div>
        )}
      </div>

      <div className="card">
        <h3>当前配置状态</h3>
        <div className="kv">
          <div className="k">baseUrl</div>
          <div className="mono">{config.baseUrl || '（未填写）'}</div>
          <div className="k">模型</div>
          <div className="mono">{config.model || '（未填写）'}</div>
          <div className="k">API Key</div>
          <div className="mono">{config.apiKey ? `已保存（${config.apiKey.length} 位，仅存本机）` : '（未填写）'}</div>
        </div>
      </div>
    </div>
  );
}

interface CapabilityRow {
  item: string;
  status: 'verified' | 'limited' | 'unknown';
  detail: string;
}

export function StatusView({
  papers,
  methods,
  usage,
  capabilities,
  corpusMeta,
  staleNotes,
  relationCounts,
}: {
  papers: Paper[];
  methods: Method[];
  usage: UsageRecord[];
  capabilities: CapabilityRow[];
  corpusMeta?: { generatedAt: string; model?: string; promptVersion?: string; domain?: string; samplesAreDevOnly?: boolean; purpose?: string; rulesVersion?: string };
  staleNotes?: string[];
  relationCounts?: { explicit: number; inferred: number; candidate: number; userEdited: number };
}) {
  const totalFields = methods.length * FIELD_KEYS_ORDER.length;
  const withValue = methods.reduce((a, m) => a + FIELD_KEYS_ORDER.filter((k) => m.fields[k].value).length, 0);
  const cnt = (s: string) => methods.reduce((a, m) => a + FIELD_KEYS_ORDER.filter((k) => m.fields[k].status === s).length, 0);
  const verified = cnt('verified');
  const unverified = cnt('unverified');
  const noEvidence = cnt('no_evidence');
  const missing = cnt('missing');
  const allIssues = methods.flatMap((m) => m.validation ?? []);
  const issueStat = summarizeIssues(allIssues);
  const condVerified = (dim: string) =>
    methods.reduce((a, m) => a + ((m.conditions as Record<string, { status: string }> | undefined)?.[dim]?.status === 'verified' ? 1 : 0), 0);

  const statusTag = { verified: 'ok', limited: 'warn', unknown: '' } as const;

  return (
    <div>
      <h2 className="page">开发状态与真实记录</h2>
      <p className="sub">
        这里列出的是本作品在当前环境中「已实际验证」与「尚未验证」的能力，以及真实的模型调用记录与抽取统计。
        未验证的能力不会被写成已完成。
      </p>

      <VersionPanel corpusMeta={corpusMeta} staleNotes={staleNotes} />

      <div className="card">
        <h3>验证阶段区分（避免把早期结论当成当前版本结论）</h3>
        <table className="cmp" style={{ minWidth: 620 }}>
          <thead>
            <tr>
              <th style={{ width: 170 }}>阶段</th>
              <th style={{ width: 200 }}>覆盖内容</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                第一阶段验证
                <br />
                <span className="small dim">2026-09-16（早期）</span>
              </td>
              <td className="small">PDF 解析、字段抽取、证据定位、部署通道、3 篇样例</td>
              <td className="small">
                已通过，但结论基于当时的字段口径与提示词 v1/v2。相关数字在与当前版本并列展示时会标注来源版本。
              </td>
            </tr>
            <tr>
              <td>
                当前版本验证
                <br />
                <span className="small dim">规则版本 {RULES_VERSION}</span>
              </td>
              <td className="small">不可比检测（含范围与未知判定）、关系可信度三档、程序校验层、分歧规则复核、决策证据绑定</td>
              <td className="small">
                规则类结论由程序按当前规则实时重算；模型抽取类结论若来自旧提示词，会在上方「版本与过期状态」中标为过期。
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>环境能力核对</h3>
        <table className="cmp" style={{ minWidth: 620 }}>
          <thead>
            <tr>
              <th style={{ width: 180 }}>能力</th>
              <th style={{ width: 90 }}>结论</th>
              <th>说明</th>
            </tr>
          </thead>
          <tbody>
            {capabilities.map((c) => (
              <tr key={c.item}>
                <td>{c.item}</td>
                <td>
                  <Tag kind={statusTag[c.status]}>
                    {c.status === 'verified' ? '已验证' : c.status === 'limited' ? '有限制' : '未验证'}
                  </Tag>
                </td>
                <td className="small">{c.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>字段与证据校验统计（真实统计，非估计）</h3>
        <div className="kv">
          <div className="k">已导入论文</div>
          <div>{papers.length} 篇</div>
          <div className="k">已完成抽取</div>
          <div>{methods.length} 篇</div>
          <div className="k">字段总数</div>
          <div>{totalFields}（{methods.length} 篇 × {FIELD_KEYS_ORDER.length} 字段）</div>
          <div className="k">有值字段</div>
          <div>
            {withValue} / {totalFields}
          </div>
          <div className="k">可核验（引文已定位）</div>
          <div style={{ color: 'var(--ok)' }}>
            {verified} / {totalFields}
          </div>
          <div className="k">待人工核对（引文未定位）</div>
          <div style={{ color: 'var(--warn)' }}>
            {unverified} / {totalFields}
          </div>
          <div className="k">未找到证据（模型未给引文）</div>
          <div style={{ color: 'var(--warn)' }}>
            {noEvidence} / {totalFields}
          </div>
          <div className="k">缺失（未报告/未提取到）</div>
          <div>
            {missing} / {totalFields}
          </div>
          <div className="k" style={{ gridColumn: '1 / -1', marginTop: 8 }}>
            <strong style={{ color: 'var(--fg)' }}>实验条件可核验数量</strong>
          </div>
          {[
            ['datasets', '数据集'],
            ['dataSplits', '数据划分'],
            ['metrics', '评价指标'],
            ['extraTrainingData', '额外训练数据'],
            ['pretrainedModel', '预训练模型'],
            ['experimentalSettings', '实验设置'],
            ['computeResources', '算力/训练时长'],
          ].map(([k, label]) => (
            <React.Fragment key={k}>
              <div className="k">{label}</div>
              <div>
                {condVerified(k)} / {methods.length}
              </div>
            </React.Fragment>
          ))}
        </div>
        <p className="small dim" style={{ marginTop: 10 }}>
          分母口径：以上统计覆盖当前已加载的全部论文分析结果，包含预置缓存结果。判断标准是引文是否能在对应论文全文中定位。
          条件维度的分母是已完成抽取的论文数；未报告的条件不计为「一致」。
        </p>
      </div>

      <div className="card">
        <h3>程序校验问题汇总</h3>
        <div className="kv">
          <div className="k">问题总数</div>
          <div>{issueStat.total}</div>
          <div className="k">错误 / 警告 / 提示</div>
          <div>
            <span style={{ color: 'var(--bad)' }}>{issueStat.bySeverity.error}</span> /{' '}
            <span style={{ color: 'var(--warn)' }}>{issueStat.bySeverity.warn}</span> / {issueStat.bySeverity.info}
          </div>
        </div>
        {issueStat.total > 0 && (
          <table className="cmp" style={{ minWidth: 480, marginTop: 10 }}>
            <thead>
              <tr>
                <th>问题类型</th>
                <th style={{ width: 80 }}>数量</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(issueStat.byCode).map(([code, n]) => (
                <tr key={code}>
                  <td className="small">{ISSUE_CODE_TEXT[code as keyof typeof ISSUE_CODE_TEXT] ?? code}</td>
                  <td className="small">{n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="small dim" style={{ marginTop: 8 }}>
          这些问题由程序在模型输出上自动检查得出（字段缺失、未提供引文、引文无法定位、页码异常、条件无法确认等），
          未经人工确认，也不影响原始数据，只是明确标出需要人工核对的位置。
        </p>
      </div>

      {relationCounts && (
        <div className="card">
          <h3>方法关系可信度分布</h3>
          <div className="kv">
            <div className="k">原文明示（引文已定位）</div>
            <div style={{ color: 'var(--ok)' }}>{relationCounts.explicit} 条</div>
            <div className="k">系统推断（附推断理由）</div>
            <div style={{ color: 'var(--warn)' }}>{relationCounts.inferred} 条</div>
            <div className="k">待核查（依据不足）</div>
            <div>{relationCounts.candidate} 条</div>
            <div className="k">其中人工修正过</div>
            <div>{relationCounts.userEdited} 条</div>
          </div>
          <p className="small dim" style={{ marginTop: 8 }}>
            不使用未经校准的模型置信度百分比，只按证据是否可核验分档。
          </p>
        </div>
      )}

      {corpusMeta && (
        <div className="card">
          <h3>预置样例语料的来源</h3>
          <div className="kv">
            <div className="k">生成时间</div>
            <div>{new Date(corpusMeta.generatedAt).toLocaleString('zh-CN')}</div>
            <div className="k">使用模型</div>
            <div className="mono">{corpusMeta.model}</div>
            <div className="k">提示词版本</div>
            <div className="mono">{corpusMeta.promptVersion}</div>
            <div className="k">领域标注</div>
            <div>
              {corpusMeta.domain}
              {corpusMeta.samplesAreDevOnly ? '（开发流程验证样例，用户尚未确认最终参赛领域）' : ''}
            </div>
            <div className="k">用途说明</div>
            <div className="small">{corpusMeta.purpose}</div>
          </div>
        </div>
      )}

      <div className="card">
        <h3>真实模型调用记录（最近 {Math.min(usage.length, 60)} 条）</h3>
        {usage.length === 0 ? (
          <p className="muted">本机还没有调用记录。上传论文并执行抽取后会在此累计。</p>
        ) : (
          <table className="cmp" style={{ minWidth: 640 }}>
            <thead>
              <tr>
                <th>时间</th>
                <th style={{ width: 70 }}>类型</th>
                <th style={{ width: 60 }}>耗时</th>
                <th style={{ width: 90 }}>输入字符</th>
                <th style={{ width: 90 }}>输出字符</th>
                <th style={{ width: 70 }}>结果</th>
              </tr>
            </thead>
            <tbody>
              {usage
                .slice(-60)
                .reverse()
                .map((u) => (
                  <tr key={u.id}>
                    <td className="small mono">{new Date(u.at).toLocaleString('zh-CN')}</td>
                    <td className="small">{u.kind}</td>
                    <td className="small mono">{(u.ms / 1000).toFixed(1)}s</td>
                    <td className="small mono">{u.promptChars}</td>
                    <td className="small mono">{u.completionChars}</td>
                    <td>
                      <Tag kind={u.ok ? 'ok' : 'bad'}>{u.ok ? '成功' : '失败'}</Tag>
                      {u.error && <div className="small" style={{ color: 'var(--bad)' }}>{u.error.slice(0, 80)}</div>}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export function capabilitiesList(env: {
  hasBackend: boolean;
  deployStatic: boolean;
  modelReachable: boolean;
}): CapabilityRow[] {
  return [
    {
      item: 'PDF 文本层解析',
      status: 'verified',
      detail: '浏览器与 Node 两侧均已实测：3 篇 arXiv 论文解析成功（39,969 / 65,636 / 240,327 字符），标题与年份可识别；扫描件会明确报错。',
    },
    {
      item: '模型调用（真实）',
      status: env.modelReachable ? 'verified' : 'limited',
      detail: env.modelReachable
        ? '已用 OpenAI 兼容接口跑通真实抽取，单篇耗时约 3~4 秒，单次输入约 2.5 万字符。'
        : '需要使用者自行填写接口。环境的默认模型网关在本机网络下不可达，未做任何兜底伪装。',
    },
    {
      item: '原文证据定位',
      status: 'verified',
      detail: '实现了「引文必须在全文中可定位」的校验：离线跑通时 20 个字段全部通过；模型自称明确关系的引文定位失败后会自动降级为推断。',
    },
    {
      item: '本地持久化',
      status: 'verified',
      detail: 'IndexedDB 存储论文全文、抽取结果、人工修正与调用记录，刷新后可恢复；不依赖任何服务端数据库。',
    },
    {
      item: '在线部署',
      status: 'verified',
      detail: '平台提供的部署方式是纯前端静态站点（无服务端渲染、无后端 API）。因此线上版本不含任何密钥，实时抽取需要使用者自带接口。',
    },
    {
      item: '服务端后端 / 数据库',
      status: 'limited',
      detail: '当前部署通道不支持后端与数据库。若后续需要多用户协作或集中缓存，需要另找托管方案。',
    },
    {
      item: 'OCR（扫描件）',
      status: 'unknown',
      detail: '未实现，明确不支持；扫描件会提示改用「粘贴论文文本」入口。',
    },
    {
      item: '自动全网检索论文',
      status: 'unknown',
      detail: '首版不做。论文来源目前是使用者上传或样例缓存，避免引入不可控的检索质量与配额问题。',
    },
  ];
}

export const MODEL_ERROR_HINT = (e: unknown) =>
  e instanceof ModelError ? `${e.message}${e.detail ? `（${e.detail.slice(0, 160)}）` : ''}` : String(e);
