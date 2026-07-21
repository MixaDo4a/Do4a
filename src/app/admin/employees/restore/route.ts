import { NextRequest, NextResponse } from "next/server";
import { getCurrentRoleCodes } from "@/lib/auth/roles";
import { appRedirectUrl } from "@/lib/http/redirect-url";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function adminUrl(request: NextRequest, message: string, detail?: string) {
  const url = appRedirectUrl(request, "/admin/employees");
  url.searchParams.set("message", message);
  if (detail) url.searchParams.set("detail", detail);
  return url;
}

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const employeeId = value(formData, "employee_id");

  if (!employeeId) {
    return NextResponse.redirect(adminUrl(request, "admin-required"), 303);
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(appRedirectUrl(request, "/login"), 303);
  }

  const { roles } = await getCurrentRoleCodes();
  if (!roles.includes("developer")) {
    return NextResponse.redirect(adminUrl(request, "admin-error", "Восстанавливать удалённые учётки может только разработчик."), 303);
  }

  const { error } = await supabase.rpc("admin_restore_employee", {
    p_employee_id: employeeId,
  });

  if (error) {
    return NextResponse.redirect(adminUrl(request, "admin-error", error.message), 303);
  }

  return NextResponse.redirect(adminUrl(request, "employee-restored"), 303);
}
