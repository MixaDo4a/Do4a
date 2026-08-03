"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckSquare, Square } from "lucide-react";
import type { RoutineKind, RoutineTemplateItemNode } from "@/lib/routine";
import { routineKindShortLabel } from "@/lib/routine";

type SessionItemMap = Record<
  string,
  {
    completedAt: string;
  }
>;

type Props = {
  shiftId: string;
  kind: RoutineKind;
  title: string;
  items: RoutineTemplateItemNode[];
  sessionItems: SessionItemMap;
  startedAt?: string | null;
  completedAt?: string | null;
};

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function TreeRow({
  node,
  depth,
  sessionItems,
  onToggle,
  disabled,
}: {
  node: RoutineTemplateItemNode;
  depth: number;
  sessionItems: SessionItemMap;
  onToggle: (id: string, next: boolean) => void;
  disabled?: boolean;
}) {
  const nodeId = String(node.id ?? node.title);
  const checked = Boolean(sessionItems[nodeId]);
  const completedAt = sessionItems[nodeId]?.completedAt;

  return (
    <li className="relative">
      <button
        className={`flex w-full items-start gap-3 rounded-2xl border border-line/80 bg-[#0d090a]/92 p-3 text-left transition ${
          checked ? "opacity-70" : "hover:border-brand/60 hover:bg-[#120b0d]"
        } ${disabled ? "cursor-not-allowed" : ""}`}
        disabled={disabled}
        onClick={(event) => {
          event.preventDefault();
          onToggle(nodeId, !checked);
        }}
        type="button"
      >
        <span
          className={`mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border ${
            checked ? "border-brand bg-brand text-white" : "border-line text-muted"
          }`}
        >
          {checked ? <CheckSquare size={16} /> : <Square size={16} />}
        </span>
        <span className="min-w-0 flex-1">
          <span
            className={`block ${checked ? "text-sm text-muted line-through" : "font-medium text-ink"}`}
            style={{ marginLeft: depth * 12 }}
          >
            {node.title}
          </span>
          {checked && completedAt ? <span className="mt-1 block text-[11px] text-muted">{formatTimestamp(completedAt)}</span> : null}
        </span>
      </button>

      {node.children.length > 0 ? (
        <ul className="mt-2 space-y-2">
          {node.children.map((child) => (
            <TreeRow
              key={child.id ?? child.title}
              node={child}
              depth={depth + 1}
              sessionItems={sessionItems}
              onToggle={onToggle}
              disabled={disabled}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function RoutineChecklistClient({
  shiftId,
  kind,
  title,
  items,
  sessionItems,
  startedAt,
  completedAt,
}: Props) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const completedCount = useMemo(() => Object.keys(sessionItems).length, [sessionItems]);
  const totalCount = useMemo(() => {
    const walk = (nodes: RoutineTemplateItemNode[]): number =>
      nodes.reduce((sum, node) => sum + 1 + walk(node.children), 0);
    return walk(items);
  }, [items]);

  async function toggleItem(itemId: string, next: boolean) {
    setPendingId(itemId);
    try {
      const response = await fetch(`/routine/${kind}/toggle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shiftId,
          templateItemId: itemId,
          completed: next,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "Не удалось обновить пункт распорядка");
      }

      startTransition(() => {
        router.refresh();
      });
    } catch (error) {
      console.error(error);
    } finally {
      setPendingId(null);
    }
  }

  return (
    <section className="ui-panel p-4 shadow-soft">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="mt-1 text-sm text-muted">
            {routineKindShortLabel(kind)} · {completedCount}/{totalCount} отмечено
          </p>
        </div>
        {startedAt ? (
          <p className="text-right text-xs text-muted">
            Начато:{" "}
            {new Intl.DateTimeFormat("ru-RU", {
              hour: "2-digit",
              minute: "2-digit",
              day: "numeric",
              month: "short",
            }).format(new Date(startedAt))}
          </p>
        ) : null}
      </div>

      {completedAt ? (
        <p className="mt-3 rounded-2xl border border-brand/30 bg-brand/10 px-3 py-2 text-sm text-ink">
          Распорядок заполнен: {formatTimestamp(completedAt)}
        </p>
      ) : null}

      <ul className="mt-4 space-y-2">
        {items.map((node) => {
          const nodeId = String(node.id ?? node.title);
          return (
            <TreeRow
              key={nodeId}
              node={node}
              depth={0}
              sessionItems={sessionItems}
              disabled={Boolean(pendingId && pendingId !== nodeId)}
              onToggle={toggleItem}
            />
          );
        })}
      </ul>
    </section>
  );
}

