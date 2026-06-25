import { NextResponse } from 'next/server';
import { createClient } from '../../../utils/supabase/server';
import { createProfile, listProfiles } from '../../../lib/usageProfiles';

async function getUser() {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user?.email) return null;
    return user;
}

export async function GET() {
    const user = await getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    try {
        const data = await listProfiles(user.email);
        return NextResponse.json(data);
    } catch (err) {
        console.error('Failed to list usage profiles:', err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}

export async function POST(request) {
    const user = await getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    try {
        const body = await request.json();
        const name = String(body.name || '').trim();
        const googleSheetUrl = String(body.google_sheet_url || body.googleSheetUrl || '').trim();
        const tabScope = body.tab_scope || body.tabScope || 'current';

        if (!name) {
            return NextResponse.json({ error: 'Profile name is required' }, { status: 400 });
        }
        if (!googleSheetUrl) {
            return NextResponse.json({ error: 'Google Sheet URL is required' }, { status: 400 });
        }

        const profile = await createProfile(user.email, { name, googleSheetUrl, tabScope });
        return NextResponse.json({ profile }, { status: 201 });
    } catch (err) {
        console.error('Failed to create usage profile:', err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
