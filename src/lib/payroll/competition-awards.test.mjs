import assert from "node:assert/strict";
import test from "node:test";
import { calculateStoreContestAwards } from "./competition-awards.ts";

const entry = (employeeId, overrides = {}) => ({
  employeeId,
  level: 5,
  confirmedShiftCount: 3,
  netRevenueCents: 100_000,
  receiptCount: 10,
  itemsSoldCount: 20,
  ...overrides,
});

test("no contest is held without at least two qualified employees", () => {
  const result = calculateStoreContestAwards([entry("a")]);
  assert.deepEqual(result.averageCheckWinners, []);
  assert.deepEqual(result.checkDepthWinners, []);
  assert.equal(result.awardsCents.size, 0);
});

test("only employees with three confirmed shifts participate in each store contest", () => {
  const result = calculateStoreContestAwards([
    entry("a", { netRevenueCents: 500_000, itemsSoldCount: 40 }),
    entry("b", { confirmedShiftCount: 2 }),
    entry("c", { netRevenueCents: 50_000, itemsSoldCount: 10 }),
  ]);
  assert.deepEqual(result.averageCheckWinners, ["a"]);
  assert.equal(result.awardsCents.get("a"), 300_000);
});

test("ties split each metric's 1000 ruble pool and leave remainder kopeks unallocated", () => {
  const result = calculateStoreContestAwards([
    entry("a", { netRevenueCents: 100_000, itemsSoldCount: 30 }),
    entry("b", { netRevenueCents: 100_000, itemsSoldCount: 30 }),
    entry("c", { netRevenueCents: 100_000, itemsSoldCount: 30 }),
  ]);
  assert.deepEqual(result.averageCheckWinners, ["a", "b", "c"]);
  assert.deepEqual(result.checkDepthWinners, ["a", "b", "c"]);
  for (const amount of result.awardsCents.values()) assert.equal(amount, 66_666);
  assert.equal([...result.awardsCents.values()].reduce((sum, amount) => sum + amount, 0), 199_998);
});

test("LVL3-4 employees are not eligible to compete", () => {
  const result = calculateStoreContestAwards([
    entry("lvl4", { level: 4, netRevenueCents: 200_000, itemsSoldCount: 30 }),
    entry("lvl5", { itemsSoldCount: 40 }),
  ]);
  assert.deepEqual(result.averageCheckWinners, []);
  assert.deepEqual(result.checkDepthWinners, []);
  assert.equal(result.awardsCents.size, 0);
});

test("a unique winner of both metrics gets the additional 1000 ruble double-win award", () => {
  const result = calculateStoreContestAwards([
    entry("a", { netRevenueCents: 200_000, itemsSoldCount: 40 }),
    entry("b"),
  ]);
  assert.equal(result.awardsCents.get("a"), 300_000);
});

test("each store is calculated independently so awards can be summed across stores", () => {
  const first = calculateStoreContestAwards([entry("a", { netRevenueCents: 200_000, itemsSoldCount: 40 }), entry("b")]);
  const second = calculateStoreContestAwards([entry("a", { netRevenueCents: 200_000, itemsSoldCount: 40 }), entry("c")]);
  assert.equal((first.awardsCents.get("a") ?? 0) + (second.awardsCents.get("a") ?? 0), 600_000);
});
