import { NextRequest, NextResponse } from "next/server";
import { getCurrentRoleCodes, hasAnyRole } from "@/lib/auth/roles";
import { getAccessibleStores } from "@/lib/auth/stores";
import { appRedirectUrl } from "@/lib/http/redirect-url";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { uploadFormFile } from "@/lib/storage/upload-form-file";

const UPDATE_ROLES = ["warehouse_manager", "buyer", "super_admin", "developer"];
const allowedStatuses = new Set(["expected", "in_work", "accepted", "problem"]);

type OrderLookup = {
  id: string;
  store_id: string;
};

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function procurementUrl(request: NextRequest, message: string, detail?: string) {
  const url = appRedirectUrl(request, "/procurement");
  url.searchParams.set("message", message);
  if (detail) url.searchParams.set("detail", detail);
  return url;
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const orderId = value(formData, "order_id");
  const status = value(formData, "status");
  const problemComment = value(formData, "problem_comment");
  const problemFiles = formData
    .getAll("problem_files")
    .filter((file): file is File => file instanceof File && file.size > 0);

  if (!orderId || !allowedStatuses.has(status)) {
    return NextResponse.redirect(procurementUrl(request, "required"), 303);
  }

  if (status === "problem" && (!problemComment || problemFiles.length === 0)) {
    return NextResponse.redirect(procurementUrl(request, "save-error", "Для проблемного заказа нужен комментарий и фото."), 303);
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(appRedirectUrl(request, "/login"), 303);
  }

  const { roles } = await getCurrentRoleCodes();
  if (!hasAnyRole(roles, UPDATE_ROLES)) {
    return NextResponse.redirect(procurementUrl(request, "save-error", "Недостаточно прав."), 303);
  }

  const { data: order, error: orderError } = await supabase
    .from("purchase_orders")
    .select("id, store_id")
    .eq("id", orderId)
    .maybeSingle()
    .returns<OrderLookup>();

  if (orderError || !order) {
    return NextResponse.redirect(procurementUrl(request, "save-error", orderError?.message ?? "Заказ не найден."), 303);
  }

  const accessibleStoreIds = new Set((await getAccessibleStores()).map((store) => store.id));
  if (!accessibleStoreIds.has(order.store_id)) {
    return NextResponse.redirect(procurementUrl(request, "save-error", "Магазин заказа недоступен."), 303);
  }

  const { error } = await supabase
    .from("purchase_orders")
    .update({
      status,
      problem_comment: status === "problem" ? problemComment : null,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", orderId);

  if (error) {
    return NextResponse.redirect(procurementUrl(request, "save-error", error.message), 303);
  }

  for (const file of problemFiles) {
    try {
      const fileId = await uploadFormFile(supabase, "procurement-files", "problems", file, user.id, "purchase_order", orderId);
      if (fileId) {
        const { error: linkError } = await supabase.from("purchase_order_problem_files").insert({
          purchase_order_id: orderId,
          file_id: fileId,
          uploaded_by: user.id,
        });

        if (linkError) {
          return NextResponse.redirect(procurementUrl(request, "save-error", linkError.message), 303);
        }
      }
    } catch (uploadError) {
      return NextResponse.redirect(
        procurementUrl(request, "save-error", uploadError instanceof Error ? uploadError.message : "Не удалось загрузить фото."),
        303,
      );
    }
  }

  return NextResponse.redirect(procurementUrl(request, "status-updated"), 303);
}
