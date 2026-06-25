import { NextResponse } from 'next/server';
import { createClient } from '../../../../../utils/supabase/server';
import { listUsedVideos } from '../../../../../lib/usageProfiles';

async function getUser() {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user?.email) return null;
    return user;
}

export async function GET(request, { params }) {
    const user = await getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const page = Math.max(parseInt(searchParams.get('page') || '1', 10), 1);
    const size = Math.min(Math.max(parseInt(searchParams.get('size') || '100', 10), 1), 500);

    try {
        const data = await listUsedVideos(user.email, id, { page, pageSize: size });
        return NextResponse.json(data);
    } catch (err) {
        console.error('Failed to list used videos:', err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}

