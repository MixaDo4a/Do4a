import assert from "node:assert/strict";
import test from "node:test";
import { resolveCityPayrollMode } from "./city-payroll-mode.ts";

const row = (city, effective_from, calculation_mode, created_at = `${effective_from}T00:00:00Z`, id = 1) => ({
  city,
  effective_from,
  calculation_mode,
  created_at,
  id,
});

test("defaults cities to legacy until an effective mode is configured", () => {
  assert.equal(resolveCityPayrollMode([], "Хабаровск", "2026-11"), "legacy");
  assert.equal(resolveCityPayrollMode([row("Владивосток", "2026-11-01", "academy")], "Хабаровск", "2026-11"), "legacy");
});

test("keeps old months on their prior mode and applies a switch from its selected month", () => {
  const history = [row("Хабаровск", "2026-11-01", "academy")];
  assert.equal(resolveCityPayrollMode(history, "Хабаровск", "2026-10"), "legacy");
  assert.equal(resolveCityPayrollMode(history, "Хабаровск", "2026-11"), "academy");
  assert.equal(resolveCityPayrollMode(history, "Хабаровск", "2026-12"), "academy");
});

test("uses the latest saved mode when multiple decisions start in the same month", () => {
  const history = [
    row("Хабаровск", "2026-11-01", "academy", "2026-10-29T10:00:00Z", 1),
    row("Хабаровск", "2026-11-01", "legacy", "2026-10-29T11:00:00Z", 2),
  ];
  assert.equal(resolveCityPayrollMode(history, "Хабаровск", "2026-11"), "legacy");
});

test("rejects malformed payroll month", () => {
  assert.throws(() => resolveCityPayrollMode([], "Хабаровск", "2026-11-01"));
});
