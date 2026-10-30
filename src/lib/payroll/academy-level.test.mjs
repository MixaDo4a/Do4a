import assert from "node:assert/strict";
import test from "node:test";
import { resolveAcademyPayLevel } from "./academy-level.ts";

const rank = (level, effectiveFrom, confirmedAt = "2026-10-15T10:00:00Z") => ({
  id: `${level}-${effectiveFrom}`,
  user_id: "employee-user",
  rank: level,
  confirmed_at: confirmedAt,
  pay_effective_from: effectiveFrom,
  timezone_name: "Asia/Vladivostok",
});

const createdBeforeCutoff = "2026-10-31T13:59:59Z";
const createdAtCutoff = "2026-10-31T14:00:00Z";
const zone = "Asia/Vladivostok";
const resolve = (history, month, createdAt = createdBeforeCutoff) =>
  resolveAcademyPayLevel(history, month, createdAt, zone);

test("legacy employees have a LVL3 payroll floor starting in November", () => {
  assert.deepEqual(resolve([], "2026-11-01"), {
    status: "ready", level: 3, source: "legacy_floor", history: null,
  });
  assert.equal(resolve([], "2026-10-01").level, 1);
});

test("employees created on or after November 1 start at payroll LVL1 without history", () => {
  assert.deepEqual(resolve([], "2026-11-01", createdAtCutoff), {
    status: "ready", level: 1, source: "default", history: null,
  });
});

test("missing Academy profile still uses the employee creation rule", () => {
  assert.equal(resolve([], "2026-11-01", createdBeforeCutoff).level, 3);
  assert.equal(resolve([], "2026-11-01", createdAtCutoff).level, 1);
});

test("creation cutoff uses the store time zone", () => {
  assert.equal(resolveAcademyPayLevel([], "2026-11-01", createdAtCutoff, "Europe/Moscow").level, 3);
  assert.equal(resolveAcademyPayLevel([], "2026-11-01", createdAtCutoff, zone).level, 1);
});

test("applies a confirmed level only from its effective month", () => {
  const history = [rank(5, "2026-12-01"), rank(2, "2026-09-01")];
  assert.equal(resolve(history, "2026-10-01").level, 2);
  assert.equal(resolve(history, "2026-11-01").level, 3);
  assert.equal(resolve(history, "2026-12-01").level, 5);
});

test("legacy employees keep the LVL3 floor after a lower Academy rank", () => {
  const result = resolve([rank(2, "2026-11-01")], "2026-11-01");
  assert.equal(result.level, 3);
  assert.equal(result.source, "legacy_floor");
});

test("new employees use their confirmed rank when it becomes effective", () => {
  const history = [rank(2, "2026-12-01")];
  assert.equal(resolve(history, "2026-11-01", createdAtCutoff).level, 1);
  assert.equal(resolve(history, "2026-12-01", createdAtCutoff).level, 2);
});

test("rejects conflicting levels with the same effective date", () => {
  assert.equal(resolve([rank(3, "2026-11-01"), rank(4, "2026-11-01")], "2026-11-01").status, "ambiguous");
});

test("rejects a rank outside the pay grid", () => {
  assert.equal(resolve([rank(0, "2026-11-01")], "2026-11-01").status, "ambiguous");
});

test("requires the first day of the payroll month", () => {
  assert.throws(() => resolve([], "2026-11-15"));
});
