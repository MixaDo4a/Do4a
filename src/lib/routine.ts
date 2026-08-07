export type RoutineKind = "morning" | "evening";

export type RoutineTemplateItemNode = {
  id?: string;
  itemKey?: string;
  title: string;
  level: number;
  sortOrder: number;
  children: RoutineTemplateItemNode[];
};

export type RoutineTemplateItemFlatRow = {
  id: string;
  parent_item_id: string | null;
  item_key: string;
  title: string;
  level: number;
  sort_order: number;
  is_active: boolean;
};

export type RoutineTemplateItemSettingsRow = {
  id: string;
  template_id: string;
  item_key: string;
  requires_photo: boolean;
  ai_review_enabled: boolean;
  reference_photo_file_id: string | null;
  reference_photo_file: {
    id: string;
    bucket: string;
    path: string;
    mime_type: string | null;
  } | null;
};

export type RoutineOutlineNode = {
  title: string;
  children: RoutineOutlineNode[];
};

const bulletPattern = /^[-*•>]+\s*/u;

export function routineKindLabel(kind: RoutineKind) {
  return kind === "morning" ? "Утренний распорядок" : "Вечерний распорядок";
}

export function routineKindShortLabel(kind: RoutineKind) {
  return kind === "morning" ? "Утро" : "Вечер";
}

export function defaultRoutineOutlineNodes(kind: RoutineKind): RoutineTemplateItemNode[] {
  const closingBlock =
    kind === "morning"
      ? {
          title: "Подготовка к смене",
          level: 0,
          sortOrder: 1,
          children: [
            { title: "Пересчёт кассы", level: 1, sortOrder: 1, children: [] },
            { title: "Внешний вид", level: 1, sortOrder: 2, children: [] },
          ],
        }
      : {
          title: "Подготовка к закрытию",
          level: 0,
          sortOrder: 1,
          children: [
            { title: "Пересчёт кассы", level: 1, sortOrder: 1, children: [] },
            { title: "Внешний вид", level: 1, sortOrder: 2, children: [] },
          ],
        };

  return [
    closingBlock,
    { title: "Порядок на стойке", level: 0, sortOrder: 2, children: [] },
    {
      title: "Атмосфера магазина",
      level: 0,
      sortOrder: 3,
      children: [
        { title: "Проверить воду в кулере", level: 1, sortOrder: 1, children: [] },
        { title: "Проверить свет неон", level: 1, sortOrder: 2, children: [] },
        { title: "Проверить камеры", level: 1, sortOrder: 3, children: [] },
        {
          title: "Если с чем-то есть проблемы написать управляющему",
          level: 1,
          sortOrder: 4,
          children: [],
        },
      ],
    },
    { title: "Дегустация", level: 0, sortOrder: 4, children: [] },
    { title: "Интернет заказы", level: 0, sortOrder: 5, children: [] },
    { title: "Сроки Спортпит", level: 0, sortOrder: 6, children: [] },
    { title: "Сроки ПП", level: 0, sortOrder: 7, children: [] },
  ];
}

export function buildRoutineTree(rows: RoutineTemplateItemFlatRow[]) {
  const nodes = new Map<string, RoutineTemplateItemNode>();
  const roots: RoutineTemplateItemNode[] = [];

  rows
    .filter((row) => row.is_active)
    .sort((left, right) => left.sort_order - right.sort_order || left.title.localeCompare(right.title, "ru"))
    .forEach((row) => {
      nodes.set(row.id, {
        id: row.id,
        itemKey: row.item_key,
        title: row.title,
        level: row.level,
        sortOrder: row.sort_order,
        children: [],
      });
    });

  rows
    .filter((row) => row.is_active)
    .sort((left, right) => left.sort_order - right.sort_order || left.title.localeCompare(right.title, "ru"))
    .forEach((row) => {
      const node = nodes.get(row.id);
      if (!node) {
        return;
      }

      if (row.parent_item_id && nodes.has(row.parent_item_id)) {
        nodes.get(row.parent_item_id)?.children.push(node);
      } else {
        roots.push(node);
      }
    });

  return roots;
}

export function annotateRoutineTreeKeys(nodes: RoutineTemplateItemNode[], prefix = ""): RoutineTemplateItemNode[] {
  return nodes.map((node, index) => {
    const itemKey = prefix ? `${prefix}.${index + 1}` : `${index + 1}`;

    return {
      ...node,
      itemKey,
      children: annotateRoutineTreeKeys(node.children, itemKey),
    };
  });
}

export function flattenRoutineTree(nodes: RoutineTemplateItemNode[]): RoutineTemplateItemNode[] {
  const result: RoutineTemplateItemNode[] = [];

  for (const node of nodes) {
    result.push(node);
    result.push(...flattenRoutineTree(node.children));
  }

  return result;
}

export function formatRoutineOutline(nodes: RoutineTemplateItemNode[], indent = 0): string {
  const lines: string[] = [];

  for (const node of nodes) {
    lines.push(`${"  ".repeat(indent)}${node.title}`);
    if (node.children.length > 0) {
      lines.push(formatRoutineOutline(node.children, indent + 1));
    }
  }

  return lines.filter(Boolean).join("\n");
}

export function parseRoutineOutline(text: string): RoutineOutlineNode[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\t/g, "  "))
    .map((line) => line.replace(/\s+$/u, ""))
    .filter((line) => line.trim().length > 0);

  type StackItem = {
    indent: number;
    node: RoutineOutlineNode;
  };

  const roots: RoutineOutlineNode[] = [];
  const stack: StackItem[] = [];

  for (const line of lines) {
    const rawIndent = line.match(/^\s*/)?.[0].length ?? 0;
    const indent = Math.floor(rawIndent / 2);
    const title = line.replace(/^\s*/, "").replace(bulletPattern, "").trim();
    if (!title) {
      continue;
    }

    const node: RoutineOutlineNode = { title, children: [] };

    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    if (stack.length === 0) {
      roots.push(node);
    } else {
      stack[stack.length - 1].node.children.push(node);
    }

    stack.push({ indent, node });
  }

  return roots;
}

export function defaultRoutineOutlineText(kind: RoutineKind) {
  return formatRoutineOutline(defaultRoutineOutlineNodes(kind));
}
