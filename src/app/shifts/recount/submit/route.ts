import { NextRequest, NextResponse } from "next/server";
import { getCurrentEmployeeId, getCurrentRoleCodes } from "@/lib/auth/roles";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const storeId = String(formData.get("store_id") ?? "").trim();
  const shiftId = String(formData.get("shift_id") ?? "").trim();
  const coinsAmount = Number(String(formData.get("coins_amount") ?? "0").replace(",", "."));
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { roles } = await getCurrentRoleCodes();
  const { employeeId } = await getCurrentEmployeeId();
  if (!user || !employeeId || !roles.includes("manager") || !storeId || !shiftId || !Number.isFinite(coinsAmount) || coinsAmount < 0) {
    return NextResponse.redirect(new URL("/", request.url), 303);
  }

  const { data: shift } = await supabase
    .from("shifts")
    .select("id, store_id")
    .eq("id", shiftId)
    .eq("store_id", storeId)
    .eq("opened_by_employee_id", employeeId)
    .in("status", ["opened", "correction_required"])
    .maybeSingle();
  if (!shift) return NextResponse.redirect(new URL("/", request.url), 303);

  const { data: denominations } = await supabase.from("cash_denominations").select("id, value").eq("is_active", true).gte("value", 1);
  const denominationCounts = (denominations ?? []).map((denomination) => ({
    denomination_id: denomination.id,
    value: Number(denomination.value),
    quantity: Math.max(0, Math.floor(Number(String(formData.get(`denomination_${denomination.id}`) ?? "0")))),
  }));
  const totalAmount = denominationCounts.reduce((sum, row) => sum + row.value * row.quantity, 0) + coinsAmount;

  const { error } = await supabase.from("store_cash_counts").insert({
    store_id: storeId,
    shift_id: shiftId,
    counted_by_employee_id: employeeId,
    created_by: user.id,
    cash_amount: totalAmount,
    denominations: { coins_amount: coinsAmount, rows: denominationCounts },
  });
  if (error) return NextResponse.redirect(new URL(`/shifts/recount?storeId=${storeId}&shiftId=${shiftId}&message=error`, request.url), 303);
  return NextResponse.redirect(new URL("/?message=cash-counted", request.url), 303);
}
