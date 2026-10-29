import assert from "node:assert/strict";
import test from "node:test";
import { calculatePaidShiftHours } from "./work-hours.ts";

const store = {
  shiftDate: "2026-11-01",
  timeZone: "Asia/Vladivostok",
  workdayStartTime: "10:00:00",
  workdayEndTime: "20:00:00",
};

test("rounds overlapping work up to the next half hour", () => {
  assert.equal(calculatePaidShiftHours("2026-11-01T00:00:00Z", "2026-11-01T00:05:00Z", store), 0.5);
  assert.equal(calculatePaidShiftHours("2026-11-01T00:00:00Z", "2026-11-01T00:35:00Z", store), 1);
});

test("counts only time inside the store workday", () => {
  assert.equal(calculatePaidShiftHours("2026-10-31T23:30:00Z", "2026-11-01T09:30:00Z", store), 9.5);
  assert.equal(calculatePaidShiftHours("2026-11-01T00:00:00Z", "2026-11-01T10:05:00Z", store), 10);
});

test("late close on the next day cannot exceed the store limit", () => {
  assert.equal(calculatePaidShiftHours("2026-11-01T00:00:00Z", "2026-11-02T03:00:00Z", store), 10);
});

test("each employee can have a shorter personal interval", () => {
  assert.equal(calculatePaidShiftHours("2026-11-01T02:00:00Z", "2026-11-01T06:10:00Z", store), 4.5);
  assert.equal(calculatePaidShiftHours("2026-11-01T10:00:00Z", "2026-11-01T10:30:00Z", store), 0);
});

test("requires an end after the start", () => {
  assert.throws(() => calculatePaidShiftHours("2026-11-01T01:00:00Z", "2026-11-01T00:00:00Z", store));
});
