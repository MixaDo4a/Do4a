"use client";

import { FormEvent, useMemo, useRef, useState } from "react";
import { Save } from "lucide-react";
import { PhotoFileInput } from "@/components/photo-file-input";
import { cleanText, employeeName } from "@/lib/display";

type Store = { id: string; name: string; city: string };
type Employee = { id: string; full_name: string; employee_status: "padawan" | "experienced" };
type Item = {
  id: string;
  title: string;
  sort_order: number;
  checklist_item_weights: { employee_status: "padawan" | "experienced"; weight_amount: number }[];
};
export type ChecklistDraft = {
  template_id: string;
  store_id: string;
  employee_id: string;
  payload: { scores?: Record<string, number>; comments?: Record<string, string>; comment?: string };
};

const statusLabels = { padawan: "Падаван", experienced: "Бывалый" } as const;

function money(value: number) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(value);
}

export function ChecklistForm({
  templateId,
  templateName,
  stores,
  employees,
  items,
  drafts,
  canSubmit,
}: {
  templateId: string;
  templateName: string;
  stores: Store[];
  employees: Employee[];
  items: Item[];
  drafts: ChecklistDraft[];
  canSubmit: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const timerRef = useRef<number | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const draftByKey = useMemo(
    () => new Map(drafts.map((draft) => [`${draft.store_id}:${draft.employee_id}`, draft])),
    [drafts],
  );
  const initialDraft = drafts[0];

  function readPayload() {
    const form = formRef.current;
    if (!form) return null;
    const data = new FormData(form);
    const scores: Record<string, number> = {};
    const comments: Record<string, string> = {};
    for (const item of items) {
      const score = Number(data.get(`score_${item.id}`) ?? 10);
      scores[item.id] = Number.isFinite(score) ? score : 10;
      comments[item.id] = String(data.get(`comment_${item.id}`) ?? "");
    }
    return {
      storeId: String(data.get("store_id") ?? ""),
      employeeId: String(data.get("employee_id") ?? ""),
      payload: { scores, comments, comment: String(data.get("comment") ?? "") },
    };
  }

  async function saveDraft() {
    const current = readPayload();
    if (!current || !current.storeId || !current.employeeId || !templateId) return;
    setSaveState("saving");
    try {
      const response = await fetch("/api/checklists/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId, storeId: current.storeId, employeeId: current.employeeId, payload: current.payload }),
      });
      setSaveState(response.ok ? "saved" : "error");
    } catch {
      setSaveState("error");
    }
  }

  function scheduleSave() {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => void saveDraft(), 350);
  }

  function hydrateDraft(storeId: string, employeeId: string) {
    const draft = draftByKey.get(`${storeId}:${employeeId}`);
    const form = formRef.current;
    if (!form) return;
    for (const item of items) {
      const score = form.elements.namedItem(`score_${item.id}`) as HTMLInputElement | null;
      const comment = form.elements.namedItem(`comment_${item.id}`) as HTMLInputElement | null;
      if (score) score.value = String(draft?.payload.scores?.[item.id] ?? 10);
      if (comment) comment.value = draft?.payload.comments?.[item.id] ?? "";
    }
    const generalComment = form.elements.namedItem("comment") as HTMLTextAreaElement | null;
    if (generalComment) generalComment.value = draft?.payload.comment ?? "";
    setSaveState(draft ? "saved" : "idle");
  }

  function handleChange(event: FormEvent<HTMLFormElement>) {
    const target = event.target as HTMLSelectElement;
    if (target.name === "store_id" || target.name === "employee_id") {
      const form = formRef.current;
      const store = form?.elements.namedItem("store_id") as HTMLSelectElement | null;
      const employee = form?.elements.namedItem("employee_id") as HTMLSelectElement | null;
      if (store && employee) window.setTimeout(() => hydrateDraft(store.value, employee.value), 0);
    }
    scheduleSave();
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    if (!canSubmit) event.preventDefault();
  }

  return (
    <form ref={formRef} action="/checklists/new/submit" className="mt-4 grid gap-4" encType="multipart/form-data" method="post" onChange={handleChange} onSubmit={handleSubmit}>
      <input name="template_id" type="hidden" value={templateId} readOnly />

      <section className="ui-panel p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold">Проверка</h2>
          <span className="text-xs text-muted" aria-live="polite">
            {saveState === "saving" ? "Сохраняем..." : saveState === "saved" ? "Черновик сохранён" : saveState === "error" ? "Не удалось сохранить" : ""}
          </span>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm">
            <span className="text-muted">Магазин</span>
            <select className="h-11 ui-panel px-3 outline-none focus:border-brand" name="store_id" defaultValue={initialDraft?.store_id ?? stores[0]?.id ?? ""}>
              {stores.map((store) => <option key={store.id} value={store.id}>{store.name}, {store.city}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-muted">Сотрудник</span>
            <select className="h-11 ui-panel px-3 outline-none focus:border-brand" name="employee_id" defaultValue={initialDraft?.employee_id ?? employees[0]?.id ?? ""}>
              {employees.map((employee) => <option key={employee.id} value={employee.id}>{employeeName(employee)} · {statusLabels[employee.employee_status]}</option>)}
            </select>
          </label>
        </div>
        {stores.length === 0 || employees.length === 0 ? <p className="mt-3 rounded-md bg-surface p-3 text-sm text-muted">Для чек-листа нужен активный магазин и активный менеджер.</p> : null}
      </section>

      <section className="ui-panel p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold">{templateName}</h2>
          <span className="text-sm text-muted">{items.length} пунктов</span>
        </div>
        <div className="mt-4 grid gap-3">
          {items.map((item) => {
            const experiencedWeight = item.checklist_item_weights.find((weight) => weight.employee_status === "experienced")?.weight_amount ?? 0;
            const padawanWeight = item.checklist_item_weights.find((weight) => weight.employee_status === "padawan")?.weight_amount ?? 0;
            const score = initialDraft?.payload.scores?.[item.id] ?? 10;
            const comment = initialDraft?.payload.comments?.[item.id] ?? "";
            return (
              <fieldset key={item.id} className="rounded-md border border-line p-3">
                <div className="flex items-start justify-between gap-3"><legend className="font-medium">{cleanText(item.title, "Пункт чек-листа")}</legend><span className="shrink-0 text-xs text-muted">{money(experiencedWeight)} / {money(padawanWeight)} руб.</span></div>
                <div className="mt-3 grid gap-3 sm:grid-cols-[140px_1fr]">
                  <label className="grid gap-1 text-sm"><span className="text-muted">Оценка</span><input className="h-11 rounded-md border border-line px-3 outline-none focus:border-brand" defaultValue={score} inputMode="numeric" max={10} min={1} name={`score_${item.id}`} type="number" /></label>
                  <label className="grid gap-1 text-sm"><span className="text-muted">Комментарий</span><input className="h-11 rounded-md border border-line px-3 outline-none focus:border-brand" defaultValue={comment} name={`comment_${item.id}`} placeholder="Необязательно" /></label>
                </div>
                <PhotoFileInput label="Добавить фото пункта" name={`photo_${item.id}`} required={false} />
              </fieldset>
            );
          })}
        </div>
      </section>

      <section className="ui-panel p-4"><label className="grid gap-1 text-sm"><span className="text-muted">Комментарий к проверке</span><textarea className="min-h-24 ui-panel px-3 py-2 outline-none focus:border-brand" defaultValue={initialDraft?.payload.comment ?? ""} name="comment" /></label></section>
      <p className="text-xs text-muted">Оценки и комментарии сохраняются автоматически. Фото прикрепляются при итоговом сохранении чек-листа.</p>
      <button className="inline-flex h-12 items-center justify-center gap-2 rounded-md bg-brand px-4 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50" disabled={!canSubmit}><Save size={18} /> Сохранить чек-лист</button>
    </form>
  );
}
