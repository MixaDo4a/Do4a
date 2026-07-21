import { NextRequest } from "next/server";

export function appRedirectUrl(request: NextRequest, pathname: string) {
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProto || request.nextUrl.protocol.replace(":", "") || "http";
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const hostHeader = request.headers.get("host") || request.nextUrl.host || "localhost:3000";
  let host = forwardedHost || hostHeader;

  if (host.startsWith("0.0.0.0")) {
    host = host.replace("0.0.0.0", "localhost");
  }

  return new URL(pathname, `${protocol}://${host}`);
}
