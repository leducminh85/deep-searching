import React from 'react';
import { cookies } from 'next/headers';
import { createClient } from '../utils/supabase/server';
import { getActiveProfile } from '../lib/usageProfiles';
import { getDataInternal } from './api/data/route';
import HomePageClient from './HomePageClient';

const SEARCH_MODE_COOKIE = 'searchMode';
const VALID_SEARCH_MODES = new Set(['and', 'or']);

export default async function HomePage() {
  const supabase = await createClient();
  const cookieStore = await cookies();
  const { data: { user } } = await supabase.auth.getUser();

  const page = 1;
  const pageSize = 50;
  const sortBy = 'date_published';
  const sortOrder = 'desc';
  const cookieSearchMode = cookieStore.get(SEARCH_MODE_COOKIE)?.value;
  const mode = VALID_SEARCH_MODES.has(cookieSearchMode) ? cookieSearchMode : 'and';
  const query = null;
  const minViews = null;
  const maxViews = null;
  const startDate = null;
  const endDate = null;
  const channels = null;
  const captionSearch = true;

  let initialData = { data: [], total: 0, error: null };
  let initialProfile = null;

  if (user?.email) {
    try {
      initialProfile = await getActiveProfile(user.email);
      const [data, total, errorInfo] = await getDataInternal(
        query,
        page,
        pageSize,
        sortBy,
        sortOrder,
        mode,
        minViews,
        maxViews,
        startDate,
        endDate,
        channels,
        captionSearch,
        initialProfile?.id || null,
        user.email,
        Boolean(initialProfile)
      );

      if (errorInfo) {
        initialData.error = errorInfo;
      } else {
        initialData.data = data;
        initialData.total = total;
      }
    } catch (e) {
      initialData.error = e.message;
    }
  }

  return (
    <HomePageClient
      initialData={initialData}
      initialProfile={initialProfile}
      initialSearchMode={mode}
      currentUserKey={user?.id || user?.email || 'anonymous'}
    />
  );
}
