import { NextResponse } from 'next/server';
import { createClient } from '../../../../utils/supabase/server';
import { preloadSuggestionIndex } from '../../../../lib/localDb';

export async function GET() {
    try {
        // Auth check
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const index = await preloadSuggestionIndex();

        return NextResponse.json(index, {
            headers: {
                // Cache for 5 minutes in browser
                'Cache-Control': 'private, max-age=300',
            }
        });
    } catch (e) {
        console.error('Preload suggestions error:', e.message);
        return NextResponse.json({ keywords: [], channels: [] });
    }
}
