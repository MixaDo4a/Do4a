import { registerPreviewWebhook } from "./actions";

export const dynamic = "force-dynamic";

const messages: Record<string, string> = {
  registered: "Webhook Preview зарегистрирован. Отправь тестовое фото с подписью в тему Staff.",
  failed: "Telegram не подтвердил регистрацию webhook. Проверь переменные Preview и повтори попытку.",
  "not-configured": "Для Preview не хватает настроек бота или Vercel bypass. Значения секретов здесь не показываются.",
  "preview-only": "Эта операция доступна только в Preview; Production не изменён.",
};

export default async function StaffQaSetupPage({ searchParams }: { searchParams: Promise<{ result?: string }> }) {
  const { result } = await searchParams;
  return (
    <main className="mx-auto flex min-h-screen max-w-xl items-center px-5 py-12 text-white">
      <section className="w-full rounded-lg border border-white/15 bg-black/85 p-6 shadow-2xl">
        <h1 className="text-xl font-semibold">Staff QA · тестовый бот</h1>
        <p className="mt-3 text-sm text-white/75">
          Подключить Telegram к этому Preview-деплою. Секреты берутся из настроек Vercel и не отображаются.
        </p>
        {result && messages[result] && (
          <p role="status" className={`mt-4 rounded-md border p-3 text-sm ${result === "registered" ? "border-green-500/50 text-green-200" : "border-red-500/50 text-red-200"}`}>
            {messages[result]}
          </p>
        )}
        <form action={registerPreviewWebhook} className="mt-6">
          <button className="w-full rounded-md bg-red-600 px-4 py-3 font-semibold text-white hover:bg-red-500">
            Зарегистрировать webhook Preview
          </button>
        </form>
      </section>
    </main>
  );
}
