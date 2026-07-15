import { LoginCard } from "@/components/login-card";

type LoginPageProps = {
  searchParams: Promise<{ message?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { message } = await searchParams;

  return (
    <main className="min-h-dvh bg-[#050404] px-4 py-5">
      <div className="flex min-h-[calc(100dvh-2.5rem)] items-center justify-center">
        <LoginCard initialMessage={message ?? null} />
      </div>
    </main>
  );
}
