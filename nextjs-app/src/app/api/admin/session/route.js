import { NextResponse } from 'next/server';
import { clearAdminCookie, isAdminRequest, setAdminCookie, verifyAdminPassword } from '../../../../lib/adminAuth';

export async function GET() {
    return NextResponse.json({ authenticated: await isAdminRequest() });
}

export async function POST(request) {
    const body = await request.json().catch(() => ({}));
    if (!verifyAdminPassword(body.password)) {
        return NextResponse.json({ error: 'Mat khau khong dung' }, { status: 401 });
    }

    return setAdminCookie(NextResponse.json({ authenticated: true }));
}

export async function DELETE() {
    return clearAdminCookie(NextResponse.json({ authenticated: false }));
}
