import { NextResponse } from 'next/server';
import { createClient } from '../../../utils/supabase/server';
import { getSuggestions } from '../../../lib/localDb';

export async function GET(request) {
    try {
        // Auth check
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const query = searchParams.get('q') || '';

        if (!query.trim() || query.trim().length < 2) {
            return NextResponse.json({ suggestions: [] });
        }

        const suggestions = await getSuggestions(query.trim());

        return NextResponse.json({ suggestions });
    } catch (e) {
        console.error('Suggestions error:', e.message);
        return NextResponse.json({ suggestions: [] });
    }
}
