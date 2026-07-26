import { NextResponse } from 'next/server';
import { createUserAccount, listUserAccounts } from '../../../../lib/adminUsers';
import { requireAdmin } from '../../../../lib/adminAuth';

function publicAccountError(err, fallback) {
    const message = String(err?.message || '').toLowerCase();
    if (message.includes('service_role') || message.includes('supabase_service')) {
        return 'Thiếu SUPABASE_SERVICE_ROLE_KEY trên server để quản lý Supabase Auth.';
    }
    if (message.includes('email')) {
        return 'Email không hợp lệ hoặc đã được sử dụng.';
    }
    if (message.includes('password') || message.includes('mật khẩu')) {
        return 'Mật khẩu cần ít nhất 8 ký tự.';
    }
    return err?.message || fallback;
}

export async function GET() {
    const unauthorized = await requireAdmin();
    if (unauthorized) return unauthorized;

    try {
        const result = await listUserAccounts({ page: 1, perPage: 1000 });
        return NextResponse.json({ accounts: result.users, total: result.total });
    } catch (err) {
        return NextResponse.json({ error: publicAccountError(err, 'Không thể tải danh sách người dùng') }, { status: 500 });
    }
}

export async function POST(request) {
    const unauthorized = await requireAdmin();
    if (unauthorized) return unauthorized;

    try {
        const body = await request.json();
        const account = await createUserAccount({
            email: body.email,
            password: body.password,
            emailConfirm: body.emailConfirm !== false,
        });
        return NextResponse.json({ account }, { status: 201 });
    } catch (err) {
        return NextResponse.json({ error: publicAccountError(err, 'Không thể tạo người dùng') }, { status: 400 });
    }
}
