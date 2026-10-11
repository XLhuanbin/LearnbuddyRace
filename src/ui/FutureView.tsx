import React, { useMemo, useState } from 'react';
import { DraftIcon } from '../draft-icons';
import { downloadText } from './common';

/**
 * 未来展望与功能建议（草稿 4bdccae1 v1）—— **形态 A：本机标记 + 导出**
 *
 * 这是 12 张稿里唯一整页建立在「多用户后端」上的一张：投票计数、社群共建排行、用户墙。
 * 本作品是**纯静态单机应用**（没有服务端、没有账号、数据只在本机浏览器），照搬就是编造 ⇒ 必须改造。
 * 改造只发生在**交互层与内容层**，视觉骨架（五段结构 / 卡片 / 进度条 / 排行号 / 虚线卡 / 来源卡）全部照草稿。
 *
 * 逐处替换（每处都写明真实依据，见各数据结构上的注）：
 * - 草稿「842 人也想要」→ 我们没有这个数字 ⇒ 换成该方向**真实的前提或阻碍**。
 * - 草稿「我也想要」按钮 → 保留形态，但只改**本机状态**（写入 localStorage），文案变「已标记」；
 *   区块导语里明说「只记录在你自己的浏览器里，不是全站统计」。
 * - 草稿进度条 75% / 40% → 数字是编的 ⇒ 换成真实可数的「已完成 X / 共 Y 项」。
 * - 草稿「预计 2024.05 发布」「2024 Q4」排期 → 我们没有排期 ⇒ 全部去掉，只写「有没有排期」。
 * - 草稿「已采纳的智慧」里 `@学术小王 · 研究生 · CS` 等全部虚构 ⇒ 换成这条改动**真实的来源**
 *   （自查 / 用户反馈 / 走查脚本）+ 真实结论。
 * - 草稿「星辰大海」是「将来会做」的三张虚线卡 ⇒ 换成**明确不做的事并写明原因**
 *   （多用户协作 / 自动排名 / 代替你下结论），按钮改成「为什么」展开真实原因。
 *
 * 三条底线：不写没排期的承诺、不写没验证过的指标、不作论文排名。
 */

type Target = 'landing' | 'library' | 'map' | 'version' | 'more';

interface Props {
  /** 返回上一处（从「更多」进来就回「更多」） */
  onBack: () => void;
  /** 页脚的站内跳转，全部指向真实存在的页面 */
  onGo: (tab: Target) => void;
}

/** 进行中 / 待排期：草稿的「预计发布」与百分比进度换成真实可数的项数 */
const IN_PROGRESS: {
  title: string;
  state: 'doing' | 'pending';
  stateText: string;
  desc: string;
  done: number;
  total: number;
  unit: string;
}[] = [
  {
    title: '把页面统一到同一份设计稿',
    state: 'doing',
    stateText: '进行中',
    desc: '方法提取、分析结果、研究地图、跨论文对比表、阅读路线、待调查问题六页已完成；版本信息、未来展望两页本轮补上。剩下「整体导航动线」还没改。',
    done: 6,
    total: 8,
    unit: '页',
  },
  {
    title: '已知缺陷与体验缺口',
    state: 'pending',
    stateText: '待排期',
    desc: '条件缺键时静默通过、390px 下地图详情抽屉溢出、窄屏横向溢出（站级栅格问题）、分歧分析编排入口缺测试、决赛视频成品 —— 五项都还没做。',
    done: 0,
    total: 5,
    unit: '项',
  },
];

/** 想做但还没做的方向（草稿的「社群共建排行」，去掉票数） */
const WISHES: { id: string; title: string; desc: string; note: string }[] = [
  {
    id: 'latex',
    title: '支持 LaTeX 源码直接解析',
    desc: '现在只能吃 PDF 文本层与纯文本。想直接上传 .tex 或 zip，就得先有 LaTeX 解析器（公式与表格引用关系目前拿不到）。',
    note: '未开始 · 缺 LaTeX 解析器',
  },
  {
    id: 'qa',
    title: '跨论文问答',
    desc: '现在只做字段抽取与关系判定，没有「对着已上传的几篇论文提问」。要做需要稳定的上下文拼装与检索，且答案必须能回到原文。',
    note: '未开始 · 缺检索与引用回溯',
  },
  {
    id: 'mobile',
    title: '窄屏与手机适配',
    desc: '已知是站级问题：12 栏栅格加上固定间距，在窄视口会横向溢出约 144px。得先统一栅格才能收口。',
    note: '未开始 · 需先统一栅格',
  },
];

/** 明确不做的事（草稿的「星辰大海」是「将来会做」，我们没有排期，所以改成写清楚为什么不做的清单） */
const WONT_DO: { title: string; desc: string; why: string }[] = [
  {
    title: '多人协作研究空间',
    desc: '实验室共同维护一张研究地图、实时协作标注。',
    why: '本作品是纯静态单机应用：没有账号体系，也没有服务端。所有数据只存在你自己的浏览器里，两个人看到的本来就不是同一份。',
  },
  {
    title: '自动给论文排名',
    desc: '按某个综合分给一组论文排出优劣顺序。',
    why: '训练条件不一致时，数值本身就不能直接比较。系统只给「能不能比、为什么」的判断，不给跨论文的综合排名 —— 这是设计上的取舍，不是还没做。',
  },
  {
    title: '代替你下结论',
    desc: '直接告诉你「该选哪个方法」。',
    why: '系统只呈现原文引文与程序判定（原文明示 / 系统推断 / 待核查），结论留给研究者自己下。把推断说成事实，是这个产品最不该做的事。',
  },
];

/** 已经做完的：草稿是虚构用户墙，这里换成真实来源 */
const ADOPTED: { from: string; kind: string; quote: string; status: string; state: 'done' | 'todo' }[] = [
  {
    from: '自查',
    kind: '代码审计',
    quote: '界面代码里曾经可以直接写 verified: true，绕过引文校验 —— 等于自己给自己发合格证。',
    status: '已收口：引文校验只有 evidence.ts 一个入口',
    state: 'done',
  },
  {
    from: '用户',
    kind: '使用反馈',
    quote: '阅读路线右侧的配置卡，往下滚的时候上下都会被截掉一截。',
    status: '已修复：进页面即钉住，滚动不再移动',
    state: 'done',
  },
  {
    from: '脚本',
    kind: '桌面走查',
    quote: '三个历史走查脚本仍然是红的，它们断言的是两轮之前的首页与研究地图。',
    status: '待处理：断言过期，不是当前页面坏了',
    state: 'todo',
  },
];

const MARKS_KEY = 'rp.future.marks';
const REPO_URL = 'https://github.com/XLhuanbin/LearnbuddyRace';

function loadMarks(): string[] {
  try {
    const raw = localStorage.getItem(MARKS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function saveMarks(ids: string[]) {
  try {
    localStorage.setItem(MARKS_KEY, JSON.stringify(ids));
  } catch {
    /* 隐私模式下写不进去就算了，不影响看页面 */
  }
}

export function FutureView({ onBack, onGo }: Props) {
  const [marks, setMarks] = useState<string[]>(loadMarks);
  const [openWhy, setOpenWhy] = useState<number | null>(null);

  const marked = useMemo(() => new Set(marks), [marks]);

  const toggle = (id: string) => {
    setMarks((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      saveMarks(next);
      return next;
    });
  };

  /** 导出：把本机标记写成 Markdown 带走（草稿的「提交你的建议」没有后端，落到导出上） */
  const exportMarks = () => {
    const picked = WISHES.filter((w) => marked.has(w.id));
    const lines: string[] = [];
    lines.push('# ResearchPilot · 我标记的建议');
    lines.push('');
    lines.push(
      '> 这份清单由 ResearchPilot 在本机生成。你在这台浏览器上标记的方向如下 —— **它不是任何形式的全站统计**，别人看不到，也不代表多少人有同样的需求。',
    );
    lines.push(`> 导出时间：${new Date().toLocaleString('zh-CN')}`);
    lines.push('');
    lines.push(`## 我标记的方向（${picked.length} 条）`);
    lines.push('');
    if (picked.length === 0) {
      lines.push('（还没有标记任何方向）');
    } else {
      for (const w of picked) {
        lines.push(`- **${w.title}** —— ${w.note}`);
        lines.push(`  ${w.desc}`);
      }
    }
    lines.push('');
    lines.push(`## 全部待办方向（${WISHES.length} 条）`);
    lines.push('');
    for (const [i, w] of WISHES.entries()) {
      lines.push(`${i + 1}. ${marked.has(w.id) ? '[已标记] ' : ''}${w.title} —— ${w.note}`);
    }
    lines.push('');
    lines.push('## 明确不做的事');
    lines.push('');
    for (const w of WONT_DO) {
      lines.push(`- ${w.title}：${w.why}`);
    }
    lines.push('');
    downloadText('researchpilot-我标记的建议.md', lines.join('\n'), 'text/markdown');
  };

  return (
    <div className="futpage sdpage">
      <section className="mb-20 text-center">
        <div className="inline-block px-4 py-1.5 bg-[var(--bg-4)] rounded-full text-[10px] font-bold tracking-[0.2em] text-[var(--fg-3)] uppercase mb-6">
          Feature Requests &amp; Roadmap
        </div>
        <h1 className="text-5xl font-serif font-black tracking-tight mb-6 leading-tight">
          想做的、在做的
          <br />
          与明确不做的
        </h1>
        <p className="text-lg text-[var(--fg-2)] max-w-2xl mx-auto mb-10">
          这一页不写排期、也不写百分比：下面是真实的进行中、想做但还没做的，以及我们决定不做的事。
          你在「还缺什么」里的标记只存在自己的浏览器里，不是全站统计。
        </p>
        <div className="flex justify-center gap-4">
          <button type="button" id="cta-export-marks" className="btn-primary flex items-center gap-2" onClick={exportMarks}>
            <DraftIcon name="plus-circle" />
            导出我标记的建议
          </button>
          <a
            href="#missing"
            id="cta-view-requests"
            className="px-8 py-3 rounded-[var(--radius-sm)] border border-[var(--line-2)] font-bold text-[var(--fg-2)] hover:bg-white transition-all flex items-center"
            onClick={(e) => {
              e.preventDefault();
              document.getElementById('missing')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
          >
            查看还缺什么
          </a>
        </div>
      </section>

      <section className="mb-24">
        <div className="flex items-center gap-4 mb-10">
          <h2 className="text-3xl font-bold font-serif">正在做</h2>
          <span className="h-[1px] flex-1 bg-[var(--line)]" />
          <span className="text-xs font-bold text-[var(--fg-3)] uppercase tracking-widest">In the forge</span>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {IN_PROGRESS.map((p) => {
            const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
            const color = p.state === 'doing' ? 'var(--progress-green)' : 'var(--progress-yellow)';
            return (
              <div key={p.title} className="content-card relative overflow-hidden">
                <div className="flex justify-between items-start mb-6">
                  <div className="space-y-1">
                    <h3 className="text-xl font-bold">{p.title}</h3>
                    <p className="text-sm text-[var(--fg-3)]">
                      {p.state === 'doing' ? '本轮在做' : '尚未排期'}
                    </p>
                  </div>
                  <span
                    className="px-3 py-1 text-[10px] font-bold rounded-full border"
                    style={{
                      background: p.state === 'doing' ? 'var(--warn-soft)' : 'var(--bg-3)',
                      color: p.state === 'doing' ? 'var(--warn)' : 'var(--fg-3)',
                      borderColor: p.state === 'doing' ? 'var(--warn-soft)' : 'var(--line)',
                    }}
                  >
                    {p.stateText}
                  </span>
                </div>
                <p className="text-[var(--fg-2)] mb-8 leading-relaxed">{p.desc}</p>
                <div className="space-y-3">
                  <div className="flex justify-between text-xs font-bold">
                    <span>完成度</span>
                    <span>
                      {p.done} / {p.total} {p.unit}
                    </span>
                  </div>
                  <div className="progress-bar">
                    <div className="progress-fill" style={{ width: `${pct}%`, background: color }} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section id="missing" className="mb-24">
        <div className="flex items-center gap-4 mb-4">
          <h2 className="text-3xl font-bold font-serif">还缺什么</h2>
          <span className="h-[1px] flex-1 bg-[var(--line)]" />
          <span className="text-xs font-bold text-[var(--fg-3)] uppercase tracking-widest">Not built yet</span>
        </div>
        <p className="text-sm text-[var(--fg-3)] mb-10">
          下面三条是真实缺口，都还没开始。「我也想要」只在你这台浏览器上记一个标记（已标记 {marks.length} 条），可以随时取消，也可以导出带走。
        </p>
        <div className="bg-white rounded-[var(--radius)] border border-[var(--line)] shadow-sm overflow-hidden">
          <div className="divide-y divide-[var(--line)]">
            {WISHES.map((w, i) => {
              const on = marked.has(w.id);
              return (
                <div key={w.id} className="p-8 flex items-center gap-10 hover:bg-[var(--bg)] transition-colors group">
                  <span className="rank-number group-hover:text-[var(--accent)] transition-colors">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <div className="flex-1 space-y-1">
                    <h4 className="text-lg font-bold">{w.title}</h4>
                    <p className="text-sm text-[var(--fg-3)]">{w.desc}</p>
                  </div>
                  <div className="flex flex-col items-end gap-3">
                    <span className="text-xs font-bold text-[var(--fg-2)]">{w.note}</span>
                    <button
                      type="button"
                      id={`mark-${w.id}`}
                      className={`btn-vote flex items-center gap-2${on ? ' on' : ''}`}
                      aria-pressed={on}
                      onClick={() => toggle(w.id)}
                    >
                      <DraftIcon name="arrow-up-circle" />
                      {on ? '已标记' : '我也想要'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="mb-24">
        <div className="flex items-center gap-4 mb-4">
          <h2 className="text-3xl font-bold font-serif">不做的事</h2>
          <span className="h-[1px] flex-1 bg-[var(--line)]" />
          <span className="text-xs font-bold text-[var(--fg-3)] uppercase tracking-widest">Out of scope</span>
        </div>
        <p className="text-sm text-[var(--fg-3)] mb-10">
          这三条看起来都像是「论文工具该有的功能」。我们不做，并且原因写在每张卡里 —— 点「为什么」展开。
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {WONT_DO.map((w, i) => (
            <div key={w.title} className="content-card bg-transparent border-dashed">
              <h4 className="font-bold mb-3">{w.title}</h4>
              <p className="text-xs text-[var(--fg-3)] mb-6 leading-relaxed">{w.desc}</p>
              {openWhy === i && (
                <p className="text-xs text-[var(--fg-2)] bg-[var(--bg)] rounded-[var(--radius-sm)] p-3 mb-6 leading-relaxed">{w.why}</p>
              )}
              <div className="flex justify-between items-center">
                <span className="text-[10px] font-bold text-[var(--fg-2)] opacity-60 uppercase tracking-widest">不在计划内</span>
                <button
                  type="button"
                  className="text-[10px] font-bold text-[var(--accent)] hover:underline"
                  onClick={() => setOpenWhy(openWhy === i ? null : i)}
                >
                  {openWhy === i ? '收起' : '为什么'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-24">
        <div className="flex items-center gap-4 mb-4">
          <h2 className="text-3xl font-bold font-serif">已经做完的</h2>
          <span className="h-[1px] flex-1 bg-[var(--line)]" />
          <span className="text-xs font-bold text-[var(--fg-3)] uppercase tracking-widest">Where it came from</span>
        </div>
        <p className="text-sm text-[var(--fg-3)] mb-10">
          每条都写明它是从哪儿来的 —— 自查、使用反馈还是走查脚本 —— 而不是「某位用户说」。
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {ADOPTED.map((a) => (
            <div key={a.from + a.status} className="p-6 bg-white border border-[var(--line)] rounded-xl flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-xs font-bold">{a.from}</div>
                <div className="flex flex-col">
                  <span className="text-xs font-bold">{a.from}发现</span>
                  <span className="text-[10px] text-[var(--fg-3)]">{a.kind}</span>
                </div>
              </div>
              <div className="p-3 bg-[var(--bg)] rounded-lg text-xs italic text-[var(--fg-2)]">“{a.quote}”</div>
              <div
                className="flex items-center gap-2 font-bold text-[10px]"
                style={{ color: a.state === 'done' ? 'var(--progress-green)' : 'var(--progress-yellow)' }}
              >
                <DraftIcon name={a.state === 'done' ? 'check-circle' : 'timer'} />
                {a.status}
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="flex flex-col items-center py-20 border-t border-[var(--line)]">
        <button
          type="button"
          id="back-to-top"
          className="group flex flex-col items-center gap-4 text-[var(--fg-3)] hover:text-[var(--accent)] transition-all"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        >
          <DraftIcon name="arrow-up" className="text-2xl" />
          <span className="text-xs font-bold tracking-[0.3em] uppercase">回到顶部</span>
        </button>
      </div>

      <footer className="bg-white border-t border-[var(--line)] py-16">
        <div className="flex flex-col md:flex-row justify-between gap-12">
          <div className="max-w-xs space-y-4">
            <div className="flex items-center gap-3">
              <span className="w-6 h-6 bg-[#1F4772] text-white flex items-center justify-center font-serif font-black text-xs rounded-sm">R</span>
              <span className="font-serif text-[#16263D] font-bold tracking-tight">ResearchPilot</span>
            </div>
            <p className="text-xs text-[var(--fg-3)] leading-relaxed">
              研究方法梳理工具。上面每一条都写明来源与状态，没有排期的承诺一律不写。
            </p>
            <button
              type="button"
              className="inline-flex items-center gap-2 text-xs font-bold text-[var(--fg-3)] hover:text-[var(--accent)] transition-colors"
              onClick={onBack}
            >
              <DraftIcon name="arrow-up" style={{ transform: 'rotate(-90deg)' }} />
              返回
            </button>
          </div>
          <div className="flex gap-20">
            <div className="space-y-4">
              <h4 className="text-xs font-bold uppercase tracking-widest text-[var(--fg-3)]">快捷链接</h4>
              <nav className="flex flex-col gap-2">
                <button type="button" className="text-sm text-[var(--fg-2)] hover:text-[var(--accent)] text-left" onClick={() => onGo('landing')}>
                  首页
                </button>
                <button type="button" className="text-sm text-[var(--fg-2)] hover:text-[var(--accent)] text-left" onClick={() => onGo('library')}>
                  论文集合
                </button>
                <button type="button" className="text-sm text-[var(--fg-2)] hover:text-[var(--accent)] text-left" onClick={() => onGo('version')}>
                  版本信息
                </button>
              </nav>
            </div>
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
        <div className="mt-16 pt-8 border-t border-[var(--bg-4)] flex justify-between items-center text-[10px] text-[var(--fg-3)] uppercase font-bold tracking-widest">
          <span>© 2026 ResearchPilot · 深圳大学「啥名字好」队</span>
          <span>只写真实状态</span>
        </div>
      </footer>
    </div>
  );
}
