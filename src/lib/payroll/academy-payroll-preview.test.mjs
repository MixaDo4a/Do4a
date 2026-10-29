import assert from "node:assert/strict";
import test from "node:test";
import { calculateAcademyPayrollPreview } from "./academy-payroll-preview.ts";

const rates = [
  { level: 4, hourlyRate: 280, baseCommissionPercent: 2, planCommissionPercent: 2 },
  { level: 5, hourlyRate: 300, baseCommissionPercent: 2, planCommissionPercent: 2.5 },
];

const store = (id, overrides = {}) => ({
  id,
  workdayHours: 10,
  netRevenue: 0,
  receiptCount: 0,
  itemsSoldCount: 0,
  averageCheckTarget: null,
  checkDepthTarget: null,
  salesPlanAmount: null,
  ...overrides,
});

const employee = (id, overrides = {}) => ({
  id,
  name: id,
  level: 4,
  shifts: [],
  checklistScores: [],
  tasks: [],
  acceptedPackageAmount: 0,
  manualKpiAwardAmount: 0,
  advances: 0,
  deductions: 0,
  signedAdjustments: 0,
  ...overrides,
});

const shift = (id, storeId, overrides = {}) => ({
  id,
  storeId,
  shiftDate: "2026-10-10",
  paidHours: 10,
  confirmedHours: false,
  participantRole: "primary_seller",
  netRevenue: 0,
  receiptCount: 0,
  itemsSoldCount: 0,
  ...overrides,
});

const options = (taskScoring = "status", hourSource = "october_store_schedule") => ({
  periodMonth: "2026-10",
  taskScoring,
  hourSource,
  rates,
});

test("weights store KPI results by the employee's actual hours and gates at three monthly shifts", () => {
  const stores = [
    store("a", { netRevenue: 1_000, receiptCount: 10, itemsSoldCount: 20, averageCheckTarget: 90, checkDepthTarget: 2 }),
    store("b", { netRevenue: 1_000, receiptCount: 10, itemsSoldCount: 10, averageCheckTarget: 90, checkDepthTarget: 2 }),
  ];
  const eligible = employee("eligible", {
    shifts: [
      shift("a1", "a", { paidHours: 15, confirmedHours: true }),
      shift("a2", "a", { paidHours: 0, confirmedHours: true }),
      shift("b1", "b", { paidHours: 15, confirmedHours: true }),
    ],
  });
  const ineligible = employee("ineligible", {
    shifts: [shift("c1", "a", { confirmedHours: true }), shift("c2", "a", { confirmedHours: true })],
  });

  const result = calculateAcademyPayrollPreview([eligible, ineligible], stores, options("status", "confirmed_only"));
  assert.equal(result.employees[0].commercialKpiBonus, 3_500);
  assert.equal(result.employees[1].commercialKpiBonus, 0);
  assert.equal(result.stores.a.goalAward, 5_000);
  assert.equal(result.stores.b.goalAward, 2_000);
});

test("applies checklist quality to hourly pay per store but not to commission or bonuses", () => {
  const worker = employee("worker", {
    shifts: [shift("a1", "a", { netRevenue: 1_000 }), shift("b1", "b", { netRevenue: 1_000 })],
    checklistScores: [{ storeId: "a", score: 9 }, { storeId: "b", score: 8 }],
  });
  const result = calculateAcademyPayrollPreview([worker], [store("a"), store("b")], options());
  assert.equal(result.employees[0].hourlyPay, 4_760);
  assert.equal(result.employees[0].commission, 40);
  assert.equal(result.employees[0].checklistBonus, 0);
  assert.equal(result.employees[0].checklistQualityByStore.a, 0.9);
  assert.equal(result.employees[0].checklistQualityByStore.b, 0.8);
});

test("uses current task status in the October preview and timely completion in production mode", () => {
  const task = {
    id: "store-task",
    storeId: "a",
    assigneeEmployeeId: null,
    createdLocalDate: "2026-10-05",
    dueLocalDate: "2026-10-10",
    dueAt: "2026-10-10T10:00:00Z",
    completedAt: "2026-10-11T10:00:00Z",
    status: "done",
  };
  const workingDuringWindow = employee("during", {
    shifts: [
      shift("before", "a", { shiftDate: "2026-10-04" }),
      shift("during-1", "a", { shiftDate: "2026-10-06" }),
      shift("during-2", "a", { shiftDate: "2026-10-08" }),
      shift("during-3", "a", { shiftDate: "2026-10-10" }),
    ],
    tasks: [task],
  });
  const workingOutsideWindow = employee("outside", {
    shifts: [
      shift("outside-1", "a", { shiftDate: "2026-10-04" }),
      shift("outside-2", "a", { shiftDate: "2026-10-11" }),
      shift("outside-3", "a", { shiftDate: "2026-10-12" }),
    ],
  });

  const october = calculateAcademyPayrollPreview([workingDuringWindow, workingOutsideWindow], [store("a")], options("status"));
  assert.equal(october.employees[0].eligibleTaskCount, 1);
  assert.equal(october.employees[0].taskCompletionPercent, 100);
  assert.equal(october.employees[0].taskBonus, 1_000);
  assert.equal(october.employees[1].eligibleTaskCount, 0);
  assert.equal(october.employees[1].taskBonus, 1_000);

  const strict = calculateAcademyPayrollPreview([workingDuringWindow], [store("a")], options("on_time"));
  assert.equal(strict.employees[0].taskCompletionPercent, 0);
  assert.equal(strict.employees[0].taskBonus, 0);
});

test("excludes store tasks without deadlines and canceled tasks", () => {
  const worker = employee("worker", {
    shifts: [shift("a1", "a"), shift("a2", "a"), shift("a3", "a")],
    tasks: [
      { id: "no-deadline", storeId: "a", assigneeEmployeeId: null, createdLocalDate: "2026-10-01", dueLocalDate: null, dueAt: null, completedAt: null, status: "open" },
      { id: "canceled", storeId: "a", assigneeEmployeeId: "worker", createdLocalDate: "2026-10-01", dueLocalDate: "2026-10-10", dueAt: "2026-10-10T10:00:00Z", completedAt: null, status: "cancelled" },
    ],
  });
  const result = calculateAcademyPayrollPreview([worker], [store("a")], options());
  assert.equal(result.employees[0].eligibleTaskCount, 0);
  assert.equal(result.employees[0].taskBonus, 1_000);
});

test("pays the ideal-checklist bonus at an exact monthly average of nine", () => {
  const worker = employee("worker", {
    shifts: [shift("a1", "a"), shift("a2", "a"), shift("a3", "a")],
    checklistScores: [{ storeId: "a", score: 8 }, { storeId: "a", score: 10 }],
  });
  const result = calculateAcademyPayrollPreview([worker], [store("a")], options());
  assert.equal(result.employees[0].checklistBonus, 2_000);
});

test("treats missing monthly checklists as a company omission and pays the eligible employee", () => {
  const worker = employee("worker", {
    shifts: [shift("a1", "a"), shift("a2", "a"), shift("a3", "a")],
  });
  const result = calculateAcademyPayrollPreview([worker], [store("a")], options());
  assert.equal(result.employees[0].checklistMissing, true);
  assert.equal(result.employees[0].checklistBonus, 2_000);
});

test("compares KPI targets after rounding actual values to two decimals", () => {
  const urban = store("urban", {
    netRevenue: 402_995,
    receiptCount: 888,
    itemsSoldCount: 1_242,
    averageCheckTarget: 453.82,
    checkDepthTarget: 1.4,
  });
  const result = calculateAcademyPayrollPreview([], [urban], options());
  assert.equal(result.stores.urban.checkDepth, 1_242 / 888);
  assert.equal(result.stores.urban.achievedCheckDepth, true);
  assert.equal(result.stores.urban.goalAward, 5_000);
});

test("uses Academy commission rates, half base commission for secondary seller, and no secondary plan uplift", () => {
  const worker = employee("worker", {
    level: 5,
    shifts: [
      shift("primary", "a", { netRevenue: 1_000, participantRole: "primary_seller" }),
      shift("secondary", "a", { netRevenue: 1_000, participantRole: "secondary_seller" }),
    ],
  });
  const result = calculateAcademyPayrollPreview(
    [worker],
    [store("a", { netRevenue: 2_000, salesPlanAmount: 2_000 })],
    options(),
  );
  assert.equal(result.employees[0].commission, 35);
});

test("keeps contest payouts separate and only uses confirmed shifts", () => {
  const first = employee("first", {
    level: 5,
    shifts: [
      shift("f1", "a", { confirmedHours: true, receiptCount: 10, netRevenue: 2_000, itemsSoldCount: 20 }),
      shift("f2", "a", { confirmedHours: true, receiptCount: 10, netRevenue: 2_000, itemsSoldCount: 20 }),
      shift("f3", "a", { confirmedHours: true, receiptCount: 10, netRevenue: 2_000, itemsSoldCount: 20 }),
    ],
  });
  const second = employee("second", {
    level: 5,
    shifts: [
      shift("s1", "a", { confirmedHours: true, receiptCount: 10, netRevenue: 1_000, itemsSoldCount: 10 }),
      shift("s2", "a", { confirmedHours: true, receiptCount: 10, netRevenue: 1_000, itemsSoldCount: 10 }),
      shift("s3", "a", { confirmedHours: true, receiptCount: 10, netRevenue: 1_000, itemsSoldCount: 10 }),
    ],
  });
  const noConfirmation = structuredClone(first);
  noConfirmation.id = "unconfirmed";
  noConfirmation.shifts = noConfirmation.shifts.map((item) => ({ ...item, id: `u-${item.id}`, confirmedHours: false }));
  const result = calculateAcademyPayrollPreview([first, second, noConfirmation], [store("a")], options());
  assert.equal(result.employees[0].contestBonus, 3_000);
  assert.equal(result.employees[1].contestBonus, 0);
  assert.equal(result.employees[2].contestBonus, 0);
});

test("production mode excludes unconfirmed hours from pay and monthly shift eligibility", () => {
  const worker = employee("worker", {
    shifts: [shift("a1", "a"), shift("a2", "a"), shift("a3", "a")],
    tasks: [],
  });
  const result = calculateAcademyPayrollPreview([worker], [store("a")], options("on_time", "confirmed_only"));
  assert.equal(result.employees[0].totalShiftCount, 0);
  assert.equal(result.employees[0].totalPaidHours, 0);
  assert.equal(result.employees[0].hourlyPay, 0);
  assert.equal(result.employees[0].taskBonus, 0);
  assert.equal(result.employees[0].checklistBonus, 0);
});
