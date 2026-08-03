import { NextResponse } from "next/server";

const DEFAULT_VAPID_PUBLIC_KEY = "BF1Q5aoYYhlwUtRclWYDernLq4jJgOhJFCg_q05C2kWpiiOk7MbSpbS7ZA_58AK8856JBtmhVXhiL2gpL4hPl28";

export async function GET() {
  return NextResponse.json({
    publicKey: process.env.NEXT_PUBLIC_PUSH_VAPID_PUBLIC_KEY?.trim() ?? DEFAULT_VAPID_PUBLIC_KEY,
  });
}
