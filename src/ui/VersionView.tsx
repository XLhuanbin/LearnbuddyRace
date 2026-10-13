import React, { useEffect, useState } from 'react';
import { DraftIcon } from '../draft-icons';

/**
 * 版本信息与更新历史（草稿 0b5dcfda v3）
 *
 * 结构与视觉逐行照搬草稿，**草稿里编造的内容一律不采纳**，逐处换成真实素材（每处都有注）：
 * - 草稿的三张能力卡底部写着 `Accuracy 96%+` / `Real-time` 之类的指标 ⇒ 换成「这三个能力真实成立的边界」
 *   （解析在本机完成 / 关系只有三种证据状态 / 条件可配但不排名）。
 * - 草稿的版本线是 `v1.3.0 Stable 2024.03.25` 等虚构版本 ⇒ 换成**项目里真实发生过的五个节点**
 *   （日期与内容取自 `docs/STATUS.md` 的轮次记录与每日工作日志）。
 *   项目从来没打过 semver 标签，所以这里不编版本号，用「阶段名 + 真实日期」。
 * - 草稿的技术墙是 `Supabase Vector DB` / `LangChain` / `D3.js` / `Python Backend` / `Vercel` / `Zotero` ——
 *   本项目一个都没用 ⇒ 换成 package.json 与 docs 里**真实存在**的十项。
 * - 草稿的致谢写着「斯坦福、清华、苏黎世联邦理工的首批 200 名内测用户」 ⇒ 换成真实来源
 *   （五篇论文的作者、真实用到的开源项目、LearnBuddy 平台、赛事方）。
 *   这页本身也是「AI 工具使用 25%」这一评分项的证据页，编造背书反而会扣分。
 * - 草稿页脚的 `team@researchpilot.ai` / `Twitter / X` / `隐私协议` 都是假链接（点了会跳走） ⇒
 *   换成站内真实存在的页面与真实的源码仓库地址。
 *
 * 两条不许破的底线：只写实跑过的东西（不写没做的承诺 / 没验证过的指标）；不给论文排名。
 */

type Target = 'map' | 'decision' | 'library' | 'status' | 'settings' | 'more';

interface Props {
  /** 返回上一处（从「更多」进来就回「更多」） */
  onBack: () => void;
  /** 页脚与正文里的站内跳转，全部指向真实存在的页面 */
  onGo: (tab: Target) => void;
}

/** 三条当前真实可用的能力（文案只写已经做出来的部分，不写「将支持」） */
const CAPABILITIES: { badge: string; icon: string; title: string; desc: string; foot: [string, string] }[] = [
  {
    badge: '解析引擎',
    icon: 'upload-cloud',
    title: '深度论文解析',
    desc: '把一篇论文拆成方法、实验条件与结论三类字段，每个字段都绑定原文引文；解析在你的浏览器里完成，PDF 不会离开本机。',
    foot: ['浏览器内完成', '密钥只存本机'],
  },
  {
    badge: '可视化',
    icon: 'git-graph',
    title: '研究地图',
    desc: '把一组论文整理成方法地图：网络视图看方法与关系，时间线只看发表先后；右下角常驻动线枢纽，可直达跨论文比较、阅读路线、关系明细与待调查问题。每条关系都标注「原文明示 / 系统推断 / 待核查」，虚线表示没有方向。',
    foot: ['网络 + 时间线', '关系三态'],
  },
  {
    badge: '智能引导',
    icon: 'compass',
    title: '阅读路线',
    desc: '按你的基础、可用时间与算力条件排出阅读顺序，并说明每一步的依据；系统不做论文排名，条件不一致时也不给跨论文的性能结论。',
    foot: ['条件可配', '可导出清单'],
  },
];

/**
 * 版本线：只列真实发生过的节点。
 * 日期与事件都能在 `docs/STATUS.md`（轮次小节）与 `.learnbuddy/memory/YYYY-MM-DD.md` 里逐条对上。
 */
const HISTORY: { tag: string; date: string; title: string; items: string[] }[] = [
  {
    tag: '决赛提交版',
    date: '2026-10-13',
    title: '研究地图动线收口、入口去重与系统加固',
    items: [
      '研究地图只保留方法地图（网络视图）与发表顺序时间线两个视图；右下角常驻动线枢纽，把「跨论文比较 / 阅读路线 / 关系明细 / 待调查问题」四个出口与「查看完整分析报告」放在一处，删掉与此重复的页头入口。',
      '方法族判定改为三层（方法名称 → 核心思路首句 → 全文兜底扫描），规则从三类扩到五类（卷积 / Transformer / 混合 / 点云 / 图与 MLP），点云等语料不再一律落进「待确认」。',
      '系统加固：存储改为等事务完成才算写入、跨表操作原子化、导入与模型任务串行互斥、比较引擎重写（未知值统一判定、同口径分组、成对比较），引文只有部分命中时不再被写成已核验。',
      '回归基线全部通过：核心测试 624 项、端到端 78 项、桌面排版 89 项、界面走查 46 项；构建与线上资源逐项核对过指纹。',
    ],
  },
  {
    tag: '决赛打磨版',
    date: '2026-10-11',
    title: '按统一设计稿重做六个页面',
    items: [
      '方法提取、分析结果、研究地图、跨论文对比表、阅读路线、待调查问题六页改用同一套视觉语言，界面不再出现多种风格并存。',
      '视觉案例的方法关系补齐到 10 条（10 对论文全覆盖），其中 4 条有原文直接陈述作为证据，其余标注为系统推断或待核查。',
      '新建/更新桌面端走查脚本，覆盖上传、重载、关系、UI、排版、范围、窄屏七项看图断言。',
    ],
  },
  {
    tag: '入围决赛',
    date: '2026-10-08',
    title: '开发方式改为双人分工',
    items: [
      '作品进入粤港澳大湾区 AI Coding 创新大赛决赛（方向二 · 论文方法梳理智能体）。',
      '协作方式从单人开发改为「核心 A（分析内核与数据契约）+ 核心 B（可靠性与持久化）」两条线并行，UI 在核心冻结后统一收口。',
    ],
  },
  {
    tag: '初赛提交版',
    date: '2026-09-26',
    title: '修掉四处会让人误判结果的缺陷',
    items: [
      '四处缺陷：视觉案例的全文目录取错、分歧引文完全没做定位校验、页面代码里手写 verified: true、关系去重合掉了 A→B 与 B→A 的方向。',
      '新增四条代码层硬约束：引文校验只有一个入口、人工修正统一走 effective.ts、模型返回必须过结构校验、语料的 base 必须由调用方显式传入。',
      '打通用户自己上传 PDF 的真实导入流程；重新加载预置案例不再丢失人工修正。',
      '修正「人工关系」判定：aiOriginal 不是人工标志，只有 userEdited 才是。',
    ],
  },
  {
    tag: '正式领域版',
    date: '2026-09-18',
    title: '确定正式领域，换用真实论文',
    items: [
      '正式领域定为「图像分类中 CNN 到视觉 Transformer 的方法演进与实验比较」，5 篇真实论文、23 条实验记录入库。',
      '旧 NLP 语料降级为独立的开发回归样例，两套语料各自计算关系与推荐，永不混合。',
      '证据绑定与不可比检测上线：每个字段都能回到原文，训练条件不一致时明确禁止直接比较数值。',
    ],
  },
  {
    tag: '原型版',
    date: '2026-09-16',
    title: '跑通最小流程并确定技术形态',
    items: [
      '最小流程跑通：PDF 文本层解析 → 字段提取 → 把引文定位回论文全文。首批三篇 arXiv 论文解析成功，20 条引文全部通过定位校验。',
      '确定技术形态：Vite + React + TypeScript 的纯前端静态站，数据只存在本机浏览器（IndexedDB），线上版本不保管任何密钥。',
      '修掉五处会让结果被误判的缺陷，包括跨行连字符断词失败、半真引文被判为有效、以及预置缓存被标成「本次实时分析」。',
    ],
  },
];

/**
 * 技术墙：只列 `package.json` / `docs/STATUS.md` 里真实存在的东西。
 * 图标 = 各自的**真实品牌标志**（与草稿同一套 Simple Icons / `logos:*`，已在构建期内联，不依赖 CDN）；
 * 没有官方标志的三项（pdf.js / IndexedDB / LearnBuddy）沿用 lucide 表意图形 —— 草稿自己也是这么混的。
 */
const TECH: { icon: string; name: string }[] = [
  { icon: 'react', name: 'React 18' },
  { icon: 'typescript-icon', name: 'TypeScript' },
  { icon: 'vite-icon', name: 'Vite' },
  { icon: 'tailwindcss-icon', name: 'Tailwind CSS' },
  { icon: 'file-text', name: 'pdf.js' },
  { icon: 'database', name: 'IndexedDB' },
  { icon: 'deepseek-icon', name: 'DeepSeek API' },
  { icon: 'nodejs-icon', name: 'Node.js' },
  { icon: 'chrome', name: 'Chrome CDP' },
  { icon: 'brain-circuit', name: 'LearnBuddy' },
];

/** 致谢：只列真实来源，不写虚构的用户数、高校或背书（按用户要求去掉了「论文作者」这一条） */
const THANKS: { title: string; desc: string }[] = [
  {
    title: '开源社区',
    desc: 'pdf.js（Mozilla）、React、TypeScript、Vite、Tailwind CSS 与 lucide 图标 —— 本项目没有自研渲染层，直接站在这些项目之上。',
  },
  {
    title: 'LearnBuddy',
    desc: '本次开发全程在 LearnBuddy 中完成：代码在 AI 辅助下编写，开发期的模型调用额度由平台提供。运行时用到哪个模型接口，由使用者在「设置」里自己填写。',
  },
  {
    title: '赛事与评审',
    desc: '粤港澳大湾区 AI Coding 创新大赛 · 方向二「论文方法梳理智能体」。这一页只列真实来源，不写没有过的背书。',
  },
];

const FOOT_NAV: { title: string; items: [Target, string][] }[] = [
  {
    title: '产品',
    items: [
      ['library', '论文集合'],
      ['map', '研究地图'],
      ['decision', '阅读路线'],
    ],
  },
  {
    title: '更多资源',
    items: [
      ['status', '开发状态与记录'],
      ['settings', '设置'],
      ['more', '更多'],
    ],
  },
];

const REPO_URL = 'https://github.com/XLhuanbin/LearnbuddyRace';

export function VersionView({ onBack, onGo }: Props) {
  /** 页脚右下角的 Build = 真实构建指纹（同 StatusView 的取法），取不到就如实说 */
  const [build, setBuild] = useState<{ buildId?: string } | undefined>();

  useEffect(() => {
    let alive = true;
    fetch('./build.json', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j) => {
        if (alive) setBuild(j);
      })
      .catch(() => {
        if (alive) setBuild(undefined);
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="verpage sdpage">
      <div className="mb-16">
        <button
          type="button"
          id="back-from-version-btn"
          className="inline-flex items-center gap-2 text-sm font-bold text-[var(--fg-3)] hover:text-[var(--accent)] transition-colors mb-6"
          onClick={onBack}
        >
          <DraftIcon name="arrow-left" />
          返回
        </button>
        <p className="text-[var(--fg-3)] tracking-[0.3em] uppercase text-xs font-bold mb-2">Product Version Info</p>
        <h1 className="text-5xl font-serif font-bold tracking-tight mb-4">版本信息与更新历史</h1>
        <p className="text-lg text-[var(--fg-2)] max-w-2xl">
          记录 ResearchPilot 每一步做了什么、因为什么改，以及它建立在哪些公开工作之上。
        </p>
      </div>

      <section className="mb-20">
        <div className="flex items-center gap-4 mb-8">
          <h2 className="text-2xl font-bold font-serif">当前核心能力</h2>
          <span className="h-[1px] flex-1 bg-[var(--line)]" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {CAPABILITIES.map((c) => (
            <div key={c.title} className="card-published">
              <div className="flex justify-between items-start mb-4">
                <span className="badge-live">{c.badge}</span>
                <DraftIcon name={c.icon} className="text-2xl text-[var(--accent)]" />
              </div>
              <h3 className="text-lg font-bold mb-2">{c.title}</h3>
              <p className="text-sm text-[var(--fg-2)] mb-6">{c.desc}</p>
              <div className="pt-4 border-t border-[var(--line)] flex justify-between items-center text-[10px] font-bold text-[var(--fg-3)]">
                <span>{c.foot[0]}</span>
                <span>{c.foot[1]}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-24">
        <div className="flex items-center gap-4 mb-10">
          <h2 className="text-2xl font-bold font-serif">版本历史</h2>
          <span className="h-[1px] flex-1 bg-[var(--line)]" />
        </div>
        <div className="max-w-4xl ml-4 space-y-12 relative border-l border-[var(--line-2)] pl-8">
          {HISTORY.map((h, i) => (
            <div key={h.tag} className="relative" style={i === 0 ? undefined : { opacity: 1 - i * 0.1 }}>
              <div className={`timeline-dot${i === 0 ? ' scale-125 ring-4 ring-[var(--bg-3)]' : ''}`} />
              <div className="flex flex-col md:flex-row md:items-baseline gap-4 mb-2">
                <span className={`${i === 0 ? 'text-xl' : 'text-lg'} font-bold text-[var(--fg)]`}>{h.tag}</span>
                <span className="text-xs font-bold text-[var(--fg-3)] opacity-70">{h.date}</span>
              </div>
              <div className="bg-white p-6 rounded-2xl border border-[var(--line)] shadow-sm space-y-3">
                <h4 className={`font-bold${i === 0 ? ' text-[var(--accent)]' : ''}`}>{h.title}</h4>
                <ul className="text-sm text-[var(--fg-2)] space-y-2 list-disc list-inside">
                  {h.items.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-24 overflow-hidden">
        <div className="flex items-center gap-4 mb-10">
          <h2 className="text-2xl font-bold font-serif">技术架构</h2>
          <span className="h-[1px] flex-1 bg-[var(--line)]" />
        </div>

        <div className="relative">
          {/* 左右渐变蒙版：让滚动进出的一列淡出，而不是被硬切掉 */}
          <div className="absolute left-0 top-0 bottom-0 w-32 z-10 bg-gradient-to-r from-[var(--bg)] to-transparent pointer-events-none" />
          <div className="absolute right-0 top-0 bottom-0 w-32 z-10 bg-gradient-to-l from-[var(--bg)] to-transparent pointer-events-none" />

          {/*
            草稿把列表抄两遍后用 translateX(-50%) 无缝循环。这里拆成两个同宽的子序列，
            外层再给一个相同的 gap —— 这样总宽正好是单份宽度 + 一份间隙，位移 50% 后与起点重合。
            （草稿直接把两份平铺在同一个 flex 里，位移会差半个 gap，循环时会有一次可见跳动。）
          */}
          <div className="animate-scroll gap-6 py-4">
            {[0, 1].map((copy) => (
              <div key={copy} className="flex gap-6" aria-hidden={copy === 1 ? true : undefined}>
                {TECH.map((t) => (
                  <div key={`${copy}-${t.name}`} className="tech-tag">
                    <DraftIcon name={t.icon} className="text-3xl" />
                    {t.name}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mb-24">
        <div className="flex items-center gap-4 mb-10">
          <h2 className="text-2xl font-bold font-serif">致谢</h2>
          <span className="h-[1px] flex-1 bg-[var(--line)]" />
        </div>
        <div className="bg-white rounded-2xl border border-[var(--line)] p-8 max-w-4xl">
          <p className="text-[var(--fg-2)] leading-relaxed mb-6">
            这一页只列真实来源：下面是本作品真正依赖的开源项目、平台与赛事。
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-6">
            {THANKS.map((t) => (
              <div key={t.title} className="space-y-2">
                <h5 className="font-bold text-sm text-[var(--fg)]">{t.title}</h5>
                <p className="text-xs text-[var(--fg-3)]">{t.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 草稿的 <footer> 是 <main> 的兄弟节点（通栏白底），内容再按 1200px 居中（见 draft.css 的 .verpage > footer） */}
      <footer className="border-t border-[var(--line)] bg-white py-16">
        <div className="max-w-[1200px] mx-auto px-10 flex flex-col md:flex-row justify-between gap-12">
          <div className="max-w-xs space-y-4">
            <div className="flex items-center gap-3">
              <span className="rp-wordmark w-6 h-6 bg-[#1F4772] text-white flex items-center justify-center font-black text-xs rounded-sm">R</span>
              <span className="rp-wordmark text-[#16263D] font-bold tracking-tight">ResearchPilot</span>
            </div>
            <p className="text-xs text-[var(--fg-3)] leading-relaxed">
              由 AI 辅助开发的研究方法梳理工具，帮研究者把一组论文整理成可以核对的方法视角。
            </p>
          </div>
          <div className="flex gap-20">
            {FOOT_NAV.map((col) => (
              <div key={col.title} className="space-y-4">
                <h4 className="text-xs font-bold uppercase tracking-widest text-[var(--fg-3)]">{col.title}</h4>
                <nav className="flex flex-col gap-2">
                  {col.items.map(([tab, label]) => (
                    <button key={tab} type="button" className="text-sm text-[var(--fg-2)] hover:text-[var(--accent)] text-left" onClick={() => onGo(tab)}>
                      {label}
                    </button>
                  ))}
                </nav>
              </div>
            ))}
            <div className="space-y-4">
              <h4 className="text-xs font-bold uppercase tracking-widest text-[var(--fg-3)]">源码</h4>
              <nav className="flex flex-col gap-2">
                <a href={REPO_URL} target="_blank" rel="noreferrer" className="text-sm text-[var(--fg-2)] hover:text-[var(--accent)]">
                  GitHub 仓库
                </a>
              </nav>
            </div>
          </div>
        </div>
        <div className="max-w-[1200px] mx-auto px-10 mt-16 pt-8 border-t border-[var(--bg-4)] flex justify-between items-center text-[10px] text-[var(--fg-3)] uppercase font-bold tracking-widest">
          <span>© 2026 ResearchPilot · 深圳大学「啥名字好」队</span>
          <span>{build?.buildId ? `Build ${build.buildId}` : 'Build —（本地运行，无构建指纹）'}</span>
        </div>
      </footer>
    </div>
  );
}
