import { NextRequest, NextResponse } from "next/server";
import { getCurrentEmployeeId, getCurrentRoleCodes, hasAnyRole, OPEN_SHIFT_ROLES } from "@/lib/auth/roles";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { dispatchPushNotificationsFromEvent } from "@/lib/push";

function openUrl(request: NextRequest, message: string, detail?: string) {
  const url = new URL("/shifts/open", request.url);
  url.searchParams.set("message", message);
  if (detail) url.searchParams.set("detail", detail);
  return url;
}

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function todayIso() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Vladivostok",
  }).format(new Date());
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const storeId = value(formData, "store_id");
  const primaryEmployeeId = value(formData, "primary_employee_id");
  const secondaryEmployeeId = value(formData, "secondary_employee_id");
  const shiftDate = todayIso();

  if (!storeId || !primaryEmployeeId) {
    return NextResponse.redirect(openUrl(request, "required"), 303);
  }

  if (secondaryEmployeeId && secondaryEmployeeId === primaryEmployeeId) {
    return NextResponse.redirect(openUrl(request, "same-seller"), 303);
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url), 303);
  }

  const { roles } = await getCurrentRoleCodes();
  if (!hasAnyRole(roles, OPEN_SHIFT_ROLES)) {
    return NextResponse.redirect(openUrl(request, "open-error", "Недостаточно прав для открытия смены."), 303);
  }

  const { employeeId: currentEmployeeId } = await getCurrentEmployeeId();
  const managerOnly = roles.includes("manager") && !roles.some((role) => ["store_manager", "super_admin", "developer"].includes(role));
  if (managerOnly && (!currentEmployeeId || primaryEmployeeId !== currentEmployeeId)) {
    return NextResponse.redirect(openUrl(request, "open-error", "Основным продавцом может быть только текущий сотрудник."), 303);
  }

  if (currentEmployeeId) {
    const { data: activeParticipation, error: activeParticipationError } = await supabase
      .from("shift_participants")
      .select("shift_id, shifts!inner(status)")
      .eq("employee_id", currentEmployeeId)
      .in("shifts.status", ["opened", "correction_required"])
      .limit(1)
      .maybeSingle();

    if (activeParticipationError) {
      return NextResponse.redirect(openUrl(request, "open-error", activeParticipationError.message), 303);
    }
    if (activeParticipation) {
      return NextResponse.redirect(openUrl(request, "open-error", "У сотрудника уже есть открытая смена."), 303);
    }
  }

  const { data: shift, error: shiftError } = await supabase
    .from("shifts")
    .insert({
      store_id: storeId,
      shift_date: shiftDate,
      status: "opened",
      source: "manual_open",
      opened_by_employee_id: primaryEmployeeId,
      created_by: user.id,
      updated_by: user.id,
    })
    .select("id")
    .single();

  if (shiftError || !shift) {
    const detail = shiftError?.code === "23505" ? "У сотрудника уже есть открытая смена." : shiftError?.message;
    return NextResponse.redirect(openUrl(request, "open-error", detail), 303);
  }

  const participants = [
    {
      shift_id: shift.id,
      employee_id: primaryEmployeeId,
      participant_role: "primary_seller",
      sales_percent: 0.02,
    },
  ];

  if (secondaryEmployeeId) {
    participants.push({
      shift_id: shift.id,
      employee_id: secondaryEmployeeId,
      participant_role: "secondary_seller",
      sales_percent: 0.01,
    });
  }

  const { error: participantsError } = await supabase.from("shift_participants").insert(participants);
  if (participantsError) {
    return NextResponse.redirect(openUrl(request, "open-error", participantsError.message), 303);
  }

  const [{ data: storeRow }, { data: employeeRow }] = await Promise.all([
    supabase.from("stores").select("name, city, timezone").eq("id", storeId).maybeSingle<{ name: string; city: string; timezone: string | null }>(),
    supabase.from("employees").select("full_name").eq("id", primaryEmployeeId).maybeSingle<{ full_name: string }>(),
  ]);

  const timeFormatter = new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    ...(storeRow?.timezone ? { timeZone: storeRow.timezone } : {}),
  });
  const openedAt = timeFormatter.format(new Date());
  const storeLabel = storeRow ? `${storeRow.name}, ${storeRow.city}` : storeId;
  const employeeLabel = employeeRow?.full_name ?? "Сотрудник";
  const notificationBody = `${employeeLabel} ${storeLabel} ${openedAt}`;

  await supabase.rpc("send_store_managers_notification", {
    p_store_id: storeId,
    p_event_type: "shift_opened",
    p_title: "Смена открыта",
    p_body: notificationBody,
    p_related_entity_type: "shift",
    p_related_entity_id: shift.id,
  });

  await dispatchPushNotificationsFromEvent(supabase, {
    eventType: "shift_opened",
    relatedEntityType: "shift",
    relatedEntityId: shift.id,
  }).catch(() => null);

  return NextResponse.redirect(new URL(`/routine/morning?shiftId=${shift.id}&message=shift-opened`, request.url), 303);
}


