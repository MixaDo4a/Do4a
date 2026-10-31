import test from "node:test";
import assert from "node:assert/strict";
import { forecastStorePlan } from "./store-plan-forecast.ts";

function row(period, revenue, receipts = 100, itemsSold = 200, extra = {}) {
  return {
    period, revenue, returns: 0, receipts, itemsSold, activeDays: 30,
    missingRevenue: 0, missingReceipts: 0, missingItems: 0, ...extra,
  };
}

test("revenue target adjusts the same prior-year month by current YTD trend, then adds 10%", () => {
  const rows = [
    row("2025-01", 100), row("2026-01", 80),
    row("2025-02", 100), row("2026-02", 80),
    row("2025-03", 100), row("2026-03", 80),
    row("2025-04", 1_000),
  ];
  assert.equal(forecastStorePlan("Калинина", "2026-04", rows).sales, 880);
});

test("November forecasts reproduce the approved 2025 November x Jan-October trend x 1.10 rule", () => {
  const cases = [
    { name: "Калинина", priorYtd: 20_115_907, currentYtd: 15_968_928.99, priorNovember: 1_884_462, expected: 1_645_570 },
    { name: "Ленинградская", priorYtd: 34_481_127, currentYtd: 27_308_658.39, priorNovember: 3_099_144, expected: 2_699_935 },
    { name: "Наутилус", priorYtd: 8_020_591, currentYtd: 9_296_264, priorNovember: 850_457, expected: 1_084_294 },
  ];
  for (const item of cases) {
    const rows = [];
    for (let month = 1; month <= 10; month += 1) {
      const key = String(month).padStart(2, "0");
      rows.push(row(`2025-${key}`, item.priorYtd / 10));
      rows.push(row(`2026-${key}`, item.currentYtd / 10));
    }
    rows.push(row("2025-11", item.priorNovember));
    assert.equal(forecastStorePlan(item.name, "2026-11", rows).sales, item.expected);
  }
});

test("Urban uses recent full-month daily trend and a 500,000 ruble floor", () => {
  const rows = [row("2026-09", 364_353), row("2026-10", 429_512, 100, 200, { activeDays: 31 })];
  const target = forecastStorePlan("Урбан", "2026-11", rows);
  assert.equal(target.sales, 521_603);
  assert.equal(forecastStorePlan("Урбан", "2026-11", [row("2026-10", 100_000, 10, 20, { activeDays: 31 })]).sales, 500_000);
});

test("KPI defaults use the median of the latest three prior same-year months plus 1%", () => {
  const rows = [row("2026-07", 100, 10, 20), row("2026-08", 200, 10, 30), row("2026-09", 300, 10, 40), row("2026-10", 400, 10, 50)];
  const target = forecastStorePlan("Калинина", "2026-11", rows);
  assert.equal(target.averageCheck, 30.3);
  assert.equal(target.checkDepth, 4.04);
});
