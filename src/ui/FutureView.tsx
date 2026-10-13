import React, { useMemo, useState } from 'react';
import { DraftIcon } from '../draft-icons';
import { downloadText } from './common';

/**
 * 未来展望与功能建议（草稿 4bdccae1 v1）
 *
 * 结构、标题、文案、页脚逐段照搬草稿；只有**会变成假话的部分**才改，逐处注明：
 * - 草稿整页建立在「多用户后端」上（投票计数、社群排行）。本作品是纯静态单机应用，
 *   所以票数从 **0** 开始：0 是真实数字（别人投不了，因为根本没有服务器），
 *   你点一次变 1，那一票也只存在你自己的浏览器里。区块导语里把这句话写清楚，不装成全站统计。
 * - 草稿卡片上的「预计 2024.05 发布」与进度条 75% / 40%：日期是编的、我们没有排期 ⇒
 *   去掉日期；进度换成真实可数的「已完成 X / 共 Y 项」。
 * - 草稿「已采纳的智慧」用虚构用户（@学术小王 · 研究生 · CS）⇒ **按用户要求整块删除**，
 *   等有真实素材了再单独建。
 * - 草稿「星辰大海」是三张虚线卡（未来计划）⇒ 按用户要求：把这块名字用在**有投票的那张列表**上，
 *   虚线卡整块删除。
 * - 页脚草稿是 `feedback@researchpilot.ai` / `Twitter / X` 两个假链接 ⇒
 *   保留两列结构与标题，内容换成真实可达的入口（站内页面 + 源码仓库）。
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

/** 进行中：草稿的「预计发布」与百分比进度换成真实可数的项数 */
const IN_PROGRESS: {
  title: string;
  state: 'done' | 'doing' | 'pending';
  stateText: string;
  sub: string;
  desc: string;
  done: number;
  total: number;
  unit: string;
}[] = [
  {
    title: '把页面统一到同一份设计稿',
    state: 'done',
    stateText: '已完成',
    sub: '决赛打磨轮',
    desc: '方法提取、分析结果、研究地图、跨论文对比表、阅读路线、待调查问题、版本信息、未来展望八页已用同一套视觉语言；研究地图收口成网络视图 + 时间线，跨页出口统一放到右下角动线枢纽。',
    done: 8,
    total: 8,
    unit: '页',
  },
  {
    title: '已知缺陷与体验缺口',
    state: 'pending',
    stateText: '待排期',
    sub: '尚未排期',
    desc: '实验条件缺键时静默通过、390px 下地图详情抽屉底边溢出、窄屏横向溢出（站级栅格问题）、分歧分析编排入口缺回归测试、3 分钟演示视频成品 —— 五项都还没做，页面上不做任何「即将支持」的承诺。',
    done: 0,
    total: 5,
    unit: '项',
  },
];

/** 「星辰大海」：草稿这里是一张投票排行表，条目内容换成我们真实的缺口，票数从 0 开始 */
const WISHES: { id: string; title: string; desc: string; note: string }[] = [
  {
    id: 'latex',
    title: '支持 LaTeX 源码直接解析',
    desc: '现在只能吃 PDF 文本层与纯文本。想直接上传 .tex 或 zip，就得先有 LaTeX 解析器（公式与表格引用关系目前拿不到）。',
    note: '缺 LaTeX 解析器',
  },
  {
    id: 'qa',
    title: '跨论文问答',
    desc: '现在只做字段抽取与关系判定，没有「对着已上传的几篇论文提问」。要做需要稳定的上下文拼装与检索，且答案必须能回到原文。',
    note: '缺检索与引用回溯',
  },
  {
    id: 'mobile',
    title: '窄屏与手机适配',
    desc: '已知是站级问题：12 栏栅格加上固定间距，在窄视口会横向溢出约 144px。得先统一栅格才能收口。',
    note: '需先统一栅格',
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

  const marked = useMemo(() => new Set(marks), [marks]);

  /** 投票：0 → 1。这一票只落在你自己的浏览器里 */
  const vote = (id: string) => {
    setMarks((prev) => {
      const next = prev.includes(id) ? prev : [...prev, id];
      saveMarks(next);
      return next;
    });
  };

  const resetVotes = () => {
    setMarks([]);
    saveMarks([]);
  };

  /** 导出：把本机这一票写成 Markdown 带走（草稿的「提交你的建议」没有后端，落到导出上） */
  const exportMarks = () => {
    const picked = WISHES.filter((w) => marked.has(w.id));
    const lines: string[] = [];
    lines.push('# ResearchPilot · 我投票的方向');
    lines.push('');
    lines.push(
      '> 这份清单由 ResearchPilot 在本机生成。下面是你在这台浏览器上投过的方向 —— **它不是全站统计**，' +
        '别人投不了，也看不到：这是一个没有服务端的单机应用，页面上的票数只可能来自你自己。',
    );
    lines.push(`> 导出时间：${new Date().toLocaleString('zh-CN')}`);
    lines.push('');
    lines.push(`## 我投过的方向（${picked.length} 条）`);
    lines.push('');
    if (picked.length === 0) {
      lines.push('（还没有投过任何方向）');
    } else {
      for (const w of picked) {
        lines.push(`- **${w.title}** —— ${w.note}`);
        lines.push(`  ${w.desc}`);
      }
    }
    lines.push('');
    lines.push(`## 全部方向（${WISHES.length} 条）`);
    lines.push('');
    for (const [i, w] of WISHES.entries()) {
      lines.push(`${i + 1}. ${marked.has(w.id) ? '[已投] ' : ''}${w.title} —— ${w.note}`);
    }
    lines.push('');
    downloadText('researchpilot-我投票的方向.md', lines.join('\n'), 'text/markdown');
  };

  return (
    <div className="futpage sdpage">
      <section className="mb-20 text-center">
        <div className="inline-block px-4 py-1.5 bg-[var(--bg-4)] rounded-full text-[10px] font-bold tracking-[0.2em] text-[var(--fg-3)] uppercase mb-6">
          Feature Requests &amp; Roadmap
        </div>
        <h1 className="text-6xl font-serif font-black tracking-tight mb-6 leading-tight">
          由你的建议驱动
          <br />
          我们的演进
        </h1>
        <p className="text-xl text-[var(--fg-2)] max-w-2xl mx-auto mb-10">
          ResearchPilot 不只是一次性的分析工具。下面是想做但还没做的方向，你可以投一票 —— 那一票会存在你自己的浏览器里。
        </p>
        <div className="flex justify-center gap-4">
          <button type="button" id="cta-submit-idea" className="btn-primary flex items-center gap-2" onClick={exportMarks}>
            <DraftIcon name="plus-circle" />
            提交你的建议
          </button>
          <a
            href="#top-requests"
            id="cta-view-requests"
            className="px-8 py-3 rounded-[var(--radius-sm)] border border-[var(--line-2)] font-bold text-[var(--fg-2)] hover:bg-white transition-all flex items-center"
            onClick={(e) => {
              e.preventDefault();
              document.getElementById('top-requests')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
          >
            查看热门需求
          </a>
        </div>
      </section>

      <section className="mb-24">
        <div className="flex items-center gap-4 mb-10">
          <h2 className="text-3xl font-bold">正在锻造</h2>
          <span className="h-[1px] flex-1 bg-[var(--line)]" />
          <span className="text-xs font-bold text-[var(--fg-3)] uppercase tracking-widest">IN THE FORGE</span>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {IN_PROGRESS.map((p) => {
            const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
            const color = p.state === 'pending' ? 'var(--progress-yellow)' : 'var(--progress-green)';
            return (
              <div key={p.title} className="content-card relative overflow-hidden">
                <div className="flex justify-between items-start mb-6">
                  <div className="space-y-1">
                    <h3 className="text-xl font-bold">{p.title}</h3>
                    <p className="text-sm text-[var(--fg-3)]">{p.sub}</p>
                  </div>
                  <span
                    className="px-3 py-1 text-[10px] font-bold rounded-full border"
                    style={{
                      background: p.state === 'done' ? 'var(--ok-soft)' : p.state === 'doing' ? 'var(--warn-soft)' : 'var(--bg-3)',
                      color: p.state === 'done' ? 'var(--ok)' : p.state === 'doing' ? 'var(--warn)' : 'var(--fg-3)',
                      borderColor: p.state === 'done' ? 'var(--ok-soft)' : p.state === 'doing' ? 'var(--warn-soft)' : 'var(--line)',
                    }}
                  >
                    {p.stateText}
                  </span>
                </div>
                <p className="text-[var(--fg-2)] mb-8 leading-relaxed">{p.desc}</p>
                <div className="space-y-3">
                  <div className="flex justify-between text-xs font-bold">
                    <span>开发进度</span>
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

      <section id="top-requests" className="mb-24">
        <div className="flex items-center gap-4 mb-4">
          <h2 className="text-3xl font-bold">星辰大海</h2>
          <span className="h-[1px] flex-1 bg-[var(--line)]" />
          <span className="text-xs font-bold text-[var(--fg-3)] uppercase tracking-widest">COMING SOON</span>
        </div>
        <p className="text-sm text-[var(--fg-3)] mb-10">
          下面三条是真实缺口，都还没开始。票数从 0 起：这是一个没有服务端的单机应用，别人投不了 ——
          你看到的每一个「1」都是你自己这一票，它只存在在这台浏览器里。
          {marks.length > 0 && (
            <button type="button" className="ml-2 text-[var(--accent)] font-bold hover:underline" onClick={resetVotes}>
              重置我的投票（{marks.length}）
            </button>
          )}
        </p>
        <div className="bg-white rounded-[var(--radius)] border border-[var(--line)] shadow-sm overflow-hidden">
          <div className="divide-y divide-[var(--line)]">
            {WISHES.map((w, i) => {
              const voted = marked.has(w.id);
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
                    <span className="text-xs font-bold text-[var(--fg-2)]">
                      {voted ? 1 : 0} 人想要 · {w.note}
                    </span>
                    <button
                      type="button"
                      id={`vote-${w.id}`}
                      className={`btn-vote flex items-center gap-2${voted ? ' on' : ''}`}
                      disabled={voted}
                      onClick={() => vote(w.id)}
                    >
                      {/* 草稿点完把图标换成 lucide:check */}
                      <DraftIcon name={voted ? 'check' : 'arrow-up-circle'} />
                      {voted ? '已投票' : '我也想要'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* 草稿末尾：整块居中的「回到顶部」（箭头 hover 上移） */}
      <div className="flex flex-col items-center py-20 border-t border-[var(--line)]">
        <button
          type="button"
          id="back-to-top"
          className="group flex flex-col items-center gap-4 text-[var(--fg-3)] hover:text-[var(--accent)] transition-all"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        >
          <DraftIcon name="arrow-up" className="text-2xl transition-transform group-hover:-translate-y-2" />
          <span className="text-xs font-bold tracking-[0.3em] uppercase">回到顶部</span>
        </button>
      </div>

      {/* 草稿页脚：白底全宽、内容 1200px 居中、左品牌 + 右两列 + 底部一行。
          假邮箱 / Twitter 换成真实可达的入口（联系方式这个位置放源码仓库）。 */}
      <footer className="bg-white border-t border-[var(--line)] py-16">
        <div className="max-w-[1200px] mx-auto px-10 flex flex-col md:flex-row justify-between gap-12">
          <div className="max-w-xs space-y-4">
            <div className="flex items-center gap-3">
              <span className="rp-wordmark w-6 h-6 bg-[#1F4772] text-white flex items-center justify-center font-black text-xs rounded-sm">R</span>
              <span className="rp-wordmark text-[#16263D] font-bold tracking-tight">ResearchPilot</span>
            </div>
            <p className="text-xs text-[var(--fg-3)] leading-relaxed">
              由 AI 驱动的研究方法梳理智能体，按真实缺口持续打磨。
            </p>
          </div>
          <div className="flex gap-20">
            <div className="space-y-4">
              <h4 className="text-xs font-bold uppercase tracking-widest text-[var(--fg-3)]">快捷链接</h4>
              <nav className="flex flex-col gap-2">
                <button type="button" className="text-sm text-[var(--fg-2)] hover:text-[var(--accent)] text-left" onClick={() => onGo('landing')}>
                  首页
                </button>
                <button type="button" className="text-sm text-[var(--fg-2)] hover:text-[var(--accent)] text-left" onClick={() => onGo('library')}>
                  论文库
                </button>
                <button type="button" className="text-sm text-[var(--fg-2)] hover:text-[var(--accent)] text-left" onClick={() => onGo('version')}>
                  版本信息
                </button>
              </nav>
            </div>
            <div className="space-y-4">
              <h4 className="text-xs font-bold uppercase tracking-widest text-[var(--fg-3)]">联系方式</h4>
              <nav className="flex flex-col gap-2">
                <a href={REPO_URL} target="_blank" rel="noreferrer" className="text-sm text-[var(--fg-2)] hover:text-[var(--accent)]">
                  源码仓库（提 issue）
                </a>
                <button type="button" className="text-sm text-[var(--fg-2)] hover:text-[var(--accent)] text-left" onClick={onBack}>
                  返回上一页
                </button>
              </nav>
            </div>
          </div>
        </div>
        <div className="max-w-[1200px] mx-auto px-10 mt-16 pt-8 border-t border-[var(--bg-4)] flex justify-between items-center text-[10px] text-[var(--fg-3)] uppercase font-bold tracking-widest">
          <span>© 2026 ResearchPilot. FOR BETTER RESEARCH.</span>
          <span>Next Evolution</span>
        </div>
      </footer>
    </div>
  );
}
