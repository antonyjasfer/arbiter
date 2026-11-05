// Next 16 proxy (formerly middleware). Malformed ids get a real HTTP 404 before rendering; signed-out
// visitors to app pages go to the sign-in page. (With a handler function, Auth.js leaves the redirect to
// the handler, so it is done here; pages also check the session themselves.)
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isMalformedRoute, requiresSignIn } from "@/lib/route-ids";

export const proxy = auth((request) => {
  const { pathname } = request.nextUrl;
  if (isMalformedRoute(pathname)) {
    return new NextResponse("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  if (requiresSignIn(pathname) && !request.auth?.user?.id) {
    const signIn = new URL("/api/auth/signin", request.nextUrl.origin);
    signIn.searchParams.set("callbackUrl", request.nextUrl.href);
    return NextResponse.redirect(signIn);
  }
  return undefined;
});

export const config = { matcher: ["/dashboard/:path*", "/projects/:path*", "/invite/:path*", "/settings/:path*"] };
