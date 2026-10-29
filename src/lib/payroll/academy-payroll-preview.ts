import { calculateStoreContestAwards } from "./competition-awards.ts";

export type PreviewRate = {
  level: number;
  hourlyRate: number;
  baseCommissionPercent: number;
  planCommissionPercent: number;
};

export type PreviewShift = {
  id: string;
  storeId: string;
  shiftDate: string;
  paidHours: number;
  confirmedHours: boolean;
  participantRole: "primary_seller" | "secondary_seller";
  netRevenue: number;
  receiptCount: number;
  itemsSoldCount: number | null;
};

export type PreviewChecklistScore = {
  storeId: string;
  score: number;
};

export type PreviewTask = {
  id: string;
  storeId: string;
  assigneeEmployeeId: string | null;
  createdLocalDate: string;
  dueLocalDate: string | null;
  dueAt: string | null;
  completedAt: string | null;
  status: "open" | "done" | "cancelled";
};

export type PreviewStore = {
  id: string;
  workdayHours: number;
  netRevenue: number;
  receiptCount: number;
  itemsSoldCount: number | null;
  averageCheckTarget: number | null;
  checkDepthTarget: number | null;
  salesPlanAmount: number | null;
};

export type PreviewEmployee = {
  id: string;
  name: string;
  level: number;
  shifts: PreviewShift[];
  checklistScores: PreviewChecklistScore[];
  tasks: PreviewTask[];
  acceptedPackageAmount: number;
  manualKpiAwardAmount: number;
  advances: number;
  deductions: number;
  signedAdjustments: number;
};

export type PreviewOptions = {
  periodMonth: string;
  taskScoring: "status" | "on_time";
  hourSource: "confirmed_only" | "october_store_schedule";
  rates: PreviewRate[];
};

export type EmployeePayrollPreview = {
  employeeId: string;
  name: string;
  totalShiftCount: number;
  totalPaidHours: number;
  level: number;
  hourlyPay: number;
  commission: number;
  taskBonus: number;
  taskCompletionPercent: number | null;
  eligibleTaskCount: number;
  checklistBonus: number;
  checklistMissing: boolean;
  checklistQualityByStore: Record<string, number>;
  commercialKpiBonus: number;
  contestBonus: number;
  acceptedPackages: number;
  manualKpiAwards: number;
  advances: number;
  deductions: number;
  signedAdjustments: number;
  total: number;
};

export type PayrollPreview = {
  periodMonth: string;
  stores: Record<string, { averageCheck: number | null; checkDepth: number | null; achievedAverageCheck: boolean; achievedCheckDepth: boolean; goalAward: number }>;
  employees: EmployeePayrollPreview[];
};

const TASK_BONUS = 1_000;
const CHECKLIST_BONUS = 2_000;
const AVERAGE_CHECK_BONUS = 2_000;
const CHECK_DEPTH_BONUS = 2_000;
const BOTH_COMMERCIAL_KPIS_BONUS = 5_000;

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function assertFiniteNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid ${label}`);
}

function isMonthDate(date: string, periodMonth: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && date.slice(0, 7) === periodMonth;
}

function validateInput(employees: PreviewEmployee[], stores: PreviewStore[], options: PreviewOptions): void {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(options.periodMonth)) throw new Error("Invalid payroll preview month");
  for (const store of stores) {
    assertFiniteNonNegative(store.workdayHours, "store workday hours");
    assertFiniteNonNegative(store.netRevenue, "store net revenue");
    assertFiniteNonNegative(store.receiptCount, "store receipt count");
    if (store.itemsSoldCount !== null) assertFiniteNonNegative(store.itemsSoldCount, "store item count");
    if (!Number.isInteger(store.receiptCount) || (store.itemsSoldCount !== null && !Number.isInteger(store.itemsSoldCount))) throw new Error("Invalid store sales counts");
    if (store.averageCheckTarget !== null) assertFiniteNonNegative(store.averageCheckTarget, "average-check target");
    if (store.checkDepthTarget !== null) assertFiniteNonNegative(store.checkDepthTarget, "check-depth target");
    if (store.salesPlanAmount !== null) assertFiniteNonNegative(store.salesPlanAmount, "sales plan");
  }
  for (const employee of employees) {
    if (!employee.id || !Number.isInteger(employee.level) || employee.level < 1 || employee.level > 10) {
      throw new Error("Invalid preview employee");
    }
    for (const shift of employee.shifts) {
      assertFiniteNonNegative(shift.paidHours, "paid hours");
      assertFiniteNonNegative(shift.netRevenue, "shift net revenue");
      assertFiniteNonNegative(shift.receiptCount, "shift receipt count");
      if (!Number.isInteger(shift.receiptCount) || (shift.itemsSoldCount !== null && (!Number.isInteger(shift.itemsSoldCount) || shift.itemsSoldCount < 0))) {
        throw new Error("Invalid preview shift counts");
      }
    }
    for (const checklist of employee.checklistScores) {
      if (!Number.isFinite(checklist.score) || checklist.score < 0 || checklist.score > 10) throw new Error("Invalid checklist score");
    }
    for (const amount of [employee.acceptedPackageAmount, employee.manualKpiAwardAmount, employee.advances, employee.deductions]) {
      assertFiniteNonNegative(amount, "employee award or deduction");
    }
    if (!Number.isFinite(employee.signedAdjustments)) throw new Error("Invalid signed adjustment");
  }
}

function averageScoresByStore(scores: PreviewChecklistScore[]): Record<string, number> {
  const sums = new Map<string, { total: number; count: number }>();
  for (const { storeId, score } of scores) {
    const current = sums.get(storeId) ?? { total: 0, count: 0 };
    current.total += score;
    current.count += 1;
    sums.set(storeId, current);
  }
  return Object.fromEntries([...sums].map(([storeId, value]) => [storeId, value.total / value.count]));
}

function creditedTaskEmployees(
  task: PreviewTask,
  employees: PreviewEmployee[],
  periodMonth: string,
): string[] {
  if (task.status === "cancelled" || !task.dueLocalDate || !isMonthDate(task.dueLocalDate, periodMonth)) return [];
  if (task.assigneeEmployeeId) return [task.assigneeEmployeeId];
  return employees
    .filter((employee) => employee.shifts.some((shift) =>
      shift.storeId === task.storeId && shift.shiftDate >= task.createdLocalDate && shift.shiftDate <= task.dueLocalDate!,
    ))
    .map((employee) => employee.id);
}

function taskWasCompleted(task: PreviewTask, scoring: PreviewOptions["taskScoring"]): boolean {
  if (task.status !== "done") return false;
  if (scoring === "status") return true;
  if (!task.dueAt || !task.completedAt) return false;
  const due = new Date(task.dueAt).getTime();
  const completed = new Date(task.completedAt).getTime();
  return Number.isFinite(due) && Number.isFinite(completed) && completed <= due;
}

export function calculateAcademyPayrollPreview(
  employees: PreviewEmployee[],
  stores: PreviewStore[],
  options: PreviewOptions,
): PayrollPreview {
  validateInput(employees, stores, options);
  const storeById = new Map(stores.map((store) => [store.id, store]));
  const rateByLevel = new Map(options.rates.map((rate) => [rate.level, rate]));
  const storeResults: PayrollPreview["stores"] = {};
  const storeGoalAwards = new Map<string, number>();

  for (const store of stores) {
    const averageCheck = store.receiptCount > 0 ? store.netRevenue / store.receiptCount : null;
    const checkDepth = store.receiptCount > 0 && store.itemsSoldCount !== null ? store.itemsSoldCount / store.receiptCount : null;
    const achievedAverageCheck = store.averageCheckTarget !== null && averageCheck !== null && roundMoney(averageCheck) >= store.averageCheckTarget;
    const achievedCheckDepth = store.checkDepthTarget !== null && checkDepth !== null && roundMoney(checkDepth) >= store.checkDepthTarget;
    const goalAward = achievedAverageCheck && achievedCheckDepth
      ? BOTH_COMMERCIAL_KPIS_BONUS
      : achievedAverageCheck
        ? AVERAGE_CHECK_BONUS
        : achievedCheckDepth
          ? CHECK_DEPTH_BONUS
          : 0;
    storeResults[store.id] = { averageCheck, checkDepth, achievedAverageCheck, achievedCheckDepth, goalAward };
    storeGoalAwards.set(store.id, goalAward);
  }

  const tasksByEmployee = new Map<string, { total: number; completed: number }>();
  for (const task of employees.flatMap((employee) => employee.tasks).filter((task, index, all) => all.findIndex((item) => item.id === task.id) === index)) {
    for (const employeeId of creditedTaskEmployees(task, employees, options.periodMonth)) {
      const counts = tasksByEmployee.get(employeeId) ?? { total: 0, completed: 0 };
      counts.total += 1;
      if (taskWasCompleted(task, options.taskScoring)) counts.completed += 1;
      tasksByEmployee.set(employeeId, counts);
    }
  }

  const contestBonusByEmployee = new Map<string, number>();
  for (const store of stores) {
    const entries = employees.map((employee) => {
      const shifts = employee.shifts.filter((shift) => shift.storeId === store.id);
      const rate = rateByLevel.get(employee.level);
      return {
        employeeId: employee.id,
        level: employee.level,
        confirmedShiftCount: new Set(shifts.filter((shift) => shift.confirmedHours).map((shift) => shift.id)).size,
        netRevenueCents: Math.round(shifts.reduce((sum, shift) => sum + shift.netRevenue, 0) * 100),
        receiptCount: shifts.reduce((sum, shift) => sum + shift.receiptCount, 0),
        itemsSoldCount: shifts.some((shift) => shift.itemsSoldCount === null)
          ? null
          : shifts.reduce((sum, shift) => sum + (shift.itemsSoldCount ?? 0), 0),
        rate,
      };
    }).filter((entry) => entry.receiptCount > 0);
    const awards = calculateStoreContestAwards(entries);
    for (const [employeeId, cents] of awards.awardsCents) {
      contestBonusByEmployee.set(employeeId, (contestBonusByEmployee.get(employeeId) ?? 0) + cents / 100);
    }
  }

  const employeeResults = employees.map((employee): EmployeePayrollPreview => {
    const rate = rateByLevel.get(employee.level);
    if (!rate) throw new Error(`Missing Academy pay rate for level ${employee.level}`);
    const qualifyingShifts = options.hourSource === "october_store_schedule"
      ? employee.shifts
      : employee.shifts.filter((shift) => shift.confirmedHours);
    const shiftCount = new Set(qualifyingShifts.map((shift) => shift.id)).size;
    const hoursForShift = (shift: PreviewShift) => {
      if (options.hourSource === "october_store_schedule") {
        const store = storeById.get(shift.storeId);
        if (!store) throw new Error(`Missing store ${shift.storeId}`);
        return store.workdayHours;
      }
      return shift.confirmedHours ? shift.paidHours : 0;
    };
    const totalPaidHours = employee.shifts.reduce((sum, shift) => sum + hoursForShift(shift), 0);
    const hoursByStore = new Map<string, number>();
    for (const shift of employee.shifts) hoursByStore.set(shift.storeId, (hoursByStore.get(shift.storeId) ?? 0) + hoursForShift(shift));

    const qualityByStore = averageScoresByStore(employee.checklistScores);
    const hourlyPay = employee.shifts.reduce((sum, shift) => {
      const qualityCoefficient = qualityByStore[shift.storeId] === undefined ? 1 : qualityByStore[shift.storeId] / 10;
      return sum + hoursForShift(shift) * rate.hourlyRate * qualityCoefficient;
    }, 0);

    const commission = employee.shifts.reduce((sum, shift) => {
      const store = storeById.get(shift.storeId);
      if (!store) throw new Error(`Missing store ${shift.storeId}`);
      const planAchieved = store.salesPlanAmount !== null && store.salesPlanAmount > 0 && store.netRevenue >= store.salesPlanAmount;
      const percent = shift.participantRole === "secondary_seller"
        ? rate.baseCommissionPercent / 2
        : employee.level >= 5 && planAchieved
          ? rate.planCommissionPercent
          : rate.baseCommissionPercent;
      return sum + shift.netRevenue * percent / 100;
    }, 0);

    const taskCounts = tasksByEmployee.get(employee.id) ?? { total: 0, completed: 0 };
    const taskCompletionPercent = taskCounts.total ? taskCounts.completed / taskCounts.total * 100 : null;
    const eligibleForMonthlyAwards = shiftCount >= 3;
    const taskBonus = employee.level >= 3 && eligibleForMonthlyAwards && (taskCounts.total === 0 || taskCounts.completed * 100 >= taskCounts.total * 95)
      ? TASK_BONUS
      : 0;

    const checklistAverage = employee.checklistScores.length
      ? employee.checklistScores.reduce((sum, item) => sum + item.score, 0) / employee.checklistScores.length
      : null;
    const checklistMissing = checklistAverage === null;
    const checklistBonus = employee.level >= 3 && eligibleForMonthlyAwards && (
      checklistAverage === null || checklistAverage >= 9
    ) ? CHECKLIST_BONUS : 0;

    let commercialKpiBonus = 0;
    if (employee.level >= 4 && eligibleForMonthlyAwards && totalPaidHours > 0) {
      for (const [storeId, hours] of hoursByStore) {
        commercialKpiBonus += (storeGoalAwards.get(storeId) ?? 0) * hours / totalPaidHours;
      }
    }

    const contestBonus = contestBonusByEmployee.get(employee.id) ?? 0;
    const acceptedPackages = employee.acceptedPackageAmount;
    const manualKpiAwards = employee.manualKpiAwardAmount;
    const total = hourlyPay + commission + taskBonus + checklistBonus + commercialKpiBonus + contestBonus
      + acceptedPackages + manualKpiAwards - employee.advances - employee.deductions + employee.signedAdjustments;

    return {
      employeeId: employee.id,
      name: employee.name,
      totalShiftCount: shiftCount,
      totalPaidHours: roundMoney(totalPaidHours),
      level: employee.level,
      hourlyPay: roundMoney(hourlyPay),
      commission: roundMoney(commission),
      taskBonus,
      taskCompletionPercent: taskCompletionPercent === null ? null : roundMoney(taskCompletionPercent),
      eligibleTaskCount: taskCounts.total,
      checklistBonus,
      checklistMissing,
      checklistQualityByStore: Object.fromEntries(Object.entries(qualityByStore).map(([storeId, score]) => [storeId, roundMoney(score / 10)])),
      commercialKpiBonus: roundMoney(commercialKpiBonus),
      contestBonus: roundMoney(contestBonus),
      acceptedPackages: roundMoney(acceptedPackages),
      manualKpiAwards: roundMoney(manualKpiAwards),
      advances: roundMoney(employee.advances),
      deductions: roundMoney(employee.deductions),
      signedAdjustments: roundMoney(employee.signedAdjustments),
      total: roundMoney(total),
    };
  });

  return { periodMonth: options.periodMonth, stores: storeResults, employees: employeeResults };
}
