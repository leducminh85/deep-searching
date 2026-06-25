import { NextResponse } from 'next/server';
import { createClient } from '../../../../utils/supabase/server';
import { setActiveProfile } from '../../../../lib/usageProfiles';

export const dynamic = 'force-dynamic';

async function getUser() {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user?.email) return null;
    return user;
}

export async function POST(request) {
    try {
        const user = await getUser();
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json().catch(() => ({}));
        const profileId = body.profile_id || body.profileId || null;
        const profile = await setActiveProfile(user.email, profileId);

        if (profileId && !profile) {
            return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
        }

        return NextResponse.json({ profile });
    } catch (err) {
        console.error('Select usage profile error:', err);
        return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
    }
}
