import { NextResponse } from "next/server";
import { getCurrentRoleCodes } from "@/lib/auth/roles";

export async function GET() {
  const { user, roles } = await getCurrentRoleCodes();

  return NextResponse.json({
    authenticated: Boolean(user),
    roles,
  });
}
