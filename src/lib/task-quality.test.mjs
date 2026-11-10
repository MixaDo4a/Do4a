import assert from "node:assert/strict";
import test from "node:test";
import { missedTaskDeadlines, qualifiesForMonthlyTaskBonus, summarizeTaskQuality } from "./task-quality.ts";

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

test("late, overdue, and open tasks remain in the monthly bonus threshold", () => {
  assert.equal(qualifiesForMonthlyTaskBonus([late]), false);
  assert.equal(qualifiesForMonthlyTaskBonus([{ ...onTime, completed_at: null, status: "overdue" }]), false);
  assert.equal(qualifiesForMonthlyTaskBonus([{ ...onTime, completed_at: null, status: "open" }]), false);
});

test("quality percentage counts completed and overdue tasks but ignores tasks in progress", () => {
  const result = summarizeTaskQuality([
    onTime,
    { ...late, status: "overdue", completed_at: null },
    { ...onTime, status: "open", completed_at: null },
    { ...onTime, status: "in_progress", completed_at: null },
  ]);
  assert.deepEqual(result, { percentage: 50, onTimeCount: 1, totalCount: 2 });
});

test("done tasks without a completion timestamp appear in the missed-task drilldown", () => {
  const missingCompletionTime = { ...onTime, completed_at: null };
  const tasks = [
    onTime,
    missingCompletionTime,
    { ...late, status: "overdue", completed_at: null },
    { ...onTime, status: "in_progress", completed_at: null },
    { ...onTime, status: "open", completed_at: null },
  ];

  const quality = summarizeTaskQuality(tasks);
  const missed = missedTaskDeadlines(tasks);

  assert.deepEqual(quality, { percentage: 33, onTimeCount: 1, totalCount: 3 });
  assert.equal(missed.length, 2);
  assert.ok(missed.includes(missingCompletionTime));
  assert.equal(missed.some((task) => task.status === "in_progress" || task.status === "open"), false);
});
