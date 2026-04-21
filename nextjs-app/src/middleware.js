import { NextResponse } from 'next/server'

export function middleware(request) {
  // Chuyển hướng ngay lập tức sang domain mới mà không cần kiểm tra
  return NextResponse.redirect('https://deep-seach.wevic.vn/', 301)
}

export const config = {
  matcher: [
    /*
     * Áp dụng cho trang chủ và các đường dẫn khác, 
     * ngoại trừ các tệp tĩnh và API để không làm treo ứng dụng
     */
    '/',
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
