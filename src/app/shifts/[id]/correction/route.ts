import { NextRequest, NextResponse } from "next/server";
import { applyAcademyPayrollToCalculatedRows } from "@/lib/payroll/academy-payroll-apply.server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ id: string }> };

function correctionUrl(request: NextRequest, shiftId: string, status: string, detail?: string) {
  const url = new URL(`/shifts/${shiftId}`, request.url);
  url.searchParams.set("correction", status);
  if (detail) url.searchParams.set("detail", detail.slice(0, 250));
  return url;
}

function numeric(form: FormData, key: string, options: { nullable?: boolean; integer?: boolean } = {}) {
  const raw = String(form.get(key) ?? "").trim();
  if (!raw && options.nullable) return null;
  const parsed = Number(raw);
  if (!raw || !Number.isFinite(parsed) || parsed < 0 || (options.integer && !Number.isInteger(parsed))) {
    throw new Error(`Проверьте поле «${key}».`);
  }
  return parsed;
}

async function refreshCalculatedPayroll(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>, shiftId: string) {
  const { data: shift, error } = await supabase.from("shifts")
    .select("store_id, shift_date, status, is_erroneous")
    .eq("id", shiftId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!shift || shift.is_erroneous || !["closed", "auto_closed"].includes(shift.status)) return;

  const periodMonth = `${shift.shift_date.slice(0, 7)}-01`;
  const { data: payroll, error: payrollError } = await supabase.from("payroll_periods")
    .select("status").eq("period_month", periodMonth).maybeSingle();
  if (payrollError) throw new Error(payrollError.message);
  if (payroll?.status !== "calculated") return;

  const nextMonth = new Date(Date.UTC(Number(periodMonth.slice(0, 4)), Number(periodMonth.slice(5, 7)), 1)).toISOString().slice(0, 10);
  const monthEnd = new Date(Date.UTC(Number(periodMonth.slice(0, 4)), Number(periodMonth.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const shiftRows = await supabase.from("shifts").select("shift_participants(employee_id)")
    .eq("store_id", shift.store_id).in("status", ["closed", "auto_closed"]).eq("is_erroneous", false)
    .gte("shift_date", periodMonth).lt("shift_date", nextMonth);
  if (shiftRows.error) throw new Error(shiftRows.error.message);

  const employeeIds = new Set<string>();
  for (const row of shiftRows.data ?? []) {
    for (const participant of row.shift_participants as { employee_id: string }[]) employeeIds.add(participant.employee_id);
  }
  const { data: assignments, error: assignmentsError } = await supabase.from("employee_store_assignments")
    .select("employee_id").eq("store_id", shift.store_id).eq("is_primary", true)
    .lte("valid_from", monthEnd).or(`valid_to.is.null,valid_to.gte.${periodMonth}`);
  if (assignmentsError) throw new Error(assignmentsError.message);
  for (const assignment of assignments ?? []) employeeIds.add(assignment.employee_id);

  for (const employeeId of employeeIds) {
    const { error: calculateError } = await supabase.rpc("calculate_employee_payroll_period", {
      p_employee_id: employeeId,
      p_period_month: periodMonth,
    });
    if (calculateError) throw new Error(calculateError.message);
  }
  await applyAcademyPayrollToCalculatedRows(supabase, periodMonth, [...employeeIds]);
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url), 303);

  const form = await request.formData();
  const reason = String(form.get("reason") ?? "").trim();
  const openedLocal = String(form.get("opened_local") ?? "").trim();
  const closedLocal = String(form.get("closed_local") ?? "").trim();
  if (reason.length < 3 || !openedLocal || !closedLocal) {
    return NextResponse.redirect(correctionUrl(request, id, "error", "Укажите время, причину и проверьте обязательные поля."), 303);
  }

  let cashCounts: { denomination_id: string; quantity: number }[];
  let reportValues: Record<string, number | null>;
  try {
    cashCounts = [...form.entries()]
      .filter(([key]) => key.startsWith("cash_count_"))
      .map(([key, value]) => ({
        denomination_id: key.slice("cash_count_".length),
        quantity: Number(String(value).trim()),
      }));
    if (cashCounts.some((entry) => !/^[0-9a-f-]{36}$/i.test(entry.denomination_id) || !Number.isInteger(entry.quantity) || entry.quantity < 0)) {
      throw new Error("Проверьте количество купюр и монет.");
    }
    reportValues = {
      cash_revenue: numeric(form, "cash_revenue"),
      card_revenue: numeric(form, "card_revenue"),
      cash_returns: numeric(form, "cash_returns"),
      card_returns: numeric(form, "card_returns"),
      receipt_count: numeric(form, "receipt_count", { integer: true }),
      items_sold_count: numeric(form, "items_sold_count", { nullable: true, integer: true }),
      cash_collection_amount: numeric(form, "cash_collection_amount", { nullable: true }),
      check_depth: numeric(form, "check_depth", { nullable: true }),
      advance_amount: numeric(form, "advance_amount", { nullable: true }),
      actual_cash_amount: numeric(form, "actual_cash_amount", { nullable: true }),
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Проверьте введённые значения.";
    return NextResponse.redirect(correctionUrl(request, id, "error", detail), 303);
  }

  const { error } = await supabase.rpc("correct_closed_shift_report", {
    p_shift_id: id,
    p_opened_local: openedLocal,
    p_closed_local: closedLocal,
    p_cash_revenue: reportValues.cash_revenue,
    p_card_revenue: reportValues.card_revenue,
    p_cash_returns: reportValues.cash_returns,
    p_card_returns: reportValues.card_returns,
    p_receipt_count: reportValues.receipt_count,
    p_items_sold_count: reportValues.items_sold_count,
    p_cash_collection_amount: reportValues.cash_collection_amount,
    p_cash_collection_comment: String(form.get("cash_collection_comment") ?? "").trim() || null,
    p_check_depth: reportValues.check_depth,
    p_advance_amount: reportValues.advance_amount,
    p_actual_cash_amount: reportValues.actual_cash_amount,
    p_cash_counts: cashCounts,
    p_reason: reason,
  });
  if (error) return NextResponse.redirect(correctionUrl(request, id, "error", error.message), 303);

  try {
    await refreshCalculatedPayroll(supabase, id);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Не удалось пересчитать уже рассчитанную зарплату.";
    return NextResponse.redirect(correctionUrl(request, id, "payroll-error", detail), 303);
  }
  return NextResponse.redirect(correctionUrl(request, id, "saved"), 303);
}
