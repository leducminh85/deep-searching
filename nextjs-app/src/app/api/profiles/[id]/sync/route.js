import { NextResponse } from 'next/server';
import { createClient } from '../../../../../utils/supabase/server';
import { syncUsageProfile } from '../../../../../lib/googleUsageSync';

export const runtime = 'nodejs';

async function getUser() {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user?.email) return null;
    return user;
}

export async function POST(_request, { params }) {
    const user = await getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;

    try {
        const result = await syncUsageProfile(id, user.email);
        if (!result) {
            return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
        }

        return NextResponse.json(result);
    } catch (err) {
        console.error('Failed to sync usage profile:', err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}

