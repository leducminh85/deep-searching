import { NextResponse } from 'next/server';
import { createClient } from '../../../../utils/supabase/server';
import { deleteProfile, updateProfile } from '../../../../lib/usageProfiles';

async function getUser() {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user?.email) return null;
    return user;
}

export async function PATCH(request, { params }) {
    const user = await getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;

    try {
        const body = await request.json();
        const profile = await updateProfile(user.email, id, {
            name: body.name,
            googleSheetUrl: body.google_sheet_url || body.googleSheetUrl,
            tabScope: body.tab_scope || body.tabScope,
        });

        if (!profile) {
            return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
        }

        return NextResponse.json({ profile });
    } catch (err) {
        console.error('Failed to update usage profile:', err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}

export async function DELETE(_request, { params }) {
    const user = await getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;

    try {
        const deleted = await deleteProfile(user.email, id);
        if (!deleted) {
            return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
        }

        return NextResponse.json({ success: true });
    } catch (err) {
        console.error('Failed to delete usage profile:', err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
