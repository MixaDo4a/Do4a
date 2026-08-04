import { NextResponse } from "next/server";

const DEFAULT_VAPID_PUBLIC_KEY = "BFgY2jIvl9oemJkNO8wua2bf5AMPDuFFo1MJQv_WDmjfM7zLXG1hKbHIq79QJsLxWWXV-T83JXOlWiheO3bBslY";

export async function GET() {
  return NextResponse.json({
    publicKey: process.env.NEXT_PUBLIC_PUSH_VAPID_PUBLIC_KEY?.trim() || DEFAULT_VAPID_PUBLIC_KEY,
  });
}
