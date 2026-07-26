import { NextResponse } from 'next/server';
import { resetUserPassword } from '../../../../../../lib/adminUsers';
import { requireAdmin } from '../../../../../../lib/adminAuth';

export async function PATCH(request, { params }) {
    const unauthorized = await requireAdmin();
    if (unauthorized) return unauthorized;

    try {
        const { id } = await params;
        const body = await request.json();
        const account = await resetUserPassword(id, body.password);
        return NextResponse.json({ account });
    } catch (err) {
        return NextResponse.json({ error: err.message || 'Không thể đặt lại mật khẩu' }, { status: 400 });
    }
}
