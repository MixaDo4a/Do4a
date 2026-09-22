"use client";

import { BookOpen, ChevronLeft, ChevronRight, GraduationCap, HelpCircle, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { helpRoleLabels, normalizeHelpRole } from "@/lib/help-content";

type TourStep = {
  selector?: string;
  title: string;
  description: string;
};

const commonSteps: TourStep[] = [
  { selector: "[data-tour='account']", title: "Профиль и активная роль", description: "Здесь видно ваше имя и текущую роль. Если ролей несколько, нажмите на роль и выберите нужный интерфейс." },
  { selector: "[data-tour='bottom-nav']", title: "Нижнее меню", description: "Нажмите пункт меню, чтобы открыть нужный раздел. Горизонтальные свайпы отключены, поэтому случайного перехода не будет." },
  { selector: "[data-tour='help-button']", title: "Обучение и инструкция", description: "Эта кнопка запускает подсказки повторно. Полная инструкция по вашей роли открывается по ссылке внутри режима обучения." },
];

const roleSteps: Record<string, TourStep[]> = {
  manager: [
    { selector: "[data-tour='home-shift']", title: "Текущая смена", description: "Здесь можно открыть смену, посмотреть статус и перейти к закрытию или пересчёту кассы." },
    { selector: "[data-tour='home-routine']", title: "Распорядок", description: "Откройте утренний или вечерний распорядок и отмечайте пункты по мере выполнения." },
    { selector: "[data-tour='home-tasks']", title: "Ближайшие задачи", description: "В этом блоке отображаются задачи, назначенные вам или доступные по вашим магазинам." },
  ],
  store_manager: [
    { selector: "[data-tour='home-schedule']", title: "График магазина", description: "В одной карточке собраны ближайшие смены сотрудников по каждому магазину." },
    { selector: "[data-tour='nav-admin']", title: "Управление", description: "Здесь находятся сотрудники, магазины, графики, архив смен и административные данные." },
    { selector: "[data-tour='home-tasks']", title: "Задачи магазина", description: "Управляющий видит задачи доступных магазинов и может назначать ответственных." },
  ],
  super_admin: [
    { selector: "[data-tour='role-switcher']", title: "Переключение роли", description: "Выберите роль, чтобы проверить приложение глазами соответствующего сотрудника." },
    { selector: "[data-tour='nav-admin']", title: "Администрирование", description: "Откройте управление сотрудниками, магазинами, графиками и настройками." },
    { selector: "[data-tour='home-tasks']", title: "Задачи", description: "Здесь можно контролировать задачи по доступным магазинам." },
  ],
  developer: [
    { selector: "[data-tour='role-switcher']", title: "Переключение роли", description: "У разработчика доступны разные интерфейсы. Нажмите на роль и выберите нужный режим." },
    { selector: "[data-tour='nav-admin']", title: "Проверка управления", description: "Откройте административный раздел для проверки сотрудников, магазинов и графиков." },
    { selector: "[data-tour='help-button']", title: "Повторный запуск", description: "Режим обучения можно включить в любой момент, в том числе после переключения роли." },
  ],
  buyer: [
    { selector: "[data-tour='nav-procurement']", title: "Закупки и акции", description: "Откройте раздел, чтобы создавать заказы, менять их статусы и работать с акциями." },
    { selector: "[data-tour='home-tasks']", title: "Задачи", description: "Проверяйте поручения, связанные с доступными магазинами." },
  ],
  auditor: [
    { selector: "[data-tour='nav-checklists']", title: "Архив проверок", description: "Здесь хранятся результаты завершённых чек-листов." },
    { selector: "[data-tour='home-tasks']", title: "Задачи", description: "Откройте задачу, чтобы увидеть магазин, ответственного и срок." },
  ],
  warehouse_manager: [
    { selector: "[data-tour='nav-admin']", title: "Управление складом", description: "Откройте доступные складские данные и административные функции." },
    { selector: "[data-tour='nav-procurement']", title: "Закупки", description: "Контролируйте заказы и обновляйте их статусы." },
  ],
  warehouse_assistant: [
    { selector: "[data-tour='home-tasks']", title: "Задачи склада", description: "Здесь отображаются задачи, которые нужно выполнить по доступным магазинам." },
    { selector: "[data-tour='bottom-nav']", title: "Переходы по разделам", description: "Используйте пункты меню для перехода к задачам, зарплате и уведомлениям." },
  ],
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function trainingWasSeen(key: string) {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function markTrainingSeen(key: string) {
  try {
    window.localStorage.setItem(key, "1");
  } catch {
    // Some embedded browsers can temporarily block localStorage.
  }
}

export function TrainingOverlay({ userId, activeRole }: { userId: string | null; activeRole: string | null }) {
  const pathname = usePathname();
  const role = normalizeHelpRole(activeRole);
  const storageKey = `do4a-training-seen:${userId ?? "guest"}:${role}`;
  const steps = useMemo(() => [...commonSteps, ...(roleSteps[role] ?? [])], [role]);
  const [open, setOpen] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (!userId || trainingWasSeen(storageKey)) {
      return;
    }

    setStepIndex(0);
    setOpen(true);
  }, [storageKey, userId]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const updateTarget = () => {
      const selector = steps[stepIndex]?.selector;
      const target = selector ? document.querySelector(selector) : null;
      setRect(target?.getBoundingClientRect() ?? null);
    };

    updateTarget();
    window.addEventListener("resize", updateTarget);
    window.addEventListener("scroll", updateTarget, true);
    return () => {
      window.removeEventListener("resize", updateTarget);
      window.removeEventListener("scroll", updateTarget, true);
    };
  }, [open, pathname, stepIndex, steps]);

  if (!userId) {
    return null;
  }

  const step = steps[stepIndex] ?? steps[0];
  const finish = () => {
    markTrainingSeen(storageKey);
    setOpen(false);
  };
  const start = () => {
    setStepIndex(0);
    setOpen(true);
  };
  const viewportWidth = typeof window === "undefined" ? 390 : window.innerWidth;
  const viewportHeight = typeof window === "undefined" ? 844 : window.innerHeight;
  const tooltipWidth = Math.min(350, viewportWidth - 24);
  const tooltipLeft = rect ? clamp(rect.left + rect.width / 2 - tooltipWidth / 2, 12, viewportWidth - tooltipWidth - 12) : 12;
  const belowTarget = rect ? rect.top < viewportHeight / 2 : false;
  const tooltipStyle = rect
    ? belowTarget
      ? { left: tooltipLeft, top: Math.min(rect.bottom + 18, viewportHeight - 250) }
      : { left: tooltipLeft, bottom: Math.max(viewportHeight - rect.top + 18, 18) }
    : { left: tooltipLeft, top: "50%", transform: "translateY(-50%)" };

  return (
    <>
      <button
        aria-label="Запустить обучение"
        className="fixed bottom-[calc(5.75rem+env(safe-area-inset-bottom))] right-4 z-[90] grid h-10 w-10 place-items-center rounded-full border border-brand/50 bg-[#120b0c]/95 text-brand shadow-[0_0_18px_rgba(255,57,72,0.3)]"
        data-tour="help-button"
        onClick={start}
        title="Обучение"
        type="button"
      >
        <HelpCircle size={20} />
      </button>

      {open ? (
        <div className="fixed inset-0 z-[100]" role="dialog" aria-label="Режим обучения">
          {rect ? <div className="pointer-events-none fixed rounded-xl border-2 border-brand shadow-[0_0_0_9999px_rgba(0,0,0,0.62),0_0_24px_rgba(255,57,72,0.65)]" style={{ left: rect.left - 6, top: rect.top - 6, width: rect.width + 12, height: rect.height + 12 }} /> : null}
          <div className="fixed w-[min(350px,calc(100vw-24px))] rounded-2xl border border-brand/50 bg-[#120b0c]/98 p-4 text-ink shadow-[0_18px_60px_rgba(0,0,0,0.7),0_0_28px_rgba(193,18,31,0.24)]" style={tooltipStyle}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-brand">Режим обучения · {helpRoleLabels[role]}</p>
                <h2 className="mt-1 text-lg font-semibold">{step.title}</h2>
              </div>
              <button aria-label="Закрыть обучение" className="text-muted hover:text-ink" onClick={finish} type="button"><X size={18} /></button>
            </div>
            <p className="mt-2 text-sm leading-6 text-muted">{step.description}</p>
            <div className="mt-4 flex items-center justify-between gap-2">
              <span className="text-xs text-muted">{stepIndex + 1} из {steps.length}</span>
              <div className="flex items-center gap-2">
                <Link className="inline-flex items-center gap-1 rounded-md px-2 py-2 text-xs font-semibold text-muted hover:text-ink" href={`/help?role=${role}`} onClick={finish}><BookOpen size={14} /> Инструкция</Link>
                {stepIndex > 0 ? <button className="inline-flex items-center gap-1 rounded-md px-2 py-2 text-xs font-semibold text-muted hover:text-ink" onClick={() => setStepIndex((value) => value - 1)} type="button"><ChevronLeft size={15} /> Назад</button> : null}
                {stepIndex < steps.length - 1 ? <button className="inline-flex items-center gap-1 rounded-md bg-brand px-3 py-2 text-xs font-semibold text-white" onClick={() => setStepIndex((value) => value + 1)} type="button">Далее <ChevronRight size={15} /></button> : <button className="inline-flex items-center gap-1 rounded-md bg-brand px-3 py-2 text-xs font-semibold text-white" onClick={finish} type="button"><GraduationCap size={15} /> Завершить</button>}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
