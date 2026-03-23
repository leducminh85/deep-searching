import { createClient } from '../../../../utils/supabase/server'
import { NextResponse } from 'next/server'

export async function POST() {
  const supabase = await createClient()

  const { error } = await supabase.auth.signOut()

  if (error) {
    return NextResponse.json({ error: 'Lỗi đăng xuất' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
