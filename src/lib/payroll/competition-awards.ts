export type StoreContestEntry = {
  employeeId: string;
  level: number;
  confirmedShiftCount: number;
  netRevenueCents: number;
  receiptCount: number;
  itemsSoldCount: number | null;
};

export type StoreContestAwards = {
  averageCheckWinners: string[];
  checkDepthWinners: string[];
  awardsCents: Map<string, number>;
};

const PRIZE_CENTS = 100_000;
const DOUBLE_WIN_BONUS_CENTS = 100_000;

function splitPrize(entries: StoreContestEntry[], metric: "average" | "depth"): string[] {
  const scored = entries.filter((entry) =>
    entry.level >= 5
    && entry.confirmedShiftCount >= 3
    && entry.receiptCount > 0
    && (metric !== "depth" || entry.itemsSoldCount !== null),
  );
  if (scored.length < 2) return [];

  const getNumerator = (entry: StoreContestEntry) =>
    metric === "average" ? entry.netRevenueCents : entry.itemsSoldCount!;
  let bestEntry = scored[0];
  const winners = [bestEntry.employeeId];

  for (const entry of scored.slice(1)) {
    const value = BigInt(getNumerator(entry)) * BigInt(bestEntry.receiptCount);
    const bestValue = BigInt(getNumerator(bestEntry)) * BigInt(entry.receiptCount);
    if (value > bestValue) {
      bestEntry = entry;
      winners.splice(0, winners.length, entry.employeeId);
    } else if (value === bestValue && entry.employeeId !== bestEntry.employeeId) {
      winners.push(entry.employeeId);
    }
  }
  return winners;
}

function addPrizeShares(
  winners: string[],
  entries: StoreContestEntry[],
  awards: Map<string, number>,
) {
  if (!winners.length) return;
  const share = Math.floor(PRIZE_CENTS / winners.length);
  for (const employeeId of winners) {
    const entry = entries.find((candidate) => candidate.employeeId === employeeId);
    if (entry && entry.level >= 5) {
      awards.set(employeeId, (awards.get(employeeId) ?? 0) + share);
    }
  }
}

export function calculateStoreContestAwards(entries: StoreContestEntry[]): StoreContestAwards {
  const ids = new Set<string>();
  for (const entry of entries) {
    if (!entry.employeeId || ids.has(entry.employeeId)
      || !Number.isInteger(entry.level) || entry.level < 1 || entry.level > 10
      || !Number.isInteger(entry.confirmedShiftCount) || entry.confirmedShiftCount < 0
      || !Number.isSafeInteger(entry.netRevenueCents)
      || !Number.isSafeInteger(entry.receiptCount) || entry.receiptCount < 0
      || entry.itemsSoldCount !== null && (!Number.isSafeInteger(entry.itemsSoldCount) || entry.itemsSoldCount < 0)) {
      throw new Error("Invalid store contest entry");
    }
    ids.add(entry.employeeId);
  }

  const averageCheckWinners = splitPrize(entries, "average");
  const checkDepthWinners = splitPrize(entries, "depth");
  const awardsCents = new Map<string, number>();
  addPrizeShares(averageCheckWinners, entries, awardsCents);
  addPrizeShares(checkDepthWinners, entries, awardsCents);

  if (averageCheckWinners.length === 1
    && checkDepthWinners.length === 1
    && averageCheckWinners[0] === checkDepthWinners[0]) {
    const winner = entries.find((entry) => entry.employeeId === averageCheckWinners[0]);
    if (winner && winner.level >= 5) {
      awardsCents.set(winner.employeeId, (awardsCents.get(winner.employeeId) ?? 0) + DOUBLE_WIN_BONUS_CENTS);
    }
  }

  return { averageCheckWinners, checkDepthWinners, awardsCents };
}
