import { NextResponse } from 'next/server';
import { deleteUserAccount } from '../../../../../lib/adminUsers';
import { requireAdmin } from '../../../../../lib/adminAuth';

export async function DELETE(request, { params }) {
    const unauthorized = await requireAdmin();
    if (unauthorized) return unauthorized;

    try {
        const { id } = await params;
        const account = await deleteUserAccount(id);
        return NextResponse.json({ account });
    } catch (err) {
        return NextResponse.json({ error: err.message || 'Không thể xóa người dùng' }, { status: 400 });
    }
}
