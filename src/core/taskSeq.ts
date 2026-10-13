/**
 * 任务版本号（task sequence）的唯一实现。
 *
 * 为什么单独成文件：这是本项目里**最容易写错、且写错后症状极具欺骗性**的一小段逻辑。
 *
 * 背景：抽取是一次几十秒的网络等待。等待期间用户可能删掉论文、重新解析、或再次发起抽取，
 * 因此每个在途任务都要带一个版本号，返回时比对：「我还是最新的吗？」不是就作废、不写库。
 *
 * ⚠️ 真实踩过的坑（2026-10-13，用户报「提取卡住、反复点一样」）：
 * 版本号最初写成 `const seq = ++extractSeq.current[paperId]`。
 * 某篇论文**第一次**抽取时，这个键还不存在 ⇒ `++undefined` ⇒ **NaN**；
 * 于是「我是最新的吗」里的 `NaN === NaN` 恒为 **false** ⇒ **每一次首次抽取都被判成过期丢弃**。
 * 模型其实 10 秒就返回了结果（日志里能看到「校验：字段有值 6/7…」），界面却永远停在「提取中」。
 *
 * 教训有两条，都体现在这里的实现上：
 * 1. 自增必须显式从 0 起算（`(值 ?? 0) + 1`），不要用 `++obj[key]`；
 * 2. 比对必须**先确认版本号是有限数** —— 否则任何一次 NaN 都会让判定静默恒假，
 *    表现为「功能整个不工作但没有任何报错」，比抛异常难查得多。
 */

/** 取下一个版本号并写回 map（对同一个 key 单调递增） */
export function bumpSeq(map: Record<string, number>, key: string): number {
  const next = (map[key] ?? 0) + 1;
  map[key] = next;
  return next;
}

/**
 * 这个版本号是否仍然是该 key 的最新版本。
 *
 * `NaN` 一律判 false（并且这是**唯一**会返回 false 的「非过期」情形）：
 * 宁可让调用方看到明确的「已过期」，也不要让 NaN 悄悄把结果全丢掉。
 */
export function seqIsCurrent(map: Record<string, number>, key: string, seq: number): boolean {
  if (!Number.isFinite(seq)) return false;
  return map[key] === seq;
}
