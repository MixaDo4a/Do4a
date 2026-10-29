import assert from "node:assert/strict";
import test from "node:test";
import { resolveAcademyPayRate } from "./pay-rates.ts";

const initial = {
  id: 1,
  level: 4,
  effective_from: "2026-11-01",
  hourly_rate: 280,
  base_commission_percent: 2,
  plan_commission_percent: 2,
};

test("uses the latest rate effective by the payroll month", () => {
  const later = { ...initial, id: 2, effective_from: "2027-01-01", hourly_rate: 300 };
  assert.equal(resolveAcademyPayRate([later, initial], 4, "2026-12-01")?.hourly_rate, 280);
  assert.equal(resolveAcademyPayRate([initial, later], 4, "2027-01-01")?.hourly_rate, 300);
});

test("latest revision wins when a month is corrected", () => {
  const corrected = { ...initial, id: 3, hourly_rate: 290 };
  assert.equal(resolveAcademyPayRate([initial, corrected], 4, "2026-11-01")?.hourly_rate, 290);
});

test("does not use future rates or another level", () => {
  assert.equal(resolveAcademyPayRate([initial], 4, "2026-10-01"), null);
  assert.equal(resolveAcademyPayRate([initial], 5, "2026-11-01"), null);
});
