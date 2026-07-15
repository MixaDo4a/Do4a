import { redirect } from "next/navigation";

type SupabaseErrorLike = {
  message?: string;
} | null;

export function isInvalidJwtTimeError(error: SupabaseErrorLike) {
  return error?.message?.toLowerCase().includes("jwt issued at future") ?? false;
}

export function redirectInvalidSession(error: SupabaseErrorLike) {
  if (isInvalidJwtTimeError(error)) {
    redirect("/auth/reset?message=session-expired");
  }
}
