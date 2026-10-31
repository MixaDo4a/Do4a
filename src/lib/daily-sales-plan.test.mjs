import test from "node:test";
import assert from "node:assert/strict";
import { calculateDailySalesPlan } from "./daily-sales-plan.ts";

test("uses same-month history from the previous three years and handles leap-year differences", () => {
  const historicalRows = [2023, 2024, 2025].flatMap((year) => {
    const count = new Date(Date.UTC(year, 2, 0)).getUTCDate();
    return Array.from({ length: count }, (_, index) => ({
      date: `${year}-02-${String(index + 1).padStart(2, "0")}`,
      revenue: 100,
      returns: 0,
    }));
  });

  const result = calculateDailySalesPlan({
    period: "2026-02",
    targetDate: "2026-02-01",
    monthlyPlan: 28_000,
    historicalRows,
    actualRows: [],
  });

  assert.equal(result.basis, "history");
  assert.deepEqual(result.years, [2025, 2024, 2023]);
  assert.ok(Math.abs(result.target - 1_000) < 0.001);
});

test("reallocates remaining monthly target over scheduled days after closed-shift sales", () => {
  const result = calculateDailySalesPlan({
    period: "2026-11",
    targetDate: "2026-11-02",
    monthlyPlan: 3_000,
    historicalRows: [],
    actualRows: [{ date: "2026-11-01", netRevenue: 700 }],
    scheduledDates: ["2026-11-01", "2026-11-02", "2026-11-04"],
  });

  assert.equal(result.basis, "schedule");
  assert.equal(result.monthlyRemaining, 2_300);
  assert.equal(result.target, 1_150);
});

test("falls back to the calendar when there is no history or published schedule", () => {
  const result = calculateDailySalesPlan({
    period: "2026-11",
    targetDate: "2026-11-01",
    monthlyPlan: 30_000,
    historicalRows: [],
    actualRows: [],
  });

  assert.equal(result.basis, "calendar");
  assert.ok(Math.abs(result.target - 1_000) < 0.001);
});
