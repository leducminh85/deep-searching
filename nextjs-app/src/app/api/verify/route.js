import { NextResponse } from 'next/server';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Leducminh123';

export async function POST(request) {
    try {
        const formData = await request.formData();
        const password = formData.get('password');

        if (password !== ADMIN_PASSWORD) {
            return NextResponse.json({ detail: 'Invalid password' }, { status: 401 });
        }
        return NextResponse.json({ status: 'ok' });
    } catch (e) {
        return NextResponse.json({ detail: e.message }, { status: 500 });
    }
}
