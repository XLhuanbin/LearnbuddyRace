import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Evidence, Method, MethodAssessmentItem, MethodFieldResult, Paper } from '../core/types';
import { METHOD_FIELD_LABELS, FIELD_STATUS_TEXT } from '../core/types';
import { FIELD_KEYS_ORDER } from '../core/cache';
import { buildMethodProfile } from '../core/grouping';
import { DraftIcon } from '../draft-icons';
import { verifiedOf } from './Library';

interface Props {
  /** 当前查看的论文 */
  paper: Paper;
  /** 这篇论文的分析结果（未分析时为 undefined） */
  method?: Method;
  papers: Paper[];
  methods: Method[];
  /** 返回论文集合 */
  onBack: () => void;
  /** 进入研究地图（把这篇放到领域脉络里） */
  onGoMap: () => void;
  /** 打开与另一篇的对照 */
  onGoCompare: () => void;
  /** 去上传页继续分析其他论文 */
  onGoUpload: () => void;
  onOpenEvidence?: (ev: Evidence) => void;
}

/**
 * 分析结果页 —— **外观按 Superdesign 草稿 f3570956「分析结果页」逐元素严格复刻**
 *
 * 结构（与草稿一一对应，不改动外观组件）：
 *   sticky 子头（标题 + 分析时间 + 三个操作按钮）
 *   → main 12 栅格 9/3
 *     → 左：三张指标卡 / 结构化方法论大纲（可展开）/ 优化与改进建议（两张卡）/ 原文重点摘录（blockquote + PAGE 徽标）
 *     → 右：sticky 侧栏（内容导航 / 查看研究地图 CTA / 相似方法论）
 *   → 页脚
 *
 * **只替换了与事实不符的内容**（草稿里大量数值是编造的，一律换成真实来源）：
 *   - 「创新度评分 8.4/10」→ **已核验字段 X / 7**（我们不做评分与排名）
 *   - 「方法复杂度 高」    → **实验记录 N 条**（本篇真实提取到的实验记录数）
 *   - 「领域相关性 92%」   → **原文依据覆盖 X%**（已定位引文 / 全部引文）
 *   - 大纲内容 → 真实的 7 个方法字段（每条带引文页码与核验状态）
 *   - 「复现要点 / 改进方向」→ 真实的「输入·训练条件 / 局限」字段（都能引到原文）
 *   - 重点摘录 → 真实的已核验引文（PAGE 徽标 = 引文真实页码）
 *   - 相似方法论 → 同一方法族的其它论文（真实家族判定）
 *   - 三个操作按钮 → 复制结论 / 导出结果 / 加入比较（都是真能用的功能，不是占位）
 *
 * **为兼容不得不偏离草稿之处（逐处注明）**：
 *   1. 草稿自带 fixed 顶栏（含当前文件名），本项目全站共用一套 sticky 顶栏（`AppBrandBar`），
 *      若再渲染一遍会出现两个顶栏 ⇒ **不渲染草稿顶栏**；它原本承载的「当前是哪篇论文」
 *      改由子头的第二行显示（否则用户不知道在看哪篇），这是必要的兼容补充。
 *   2. 因此子头不照抄草稿的 `mt-[72px]`（草稿是为了让开 fixed 顶栏；我们的顶栏在文档流里），
 *      sticky 偏移用 `top-[var(--topbar-h)]` 贴在全站顶栏下方。
 */
export function ResultPageView({
  paper,
  method,
  papers,
  methods,
  onBack,
  onGoMap,
  onGoCompare,
  onGoUpload,
  onOpenEvidence,
}: Props) {
  const [openKeys, setOpenKeys] = useState<Set<string>>(new Set(['coreIdea']));
  const [activeNav, setActiveNav] = useState('overview');
  const [copied, setCopied] = useState(false);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  const totalFields = FIELD_KEYS_ORDER.length;

  /** 真实统计（全部来自库里已存的分析结果，不现算、不编造） */
  const stats = useMemo(() => {
    if (!method) return { verified: 0, total: totalFields, expCount: 0, evTotal: 0, evVerified: 0, coverage: 0 };
    const verified = verifiedOf(method);
    const evs: Evidence[] = [];
    for (const k of FIELD_KEYS_ORDER) {
      const e = method.fields[k]?.evidence;
      if (e) evs.push(e);
    }
    const evVerified = evs.filter((e) => e.verified).length;
    return {
      verified,
      total: totalFields,
      expCount: method.experiments?.length ?? 0,
      evTotal: evs.length,
      evVerified,
      coverage: evs.length ? Math.round((evVerified / evs.length) * 100) : 0,
    };
  }, [method, totalFields]);

  /**
   * 草稿的三项评估指标（创新度 / 复杂度 / 领域相关性）。
   *
   * ⚠️ 这三个数是**模型评估**，不是论文里写的数字 —— 论文不会写「我的创新度是 8.4」。
   * 所以每张卡都写明「模型评估」，并把依据是否已在原文定位如实说出来；
   * 没有评估结果时显示「—」，不补数、不冒充。
   */
  const assessment = method?.assessment;
  const innovation = assessment?.innovation;
  const complexity = assessment?.complexity;
  const relevance = assessment?.relevance;
  /** 复杂度四段条：低=1 段、中=2 段、高=3 段（与草稿「高」填 3 段一致） */
  const complexityFilled =
    complexity?.value === '高' ? 3 : complexity?.value === '中' ? 2 : complexity?.value === '低' ? 1 : 0;
  /** 依据是否真在原文里定位到了（没定位就不宣称有依据） */
  const basisOf = (item?: MethodAssessmentItem) =>
    !item
      ? '本篇还没有这项评估（重新分析后会生成）。'
      : item.evidence?.verified
        ? `依据已回到原文定位（p.${item.evidence.page ?? '?'}）。`
        : '模型未给出可定位的原文依据，请当作参考，不要当结论。';

  /** 大纲 = 真实的 7 个方法字段 */
  const outline = useMemo(
    () =>
      FIELD_KEYS_ORDER.map((k, i) => ({
        key: k,
        no: `${i + 1}.`,
        title: `${i + 1}. ${METHOD_FIELD_LABELS[k]}`,
        field: method?.fields[k] as MethodFieldResult | undefined,
      })),
    [method],
  );

  /** 相似方法论 = 同一方法族的其它论文（家族判定来自 grouping.ts，不新造判断） */
  const similar = useMemo(() => {
    if (!method) return [];
    const myFamily = buildMethodProfile(method, paper, papers).family.id;
    return methods
      .filter((m) => m.paperId !== paper.id)
      .map((m) => {
        const p = papers.find((x) => x.id === m.paperId);
        return { id: m.id, paper: p, profile: buildMethodProfile(m, p, papers) };
      })
      .filter((x) => x.profile.family.id === myFamily && x.profile.family.id !== 'pending')
      .slice(0, 3);
  }, [method, methods, papers, paper]);

  /** 重点摘录 = 已核验的引文（页码是程序定位出来的真实页码） */
  const quotes = useMemo(() => {
    if (!method) return [];
    const out: { ev: Evidence; label: string }[] = [];
    for (const k of FIELD_KEYS_ORDER) {
      const f = method.fields[k];
      if (f?.evidence?.verified && f.evidence.quote) {
        out.push({ ev: f.evidence, label: METHOD_FIELD_LABELS[k] });
      }
    }
    return out.slice(0, 4);
  }, [method]);

  /** 草稿用 JS 做滚动高亮；这里等价实现（只做高亮，不改结构） */
  useEffect(() => {
    const onScroll = () => {
      let current = 'overview';
      for (const id of ['overview', 'outline', 'suggestions', 'references']) {
        const el = sectionRefs.current[id];
        if (el && window.scrollY >= el.offsetTop - 200) current = id;
      }
      setActiveNav(current);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const scrollTo = (id: string) => {
    const el = sectionRefs.current[id];
    if (el) window.scrollTo({ top: el.offsetTop - 150, behavior: 'smooth' });
  };

  const navItem = (id: string, text: string) => (
    <a
      key={id}
      href={`#${id}`}
      className={activeNav === id ? 'nav-active' : 'nav-inactive'}
      onClick={(e) => {
        e.preventDefault();
        scrollTo(id);
      }}
    >
      {text}
    </a>
  );

  /** 分析时间：真实的抽取时间戳；没有就如实说「尚未分析」 */
  const analyzedAt = method?.extractedAt
    ? new Date(method.extractedAt).toLocaleString('zh-CN', { hour12: false })
    : '尚未分析';
  const sourceTag = !method ? '等待分析' : method.cached ? '预置样例结果' : '本次实时分析';

  /** 复制结论（真实功能：把这篇的真实结论拷到剪贴板） */
  const copySummary = async () => {
    if (!method) return;
    const lines = FIELD_KEYS_ORDER.map((k) => {
      const f = method.fields[k];
      const v = f?.value?.trim();
      return `${METHOD_FIELD_LABELS[k]}：${v ? v : '未提取到'}`;
    });
    const text = [`论文：${paper.title}`, `分析时间：${analyzedAt}（${sourceTag}）`, '', ...lines].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  /** 导出结果（真实功能：把这篇的真实数据导出成 JSON） */
  const exportResult = () => {
    if (!method) return;
    const blob = new Blob([JSON.stringify({ paper: { id: paper.id, title: paper.title }, method }, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${paper.title.slice(0, 40).replace(/[\\/:*?"<>|]/g, '_')}-分析结果.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!method) {
    return (
      <div className="rspage pb-20">
        <div className="max-w-[var(--content-max)] mx-auto px-6 pt-16 pb-20">
          <div className="content-card bg-white">
            <h1 className="text-xl font-serif font-bold tracking-tight">这篇论文还没有分析结果</h1>
            <p className="text-sm text-[var(--fg-2)] leading-relaxed mt-3">
              「{paper.title}」已经解析完成，但还没有抽取方法字段。先到方法提取页跑一次分析，就能看到这里的完整结果。
            </p>
            <div className="flex items-center gap-3 mt-6">
              <button className="btn-primary" onClick={onGoUpload}>
                去分析这篇论文
              </button>
              <button className="btn-outline" onClick={onBack}>
                返回论文集合
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rspage pb-20">
      {/* ---------- 子头（草稿：白底 + 下边框 + sticky） ---------- */}
      <div className="bg-white border-b border-[var(--line)] sticky top-[var(--topbar-h)] z-40">
        <div className="max-w-[var(--content-max)] mx-auto px-6 py-4 flex justify-between items-center gap-4">
          <div className="min-w-0">
            <h1 className="text-xl font-serif font-bold tracking-tight">分析结果概览</h1>
            {/* 草稿顶栏原本显示当前文件名；本项目共用顶栏不显示，故在此补一行（必要的兼容补充） */}
            <p className="text-xs text-[var(--fg-3)] uppercase tracking-widest mt-1 truncate">
              {paper.title} · 分析于 {analyzedAt} • {sourceTag}
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <button className="btn-outline flex items-center gap-2" onClick={copySummary}>
              <DraftIcon name="share-2" />
              {copied ? '已复制' : '复制结论'}
            </button>
            <button className="btn-outline flex items-center gap-2" onClick={exportResult}>
              <DraftIcon name="download" />
              导出结果
            </button>
            <button className="btn-primary flex items-center gap-2" onClick={onGoCompare}>
              <DraftIcon name="plus" />
              加入比较
            </button>
          </div>
        </div>
      </div>

      {/* ---------- 主体 ---------- */}
      <main className="max-w-[var(--content-max)] mx-auto px-6 pt-10 grid grid-cols-12 gap-8">
        <div className="col-span-12 lg:col-span-9 space-y-10">
          {/* ===== 六张指标卡（草稿 f3570956 v2「指标优化版」）=====
               规格统一：同一套 content-card + shadow-sm/hover:shadow-md，标志图标一律 text-2xl + 品牌色，
               数值行 mb-4 后再接 h-1 的条，说明文字 text-[11px]/--fg-3/mt-4。
               六张**同在一个栅格**里（md 两列、lg 三列自动换行），不是拆成两行。
               前三项是模型评估（不是论文给出的分数），后三项是能点回原文的真实统计。 */}
          <section
            id="overview"
            ref={(el) => {
              sectionRefs.current.overview = el;
            }}
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
          >
            {/* 1 创新度评分（模型评估） */}
            <div className="content-card bg-white p-6 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex justify-between items-start mb-6">
                <span className="text-xs font-bold text-[var(--fg-3)] uppercase tracking-wider">创新度评分</span>
                <DraftIcon name="sparkles" className="text-[var(--accent)] text-2xl" />
              </div>
              <div className="flex items-baseline gap-2 mb-4">
                <span className="text-4xl font-serif font-black text-[var(--accent)]">
                  {typeof innovation?.value === 'number' ? innovation.value : '—'}
                </span>
                <span className="text-sm text-[var(--fg-3)]">/ 10</span>
              </div>
              <div className="w-full bg-[var(--bg-3)] h-1 rounded-full overflow-hidden">
                <div
                  className="bg-[var(--accent)] h-full"
                  style={{ width: `${typeof innovation?.value === 'number' ? Math.round(innovation.value * 10) : 0}%` }}
                />
              </div>
              <p className="text-[11px] text-[var(--fg-3)] mt-4 leading-relaxed">
                模型评估，不是论文给出的分数。{basisOf(innovation)}
              </p>
            </div>

            {/* 2 方法复杂度（模型评估） */}
            <div className="content-card bg-white p-6 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex justify-between items-start mb-6">
                <span className="text-xs font-bold text-[var(--fg-3)] uppercase tracking-wider">方法复杂度</span>
                <DraftIcon name="layers" className="text-[var(--accent)] text-2xl" />
              </div>
              <div className="flex items-baseline gap-2 mb-4">
                <span className="text-4xl font-serif font-black text-[var(--accent)]">
                  {typeof complexity?.value === 'string' ? complexity.value : '—'}
                </span>
              </div>
              <div className="flex gap-1">
                {[0, 1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className={`h-1 flex-1 rounded-full ${i < complexityFilled ? 'bg-[var(--accent)] opacity-100' : 'bg-[var(--bg-3)]'}`}
                  />
                ))}
              </div>
              <p className="text-[11px] text-[var(--fg-3)] mt-4 leading-relaxed">
                模型评估（按模型规模与结构复杂度判定）。{basisOf(complexity)}
              </p>
            </div>

            {/* 3 领域相关性（模型评估） */}
            <div className="content-card bg-white p-6 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex justify-between items-start mb-6">
                <span className="text-xs font-bold text-[var(--fg-3)] uppercase tracking-wider">领域相关性</span>
                <DraftIcon name="link-2" className="text-[var(--accent)] text-2xl" />
              </div>
              <div className="flex items-baseline gap-2 mb-4">
                <span className="text-4xl font-serif font-black text-[var(--accent)]">
                  {typeof relevance?.value === 'number' ? `${relevance.value}%` : '—'}
                </span>
              </div>
              <div className="w-full bg-[var(--bg-3)] h-1 rounded-full overflow-hidden">
                <div
                  className="bg-[var(--accent)] h-full"
                  style={{ width: `${typeof relevance?.value === 'number' ? relevance.value : 0}%` }}
                />
              </div>
              <p className="text-[11px] text-[var(--fg-3)] mt-4 leading-relaxed">
                模型评估，不代表优劣、也不用于排名。{basisOf(relevance)}
              </p>
            </div>

            {/* 4 已核验字段（真实统计） */}
            <div className="content-card bg-white p-6 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex justify-between items-start mb-6">
                <span className="text-xs font-bold text-[var(--fg-3)] uppercase tracking-wider">已核验字段</span>
                <DraftIcon name="check-circle-2" className="text-[var(--accent)] text-2xl" />
              </div>
              <div className="flex items-baseline gap-2 mb-4">
                <span className="text-4xl font-serif font-black text-[var(--accent)]">{stats.verified}</span>
                <span className="text-sm text-[var(--fg-3)]">/ {stats.total}</span>
              </div>
              <div className="w-full bg-[var(--bg-3)] h-1 rounded-full overflow-hidden">
                <div
                  className="bg-[var(--accent)] h-full"
                  style={{ width: `${Math.round((stats.verified / stats.total) * 100)}%` }}
                />
              </div>
              <p className="text-[11px] text-[var(--fg-3)] mt-4 leading-relaxed">
                这些字段的引文已在原文中定位成功；其余会如实标为待核查或缺失，不给没有依据的分数。
              </p>
            </div>

            {/* 5 实验记录（真实统计） */}
            <div className="content-card bg-white p-6 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex justify-between items-start mb-6">
                <span className="text-xs font-bold text-[var(--fg-3)] uppercase tracking-wider">实验记录</span>
                <DraftIcon name="table-2" className="text-[var(--accent)] text-2xl" />
              </div>
              <div className="flex items-baseline gap-2 mb-4">
                <span className="text-4xl font-serif font-black text-[var(--accent)]">{stats.expCount}</span>
                <span className="text-sm font-bold text-[var(--accent)] ml-1">条</span>
              </div>
              <div className="flex gap-1">
                {[0, 1, 2, 3, 4].map((i) => (
                  <div
                    key={i}
                    className={`h-1 flex-1 rounded-full ${i < Math.min(stats.expCount, 5) ? 'bg-[var(--accent)]' : 'bg-[var(--bg-3)]'}`}
                  />
                ))}
              </div>
              <p className="text-[11px] text-[var(--fg-3)] mt-4 leading-relaxed">
                从本篇论文的表格里提取到的实验记录数；每条都能点回原文核对（不足 5 条时按实际显示）。
              </p>
            </div>

            {/* 6 原文依据覆盖（真实统计） */}
            <div className="content-card bg-white p-6 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex justify-between items-start mb-6">
                <span className="text-xs font-bold text-[var(--fg-3)] uppercase tracking-wider">原文依据覆盖</span>
                <DraftIcon name="book-open" className="text-[var(--accent)] text-2xl" />
              </div>
              <div className="flex items-baseline gap-2 mb-4">
                <span className="text-4xl font-serif font-black text-[var(--accent)]">{stats.coverage}%</span>
              </div>
              <div className="w-full bg-[var(--bg-3)] h-1 rounded-full overflow-hidden">
                <div className="bg-[var(--accent)] h-full" style={{ width: `${stats.coverage}%` }} />
              </div>
              <p className="text-[11px] text-[var(--fg-3)] mt-4 leading-relaxed">
                已成功定位的引文占全部引文的比例（{stats.evVerified} / {stats.evTotal}）；未定位的不会被当成已确认。
              </p>
            </div>
          </section>

          {/* ===== 结构化方法论大纲 ===== */}
          <section
            id="outline"
            ref={(el) => {
              sectionRefs.current.outline = el;
            }}
            className="content-card bg-white"
          >
            <div className="flex items-center gap-3 mb-8">
              <div className="w-1 bg-[var(--accent)] h-6" />
              <h2 className="text-2xl font-serif font-bold">结构化方法论大纲</h2>
            </div>
            <div className="space-y-6">
              {outline.map((s) => {
                const open = openKeys.has(s.key);
                const ev = s.field?.evidence;
                return (
                  <div key={s.key} className="border-l-2 border-[var(--bg-3)] ml-2 pl-6 relative">
                    <div
                      className={`absolute -left-[5px] top-1.5 w-2 h-2 rounded-full ${open ? 'bg-[var(--accent)]' : 'bg-[var(--bg-3)]'}`}
                    />
                    <div
                      className="flex justify-between items-center group cursor-pointer"
                      onClick={() =>
                        setOpenKeys((cur) => {
                          const next = new Set(cur);
                          if (next.has(s.key)) next.delete(s.key);
                          else next.add(s.key);
                          return next;
                        })
                      }
                    >
                      <h4 className="text-lg font-bold">{s.title}</h4>
                      <DraftIcon
                        name={open ? 'chevron-down' : 'chevron-right'}
                        className="text-[var(--fg-3)] group-hover:text-[var(--accent)] transition-transform"
                      />
                    </div>
                    {open && (
                      <div className="mt-4 text-[var(--fg-2)] leading-relaxed text-sm space-y-3">
                        <div className="bg-[var(--accent-soft)] p-4 rounded-lg border-l-4 border-[var(--accent)]">
                          <span className="font-bold block mb-1">原文摘录:</span>
                          {s.field?.value?.trim() ? s.field.value : '未提取到（论文未报告或本次片段里没有）'}
                        </div>
                        <ul className="list-disc list-inside space-y-2 opacity-80 pl-2">
                          <li>状态：{FIELD_STATUS_TEXT[s.field?.status ?? 'missing']}</li>
                          <li>
                            引文：
                            {ev
                              ? ev.verified
                                ? `已定位（p.${ev.page ?? '?'}）`
                                : '未通过定位校验，待人工核对'
                              : '模型未给出引文'}
                          </li>
                          {ev && onOpenEvidence && (
                            <li>
                              <button className="text-link" onClick={() => onOpenEvidence(ev)}>
                                查看原文依据
                              </button>
                            </li>
                          )}
                        </ul>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* ===== 优化与改进建议（换成真实字段：输入·训练条件 / 局限） ===== */}
          <section
            id="suggestions"
            ref={(el) => {
              sectionRefs.current.suggestions = el;
            }}
            className="space-y-6"
          >
            <div className="flex items-center gap-3">
              <div className="w-1 bg-[var(--fig-brand)] h-6" />
              <h2 className="text-2xl font-serif font-bold">复现要点与已知局限</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="content-card bg-[var(--accent-soft)] border-none p-6">
                <DraftIcon name="lightbulb" className="text-2xl text-[var(--accent)] mb-4" />
                <h4 className="font-bold mb-2">复现要点</h4>
                <p className="text-sm text-[var(--fg-2)] leading-relaxed">
                  {method.fields.inputsConditions?.value?.trim() || '本篇未写明输入/训练条件'}
                </p>
              </div>
              <div className="content-card bg-[var(--bg-3)] border-none p-6">
                <DraftIcon name="arrow-up-right" className="text-2xl text-[var(--fg-2)] mb-4" />
                <h4 className="font-bold mb-2">已知局限</h4>
                <p className="text-sm text-[var(--fg-2)] leading-relaxed">
                  {method.fields.limitations?.value?.trim() || '本篇未写明局限'}
                </p>
              </div>
            </div>
          </section>

          {/* ===== 原文重点摘录（真实引文 + 真实页码） ===== */}
          <section
            id="references"
            ref={(el) => {
              sectionRefs.current.references = el;
            }}
            className="content-card bg-white"
          >
            <div className="flex items-center gap-3 mb-8">
              <div className="w-1 bg-[var(--fig-mid)] h-6" />
              <h2 className="text-2xl font-serif font-bold">原文重点摘录</h2>
            </div>
            <div className="space-y-6">
              {quotes.length ? (
                quotes.map((q, i) => (
                  <blockquote
                    key={i}
                    className="border-l-4 border-[var(--bg-4)] pl-6 py-2 italic text-[var(--fg-2)] leading-relaxed bg-[var(--bg-2)] rounded-r-lg"
                  >
                    "{q.ev.quote}"
                    <div className="mt-3 flex items-center gap-2 not-italic">
                      <span className="text-[10px] font-bold bg-[var(--bg-3)] px-2 py-0.5 rounded">
                        PAGE {q.ev.page ?? '?'}
                      </span>
                      <span className="text-[10px] text-[var(--fg-3)]">{q.label}</span>
                    </div>
                  </blockquote>
                ))
              ) : (
                <p className="text-sm text-[var(--fg-2)] leading-relaxed">
                  这篇论文还没有通过原文定位校验的引文，所以这里不展示摘录（不会拿未核验的文字冒充原文）。
                </p>
              )}
            </div>
          </section>
        </div>

        {/* ---------- 右侧 sticky 侧栏 ---------- */}
        <div className="hidden lg:block lg:col-span-3">
          <div className="sticky top-[160px] space-y-8">
            <div className="bg-white rounded-2xl border border-[var(--line)] p-6">
              <h4 className="text-xs font-black text-[var(--fg-3)] uppercase tracking-widest mb-6">内容导航</h4>
              <nav className="flex flex-col gap-5 text-sm">
                {navItem('overview', '结果概览')}
                {navItem('outline', '方法论大纲')}
                {navItem('suggestions', '要点与局限')}
                {navItem('references', '重点摘录')}
              </nav>
            </div>

            <div className="bg-[var(--accent)] text-white rounded-2xl p-6 shadow-xl">
              <DraftIcon name="map" className="text-3xl mb-4 opacity-80" />
              <h4 className="text-lg font-serif font-bold mb-2">查看研究地图</h4>
              <p className="text-xs text-white/70 leading-relaxed mb-6">
                将此篇论文置于领域脉络中，探索其与前序/后继研究的关联。
              </p>
              <button
                className="inline-flex items-center gap-2 text-sm font-bold bg-white/10 hover:bg-white/20 px-4 py-2 rounded-lg transition-colors w-full justify-center"
                onClick={onGoMap}
              >
                立即前往地图 <DraftIcon name="arrow-right" />
              </button>
            </div>

            <div className="bg-[var(--bg-2)] rounded-2xl border border-[var(--line)] p-6">
              <p className="text-[10px] text-[var(--fg-3)] uppercase font-black tracking-widest mb-4">同族方法</p>
              <div className="space-y-4">
                {similar.length ? (
                  similar.map((s) => (
                    <div key={s.id} className="group cursor-pointer" onClick={onGoMap}>
                      <p className="text-xs font-bold group-hover:text-[var(--accent)] transition-colors">
                        {s.paper?.title ?? s.profile.shortName}
                      </p>
                      <p className="text-[10px] text-[var(--fg-3)]">{s.profile.family.name}</p>
                    </div>
                  ))
                ) : (
                  <p className="text-[10px] text-[var(--fg-3)]">当前集合里没有同族的其它论文</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* ---------- 页脚 ---------- */}
      <footer className="max-w-[var(--content-max)] mx-auto px-6 mt-20 pt-12 border-t border-[var(--line)] flex flex-col md:flex-row justify-between items-center gap-8">
        <div className="flex items-center gap-8 text-sm">
          <button className="text-link" onClick={onBack}>
            返回论文集合
          </button>
          <button className="text-[var(--fg-2)] hover:text-[var(--accent)] font-medium" onClick={onGoUpload}>
            继续分析其他论文 →
          </button>
        </div>
        <p className="text-[10px] text-[var(--fg-3)] uppercase tracking-widest">
          © 2026 ResearchPilot. 基于墨蓝编辑系统构建.
        </p>
      </footer>
    </div>
  );
}
