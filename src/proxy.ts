import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refreshes the Supabase session cookie and redirects anonymous visitors to /login.
 * This is an optimistic check only — every page and API route re-verifies the founder
 * server-side (src/lib/auth.ts).
 */
export async function proxy(request: NextRequest) {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const { pathname } = request.nextUrl;
  const isPublic = pathname.startsWith("/login") || pathname.startsWith("/api/cron") || pathname.startsWith("/api/health");
  let response = NextResponse.next({ request });
  if (!url || !key) {
    if (isPublic) return response;
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });
    return NextResponse.redirect(new URL("/login?error=not_configured", request.url));
  }
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(toSet) {
        toSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const { data } = await supabase.auth.getUser();
  if (!data.user && !isPublic) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
    const to = new URL("/login", request.url);
    return NextResponse.redirect(to);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
