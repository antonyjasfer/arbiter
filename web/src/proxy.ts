// Next 16 proxy (formerly middleware): signed-out visitors to app pages go to the sign-in flow.
export { auth as proxy } from "@/auth";

export const config = { matcher: ["/dashboard/:path*", "/projects/:path*"] };
