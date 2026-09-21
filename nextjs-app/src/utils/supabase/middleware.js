import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'

function isInvalidRefreshTokenError(error) {
  return error?.code === 'refresh_token_not_found'
    || error?.code === 'invalid_refresh_token'
    || error?.code === 'session_not_found'
    || /invalid refresh token|refresh token not found|auth session missing/i.test(String(error?.message || ''))
}

function clearSupabaseCookies(request, response) {
  request.cookies.getAll().forEach(({ name }) => {
    if (name.startsWith('sb-')) {
      response.cookies.delete(name)
    }
  })
  return response
}

function isPublicAuthPath(pathname) {
  return pathname.startsWith('/login')
    || pathname.startsWith('/admin')
    || pathname.startsWith('/auth')
    || pathname.startsWith('/api/auth')
    || pathname.startsWith('/api/admin')
}

function authFailureResponse(request, supabaseResponse, error) {
  const invalidSession = isInvalidRefreshTokenError(error)
  const status = invalidSession ? 401 : 503
  const message = invalidSession ? 'Unauthorized' : 'Authentication service unavailable'

  if (!invalidSession) {
    console.warn('[auth] Unable to validate session', {
      path: request.nextUrl.pathname,
      code: error?.code || null,
      message: String(error?.message || error || 'Unknown authentication error'),
    })
  }

  if (isPublicAuthPath(request.nextUrl.pathname)) {
    return invalidSession
      ? clearSupabaseCookies(request, supabaseResponse)
      : supabaseResponse
  }

  if (request.nextUrl.pathname.startsWith('/api/')) {
    const response = NextResponse.json({ error: message }, { status })
    return invalidSession ? clearSupabaseCookies(request, response) : response
  }

  const url = request.nextUrl.clone()
  url.pathname = '/login'
  url.searchParams.set('reason', invalidSession ? 'session_expired' : 'auth_unavailable')
  const response = NextResponse.redirect(url)
  return invalidSession ? clearSupabaseCookies(request, response) : response
}

export async function updateSession(request) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // IMPORTANT: Avoid writing any logic between createServerClient and
  // supabase.auth.getUser(). A simple mistake can make it very hard to debug
  // issues with users being randomly logged out.

  let user = null
  try {
    const result = await supabase.auth.getUser()
    if (result.error) {
      return authFailureResponse(request, supabaseResponse, result.error)
    }
    user = result.data.user
  } catch (error) {
    return authFailureResponse(request, supabaseResponse, error)
  }

  if (
    !user &&
    !request.nextUrl.pathname.startsWith('/login') &&
    !request.nextUrl.pathname.startsWith('/admin') &&
    !request.nextUrl.pathname.startsWith('/auth') &&
    !request.nextUrl.pathname.startsWith('/api/auth') &&
    !request.nextUrl.pathname.startsWith('/api/admin')
  ) {
    // If it's an API request, return 401 instead of redirecting to login HTML
    if (request.nextUrl.pathname.startsWith('/api/')) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    // no user, potentially respond by redirecting the user to the login page
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // IMPORTANT: You *must* return the supabaseResponse object as it is. If you're
  // creating a new response object with NextResponse.next() make sure to:
  // 1. Pass the request in it, like so:
  //    const myNewResponse = NextResponse.next({ request })
  // 2. Copy over the cookies, like so:
  //    myNewResponse.cookies.setAll(supabaseResponse.cookies.getAll())
  // 3. Change the myNewResponse object to fit your needs, but avoid changing
  //    the cookies!
  // 4. Finally: return myNewResponse
  // If this is not done, you may be causing the browser and server to go out
  // of sync and terminate the user's session.

  return supabaseResponse
}
