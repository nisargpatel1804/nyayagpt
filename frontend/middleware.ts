import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createMiddlewareClient } from "@supabase/auth-helpers-nextjs";

export async function middleware(request: NextRequest) {
  // 1. Enforce HTTPS in Production
  if (process.env.NODE_ENV === "production") {
    const forwardedProto = request.headers.get("x-forwarded-proto");
    const isHttps = forwardedProto ? forwardedProto === "https" : request.nextUrl.protocol === "https:";
    if (!isHttps) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.protocol = "https:";
      return NextResponse.redirect(redirectUrl);
    }
  }

  // 2. Initialize Supabase Middleware Client
  // This is critical to refresh the auth cookie if it's close to expiry
  const response = NextResponse.next();
  const supabase = createMiddlewareClient({ req: request, res: response });
  
  const {
    data: { session }
  } = await supabase.auth.getSession();

  const requiresAuth = request.nextUrl.pathname.startsWith("/dashboard");

  // 3. Authenticated User Checks
  if (requiresAuth && session) {
    const { data: userData } = await supabase.auth.getUser();
    const user = userData?.user;

    // A. Enforce Email Confirmation
    const emailConfirmed = Boolean(user?.email_confirmed_at);
    if (!emailConfirmed) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = "/login";
      redirectUrl.searchParams.set("unverified", "1");
      return NextResponse.redirect(redirectUrl);
    }

    // B. Enforce 12-Hour Hard Session Limit
    // This prevents stale tokens from being used indefinitely
    const lastSignInAt = user?.last_sign_in_at ? new Date(user.last_sign_in_at).getTime() : 0;
    const maxSessionAgeMs = 12 * 60 * 60 * 1000; // 12 Hours
    
    if (lastSignInAt && Date.now() - lastSignInAt > maxSessionAgeMs) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = "/login";
      redirectUrl.searchParams.set("reauth", "1");
      return NextResponse.redirect(redirectUrl);
    }
  }

  // 4. Redirect Unauthenticated Users
  if (requiresAuth && !session) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}

export const config = {
  matcher: ["/dashboard", "/dashboard/:path*"]
};