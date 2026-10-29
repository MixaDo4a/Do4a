import assert from "node:assert/strict";
import test from "node:test";
import { qualifiesForMonthlyTaskBonus } from "./task-quality.ts";

const onTime = {
  due_at: "2026-11-10T10:00:00Z",
  completed_at: "2026-11-10T09:00:00Z",
  status: "done",
};
const late = { ...onTime, completed_at: "2026-11-10T11:00:00Z" };

test("no eligible tasks earns the monthly task bonus", () => {
  assert.equal(qualifiesForMonthlyTaskBonus([]), true);
  assert.equal(qualifiesForMonthlyTaskBonus([{ ...late, status: "cancelled" }]), true);
});

test("exactly 95 percent of tasks completed on time qualifies", () => {
  assert.equal(qualifiesForMonthlyTaskBonus([...Array(19).fill(onTime), late]), true);
  assert.equal(qualifiesForMonthlyTaskBonus([...Array(18).fill(onTime), late, late]), false);
});

test("late completion and unfinished tasks count against the threshold", () => {
  assert.equal(qualifiesForMonthlyTaskBonus([late]), false);
  assert.equal(qualifiesForMonthlyTaskBonus([{ ...onTime, completed_at: null, status: "open" }]), false);
});
