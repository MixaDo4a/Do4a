import { NextRequest, NextResponse } from "next/server";
import { getCurrentRoleCodes, hasAnyRole } from "@/lib/auth/roles";
import { getAccessibleStores } from "@/lib/auth/stores";
import { appRedirectUrl } from "@/lib/http/redirect-url";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { uploadFormFile } from "@/lib/storage/upload-form-file";

const CREATE_ROLES = ["buyer", "super_admin", "developer"];

type StoreRow = {
  id: string;
  name: string;
  city: string;
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
  const storeId = value(formData, "store_id");
  const supplierName = value(formData, "supplier_name");
  const invoiceFile = formData.get("invoice_file");

  if (!storeId || !supplierName || !(invoiceFile instanceof File) || invoiceFile.size === 0) {
    return NextResponse.redirect(procurementUrl(request, "required"), 303);
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(appRedirectUrl(request, "/login"), 303);
  }

  const { roles } = await getCurrentRoleCodes();
  if (!hasAnyRole(roles, CREATE_ROLES)) {
    return NextResponse.redirect(procurementUrl(request, "save-error", "Недостаточно прав."), 303);
  }

  const accessibleStores = await getAccessibleStores();
  const store = accessibleStores.find((item) => item.id === storeId) as StoreRow | undefined;
  if (!store) {
    return NextResponse.redirect(procurementUrl(request, "save-error", "Магазин недоступен."), 303);
  }

  let invoiceFileId: string | null = null;
  try {
    invoiceFileId = await uploadFormFile(supabase, "procurement-files", "invoices", invoiceFile, user.id, "purchase_order", null);
  } catch (error) {
    return NextResponse.redirect(procurementUrl(request, "save-error", error instanceof Error ? error.message : "Не удалось загрузить счёт."), 303);
  }

  const { data: order, error } = await supabase
    .from("purchase_orders")
    .insert({
      store_id: storeId,
      supplier_name: supplierName,
      invoice_file_id: invoiceFileId,
      status: "expected",
      created_by: user.id,
      updated_by: user.id,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !order) {
    return NextResponse.redirect(procurementUrl(request, "save-error", error?.message ?? "Не удалось создать заказ."), 303);
  }

  if (invoiceFileId) {
    await supabase.from("files").update({ related_entity_id: order.id }).eq("id", invoiceFileId);
  }

  await supabase.rpc("send_city_warehouse_managers_notification", {
    p_city: store.city,
    p_event_type: "purchase_order_created",
    p_title: "Новый заказ поставщика",
    p_body: `${store.name}: ${supplierName}`,
    p_related_entity_type: "purchase_order",
    p_related_entity_id: order.id,
  });

  return NextResponse.redirect(procurementUrl(request, "saved"), 303);
}
