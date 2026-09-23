"use client";
import { useState } from "react";

type Entity = "campaigns" | "menus" | "products" | "addon_groups" | "addons";
const labels: Record<Entity, string> = { campaigns: "Акции", menus: "Меню", products: "Продукты", addon_groups: "Группы допов", addons: "Допы" };

export default function AdminPage() {
  const [entity, setEntity] = useState<Entity>("campaigns");
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [parent, setParent] = useState("");
  const [message, setMessage] = useState("");
  async function save(e: React.FormEvent) {
    e.preventDefault(); setMessage("Сохраняю…");
    const data: Record<string, unknown> = { name };
    if (entity === "products") Object.assign(data, { price: Number(price || 0), menu_id: parent });
    if (entity === "menus") data.campaign_id = parent;
    if (entity === "addons") Object.assign(data, { price: Number(price || 0), group_id: parent });
    const response = await fetch("/api/admin/catalog", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entity, data }) });
    setMessage(response.ok ? "Сохранено" : `Ошибка: ${await response.text()}`); if (response.ok) { setName(""); setPrice(""); }
  }
  return <main className="min-h-screen bg-slate-100 p-6 text-slate-900"><div className="mx-auto max-w-4xl"><h1 className="text-3xl font-bold">Конструктор Bubble Up</h1><p className="mt-2 text-slate-600">Онлайн-каталог и приложение используют одни данные Supabase.</p><div className="mt-6 grid gap-6 md:grid-cols-[220px_1fr]"><nav className="rounded-2xl bg-white p-3 shadow">{(Object.keys(labels) as Entity[]).map((key) => <button key={key} onClick={() => setEntity(key)} className={`mb-1 w-full rounded-xl px-4 py-3 text-left ${entity === key ? "bg-blue-600 text-white" : "hover:bg-slate-100"}`}>{labels[key]}</button>)}</nav><form onSubmit={save} className="rounded-2xl bg-white p-6 shadow"><h2 className="text-xl font-semibold">Создать: {labels[entity]}</h2><label className="mt-5 block text-sm">Название<input required value={name} onChange={e => setName(e.target.value)} className="mt-1 w-full rounded-xl border p-3" /></label>{["products", "addons"].includes(entity) && <label className="mt-4 block text-sm">Цена<input type="number" value={price} onChange={e => setPrice(e.target.value)} className="mt-1 w-full rounded-xl border p-3" /></label>}{["menus", "products", "addons"].includes(entity) && <label className="mt-4 block text-sm">ID родительской записи<input required value={parent} onChange={e => setParent(e.target.value)} placeholder="UUID из списка" className="mt-1 w-full rounded-xl border p-3" /></label>}<button className="mt-6 rounded-xl bg-blue-600 px-5 py-3 font-semibold text-white">Сохранить</button>{message && <p className="mt-4 text-sm">{message}</p>}</form></div></div></main>;
}
