import { NextResponse } from 'next/server';
import { createClient } from '../../../../utils/supabase/server';
import { syncAllUsageProfiles } from '../../../../lib/googleUsageSync';

export const runtime = 'nodejs';

async function getUser() {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user?.email) return null;
    return user;
}

export async function POST() {
    const user = await getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    try {
        const result = await syncAllUsageProfiles(user.email);
        return NextResponse.json(result);
    } catch (err) {
        console.error('Failed to sync usage profiles:', err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
