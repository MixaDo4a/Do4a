import Image from "next/image";
import { FileText, PackageSearch, Save, Truck } from "lucide-react";
import { redirect } from "next/navigation";
import { BottomNav } from "@/components/bottom-nav";
import { SectionHeader } from "@/components/section-header";
import { getCurrentRoleCodes, hasAnyRole, PROCUREMENT_MANAGE_ROLES, PROCUREMENT_ROLES } from "@/lib/auth/roles";
import { getAccessibleStores } from "@/lib/auth/stores";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type PageProps = {
  searchParams: Promise<{ message?: string; detail?: string }>;
};

type PromotionRow = {
  id: string;
  supplier_name: string;
  product_name: string;
  promotion_terms: string;
  starts_on: string | null;
  ends_on: string | null;
  stores: { name: string; city: string } | null;
};

type OrderRow = {
  id: string;
  supplier_name: string;
  status: "expected" | "in_work" | "accepted" | "problem";
  problem_comment: string | null;
  created_at: string;
  stores: { name: string; city: string } | null;
  files: { bucket: string; path: string } | null;
  purchase_order_problem_files: { id: string; files: { bucket: string; path: string } | null }[];
};

const messages: Record<string, string> = {
  required: "Заполните обязательные поля.",
  saved: "Данные сохранены.",
  "save-error": "Не удалось сохранить данные.",
  "status-updated": "Статус заказа обновлён.",
};

const statusLabels: Record<OrderRow["status"], string> = {
  expected: "Ожидается",
  in_work: "В работе",
  accepted: "Принято",
  problem: "Проблемный",
};

function dateLabel(value: string | null) {
  if (!value) return "Без даты";
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(value));
}

function isActivePromotion(promotion: PromotionRow) {
  const today = new Date().toISOString().slice(0, 10);
  const startsOn = promotion.starts_on ?? today;
  const endsOn = promotion.ends_on ?? today;
  return startsOn <= today && endsOn >= today;
}

export default async function ProcurementPage({ searchParams }: PageProps) {
  const { message, detail } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { roles } = await getCurrentRoleCodes();
  if (!hasAnyRole(roles, PROCUREMENT_ROLES)) {
    redirect("/");
  }

  const canCreateOrders = roles.some((role) => ["buyer", "super_admin", "developer"].includes(role));
  const canUpdateOrders = roles.some((role) => PROCUREMENT_MANAGE_ROLES.includes(role));
  const stores = await getAccessibleStores();
  const storeIds = stores.map((store) => store.id);

  const [promotionsResult, ordersResult] = await Promise.all([
    storeIds.length > 0
      ? supabase
          .from("supplier_promotions")
          .select("id, supplier_name, product_name, promotion_terms, starts_on, ends_on, stores(name, city)")
          .in("store_id", storeIds)
          .order("created_at", { ascending: false })
          .limit(20)
          .returns<PromotionRow[]>()
      : Promise.resolve({ data: [] as PromotionRow[], error: null }),
    storeIds.length > 0
      ? supabase
          .from("purchase_orders")
          .select(
            "id, supplier_name, status, problem_comment, created_at, stores(name, city), files(bucket, path), purchase_order_problem_files(id, files(bucket, path))",
          )
          .in("store_id", storeIds)
          .order("created_at", { ascending: false })
          .limit(30)
          .returns<OrderRow[]>()
      : Promise.resolve({ data: [] as OrderRow[], error: null }),
  ]);

  if (promotionsResult.error) throw new Error(promotionsResult.error.message);
  if (ordersResult.error) throw new Error(ordersResult.error.message);
  const activePromotions = promotionsResult.data.filter((promotion) => isActivePromotion(promotion));
  const canViewOnlyPromotions = roles.some((role) => ["manager", "auditor"].includes(role)) && !canCreateOrders && !canUpdateOrders;

  return (
    <main className="app-shell min-h-dvh bg-surface px-4 pb-24 pt-4 text-ink">
      <div className="mx-auto max-w-5xl">
        <SectionHeader icon={PackageSearch} title="Акции" showBack />

        <section className="mt-4 overflow-hidden rounded-3xl border border-line/70 bg-black/30 shadow-soft">
          <div className="relative aspect-[16/6] min-h-48 w-full">
            <Image
              alt="Акции поставщиков"
              className="object-cover"
              fill
              priority
              src="/procurement-banner.png"
              sizes="(max-width: 768px) 100vw, 1024px"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/35 to-black/65" />
            <div className="absolute inset-0 flex items-end p-4 sm:p-6">
              <div className="max-w-xl">
                <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-brand/90">Акции поставщиков</p>
                <h2 className="mt-2 text-2xl font-semibold text-white">Промо, заказы и проблемные поставки</h2>
                <p className="mt-2 max-w-lg text-sm text-white/75">
                  Просматривайте акции, оформляйте заказы и отслеживайте статусы поставок в одном разделе.
                </p>
              </div>
            </div>
          </div>
        </section>

        {message ? (
          <div className="mt-4 ui-panel p-3 text-sm text-muted">
            <p className="font-semibold text-ink">{messages[message] ?? message}</p>
            {detail ? <p className="mt-1 break-words text-xs text-brand">{detail}</p> : null}
          </div>
        ) : null}

        {canCreateOrders ? (
          <section className="mt-4 grid gap-4 lg:grid-cols-2">
            <form action="/procurement/orders/create" className="ui-panel p-4" encType="multipart/form-data" method="post">
              <h2 className="inline-flex items-center gap-2 font-semibold">
                <Truck className="text-brand" size={18} /> Новый заказ
              </h2>
              <div className="mt-4 grid gap-3">
                <select className="h-11 rounded-md border border-line px-3" name="store_id" required>
                  {stores.map((store) => (
                    <option key={store.id} value={store.id}>
                      {store.name}, {store.city}
                    </option>
                  ))}
                </select>
                <input className="h-11 rounded-md border border-line px-3" name="supplier_name" placeholder="Поставщик" required />
                <label className="grid gap-1 text-sm text-muted">
                  Счёт
                  <input
                    className="rounded-md border border-line p-3"
                    name="invoice_file"
                    type="file"
                    accept=".pdf,.xls,.xlsx,image/*,application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    required
                  />
                </label>
                <button className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-brand px-4 font-semibold text-white">
                  <Save size={17} /> Создать заказ
                </button>
              </div>
            </form>

            <form action="/procurement/promotions/create" className="ui-panel p-4" method="post">
              <h2 className="inline-flex items-center gap-2 font-semibold">
                <PackageSearch className="text-brand" size={18} /> Акция поставщика
              </h2>
              <div className="mt-4 grid gap-3">
                <div className="rounded-2xl border border-line/70 bg-[#0d090a]/92 p-3">
                  <p className="text-sm font-medium text-muted">Магазины акции</p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {stores.map((store) => (
                      <label key={store.id} className="flex items-center gap-2 rounded-xl border border-line/70 bg-black/20 px-3 py-2 text-sm">
                        <input type="checkbox" name="store_ids" value={store.id} />
                        <span className="min-w-0 break-words">
                          {store.name}, {store.city}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
                <input className="h-11 rounded-md border border-line px-3" name="supplier_name" placeholder="Поставщик" required />
                <input className="h-11 rounded-md border border-line px-3" name="product_name" placeholder="Товар" required />
                <textarea className="min-h-24 rounded-md border border-line px-3 py-2" name="promotion_terms" placeholder="Условия акции" required />
                <div className="grid gap-3 sm:grid-cols-2">
                  <input className="h-11 rounded-md border border-line px-3" name="starts_on" type="date" />
                  <input className="h-11 rounded-md border border-line px-3" name="ends_on" type="date" />
                </div>
                <button className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-brand px-4 font-semibold text-white">
                  <Save size={17} /> Сохранить акцию
                </button>
              </div>
            </form>
          </section>
        ) : null}

        {canCreateOrders || canUpdateOrders ? (
          <section className="mt-4 ui-panel p-4">
            <SectionHeader icon={Truck} title="Заказы поставщиков" />
            <div className="mt-4 grid gap-3">
              {ordersResult.data.length === 0 ? (
                <p className="rounded-md border border-line p-3 text-sm text-muted">Заказов пока нет.</p>
              ) : (
                ordersResult.data.map((order) => (
                  <article key={order.id} className="rounded-2xl border border-line/80 bg-[#0d090a]/92 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="break-words font-semibold">{order.supplier_name}</h3>
                        <p className="mt-1 break-words text-sm text-muted">
                          {order.stores?.name ?? "Магазин"} · {dateLabel(order.created_at)}
                        </p>
                        <p className="mt-1 text-sm">Статус: {statusLabels[order.status]}</p>
                        {order.files ? <p className="mt-1 break-words text-xs text-muted">Счёт прикреплён: {order.files.path.split("/").pop()}</p> : null}
                        {order.problem_comment ? <p className="mt-2 break-words text-sm text-brand">{order.problem_comment}</p> : null}
                        {order.purchase_order_problem_files.length > 0 ? (
                          <p className="mt-1 text-xs text-muted">Фото проблемы: {order.purchase_order_problem_files.length}</p>
                        ) : null}
                      </div>
                    </div>

                    {canUpdateOrders ? (
                      <form action="/procurement/orders/update-status" className="mt-3 grid gap-2" encType="multipart/form-data" method="post">
                        <input name="order_id" type="hidden" value={order.id} />
                        <select className="h-10 rounded-md border border-line px-3" name="status" defaultValue={order.status}>
                          <option value="expected">Ожидается</option>
                          <option value="in_work">В работе</option>
                          <option value="accepted">Принято</option>
                          <option value="problem">Проблемный</option>
                        </select>
                        <textarea className="min-h-20 rounded-md border border-line px-3 py-2" name="problem_comment" placeholder="Комментарий обязателен для проблемного заказа" />
                        <input
                          className="rounded-md border border-line p-3"
                          name="problem_files"
                          type="file"
                          accept=".pdf,.xls,.xlsx,image/*,application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                          multiple
                        />
                        <button className="h-10 rounded-md border border-line px-4 font-semibold">Обновить статус</button>
                      </form>
                    ) : null}
                  </article>
                ))
              )}
            </div>
          </section>
        ) : null}

        <section className="mt-4 ui-panel p-4">
          <SectionHeader icon={FileText} title="Акции поставщиков" />
          {canViewOnlyPromotions ? <p className="mt-2 text-sm text-muted">Только просмотр активных акций.</p> : null}
          <div className="mt-4 grid gap-3">
            {activePromotions.length === 0 ? (
              <p className="rounded-md border border-line p-3 text-sm text-muted">Акций пока нет.</p>
            ) : (
              activePromotions.map((promotion) => (
                <article key={promotion.id} className="rounded-2xl border border-line/80 bg-[#0d090a]/92 p-3">
                  <h3 className="break-words font-semibold">{promotion.product_name}</h3>
                  <p className="mt-1 break-words text-sm text-muted">
                    {promotion.supplier_name} · {promotion.stores?.name ?? "Магазин"}
                  </p>
                  <p className="mt-2 break-words text-sm">{promotion.promotion_terms}</p>
                  <p className="mt-2 text-xs text-muted">
                    {dateLabel(promotion.starts_on)} — {dateLabel(promotion.ends_on)}
                  </p>
                </article>
              ))
            )}
          </div>
        </section>
      </div>
      <BottomNav />
    </main>
  );
}

