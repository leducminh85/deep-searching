import { updateSession } from './utils/supabase/middleware'

export async function middleware(request) {
  return updateSession(request)
}

export const config = {
  matcher: [
    /*
     * Apply auth/session middleware to pages and API routes, while skipping
     * Next internals and static assets.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
