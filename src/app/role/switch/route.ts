import { NextRequest, NextResponse } from "next/server";
import { getCurrentRoleCodes } from "@/lib/auth/roles";

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const requestedRole = String(formData.get("role") ?? "").trim();
  const { user, allRoles } = await getCurrentRoleCodes();

  if (!user || !allRoles.includes(requestedRole)) {
    return NextResponse.redirect(new URL("/", request.url), 303);
  }

  const response = NextResponse.redirect(new URL("/", request.url), 303);
  response.cookies.set("do4a_active_role", requestedRole, {
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  return response;
}
