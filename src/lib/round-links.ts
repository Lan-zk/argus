// 跨轮对比引擎（review-versioning design D5，tasks 3.2/3.3/3.4）。
// L1 即时·确定性：旧 finding 的 quote 在新文档中的匹配 → unresolved/edited/ambiguous；
// L2 审阅后·概率性：新旧 findings 匹配（hash 精确 → 位置邻近 + 文本相似度合成 confidence）→ recurring。
// 阈值为 spike 结论（SAMPLE_DOC 三粒度样本：改词 → ambiguous、改句/重写 → edited、挪段 → unresolved），
// 集中定义便于迭代。

import type { FindingLinkRow, FindingRow, Repo, RoundSnapshot } from "./repo/types";
import { normText } from "../domain/normalize";
import { bigramSimilarity, bestWindowMatch } from "../domain/textsim";
import { buildLineDiff, mappedDistance } from "../domain/rounddiff";

/** L1：句窗 bigram ≥ 此值 → 待确认（ambiguous）；否则已修改（edited）。原文精确包含 → 未动。 */
export const L1_AMBIGUOUS_MIN = 0.55;
/** L2：置信度 ≥ 此值判定疑似遗留（recurring）。 */
export const L2_LINK_MIN = 0.45;
/** contentHash 精确命中时的置信度下限。 */
export const L2_HASH_CONFIDENCE = 0.95;

function classifyL1(quote: string, currText: string): FindingLinkRow["linkType"] {
  if (normText(currText).includes(normText(quote))) return "unresolved";
  const { best } = bestWindowMatch(quote, currText);
  return best >= L1_AMBIGUOUS_MIN ? "ambiguous" : "edited";
}

function l2Confidence(
  prev: FindingRow,
  curr: FindingRow,
  diff: ReturnType<typeof buildLineDiff>,
): number {
  if (prev.contentHash && curr.contentHash && prev.contentHash === curr.contentHash) {
    return L2_HASH_CONFIDENCE;
  }
  // 位置邻近：旧问题行映射到新文档后与候选问题行的距离（不可映射记 0，交由文本信号）
  let posScore = 0;
  if (prev.line != null && curr.line != null) {
    const d = mappedDistance(diff, prev.line, curr.line);
    if (d != null) posScore = 1 / (1 + d / 5);
  }
  const titleSim = bigramSimilarity(prev.title, curr.title);
  const problemSim = bigramSimilarity(prev.problem, curr.problem);
  return 0.35 * posScore + 0.4 * titleSim + 0.25 * problemSim;
}

/**
 * 重算一轮的跨轮对比（对上一轮）：先清空该轮 links（级联作废），
 * 写入 L1（上轮全部 findings 的去向）+ L2（疑似遗留，允许一个旧问题对应多条新 finding）。
 */
export async function recomputeRoundLinks(repo: Repo, prevRoundId: string, currRoundId: string): Promise<void> {
  const prev = await repo.loadRound(prevRoundId);
  const curr = await repo.loadRound(currRoundId);
  if (!prev || !curr) return;
  await repo.deleteLinksByRound(currRoundId);

  const now = new Date().toISOString();
  const rows: FindingLinkRow[] = [];

  // L1：确定性（不调用模型）
  for (const f of prev.findings) {
    rows.push({
      prevFindingId: f.id,
      currRoundId,
      linkType: classifyL1(f.quote, curr.document.text),
      computedAt: now,
    });
  }

  // L2：概率性（同类内匹配；hash 精确 → 位置 + 文本相似度合成）
  const diff = buildLineDiff(prev.document.text, curr.document.text);
  for (const currF of curr.findings) {
    for (const prevF of prev.findings) {
      if (prevF.categoryId !== currF.categoryId) continue;
      const confidence = l2Confidence(prevF, currF, diff);
      if (confidence >= L2_LINK_MIN) {
        rows.push({
          prevFindingId: prevF.id,
          currRoundId,
          linkType: "recurring",
          currFindingId: currF.id,
          confidence,
          computedAt: now,
        });
      }
    }
  }

  if (rows.length > 0) await repo.insertLinks(rows);
}

/** 找相邻轮对并重算（重跑后级联）。返回是否发生了重算。 */
export async function recomputeAdjacentLinks(repo: Repo, projectId: string, roundNumber: number): Promise<boolean> {
  const rounds = await repo.listRounds(projectId);
  const prev = rounds.find((r) => r.number === roundNumber - 1);
  const curr = rounds.find((r) => r.number === roundNumber);
  if (!prev || !curr) return false;
  await recomputeRoundLinks(repo, prev.id, curr.id);
  return true;
}

/** 删除轮次后：以删除位两侧最近的剩余轮为新相邻对补算（编号不再连续）。 */
export async function recomputeAfterDeletion(repo: Repo, projectId: string, deletedNumber: number): Promise<boolean> {
  const rounds = await repo.listRounds(projectId);
  const prev = [...rounds].filter((r) => r.number < deletedNumber).sort((a, b) => b.number - a.number)[0];
  const curr = [...rounds].filter((r) => r.number > deletedNumber).sort((a, b) => a.number - b.number)[0];
  if (!prev || !curr) return false;
  await recomputeRoundLinks(repo, prev.id, curr.id);
  return true;
}

/** 轮内单类重跑级联：该轮作为 curr 的一对重算；若存在下一轮，其以本轮为 prev 的 links 也重算。 */
export async function cascadeRerunLinks(repo: Repo, projectId: string, roundNumber: number): Promise<void> {
  await recomputeAdjacentLinks(repo, projectId, roundNumber);
  const rounds = await repo.listRounds(projectId);
  const next = rounds.find((r) => r.number === roundNumber + 1);
  const curr = rounds.find((r) => r.number === roundNumber);
  if (next && curr) await recomputeRoundLinks(repo, curr.id, next.id);
}

export type { RoundSnapshot };
