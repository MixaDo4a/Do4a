import { registerPreviewWebhook } from "./actions";
import { rejectTestReportTwo } from "./review-actions";

export const dynamic = "force-dynamic";

const messages: Record<string, string> = {
  registered: "Webhook Preview зарегистрирован. Отправь тестовое фото с подписью в тему Staff.",
  failed: "Telegram не подтвердил регистрацию webhook. Проверь переменные Preview и повтори попытку.",
  "not-configured": "Для Preview не хватает настроек бота или Vercel bypass. Значения секретов здесь не показываются.",
  "preview-only": "Эта операция доступна только в Preview; Production не изменён.",
  "review-target-mismatch": "Защитная проверка не совпала с ожидаемой заявкой №2; заявка не изменена.",
  "review-already-handled": "Заявка №2 уже обработана или сейчас обрабатывается; повторное действие не выполнено.",
  "review-failed": "Не удалось сохранить результат. Заявка возвращена в очередь; проверьте настройки и историю.",
};

export default async function StaffQaSetupPage({ searchParams }: { searchParams: Promise<{ result?: string; group?: string; owner?: string }> }) {
  const { result, group, owner } = await searchParams;
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
        {process.env.VERCEL_ENV === "preview" && (
          <div className="mt-8 border-t border-white/15 pt-6">
            <h2 className="text-base font-semibold">Проверка заявки №2</h2>
            <p className="mt-2 text-sm text-white/70">Тестовая подпись «пупупу» не описывает дефект. Действие отклонит только эту заранее проверенную заявку и отправит причину в тему Staff и владельцу бота.</p>
            {result === "reviewed" && (
              <p role="status" className="mt-4 rounded-md border border-green-500/50 p-3 text-sm text-green-200">
                Заявка №2 отклонена. Тема: {group === "1" ? "уведомление отправлено" : "не доставлено"}; личное сообщение: {owner === "1" ? "отправлено" : "не доставлено"}.
              </p>
            )}
            <form action={rejectTestReportTwo} className="mt-4">
              <button className="w-full rounded-md border border-red-400/60 px-4 py-3 font-semibold text-red-200 hover:bg-red-950/60">
                Отклонить тестовую заявку №2 и уведомить
              </button>
            </form>
          </div>
        )}
      </section>
    </main>
  );
}
