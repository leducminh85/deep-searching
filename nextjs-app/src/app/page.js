import React from 'react';
import { createClient } from '../utils/supabase/server';
import { getDataInternal } from './api/data/route';
import HomePageClient from './HomePageClient';

export default async function HomePage() {
  const supabase = await createClient();
  
  // Lấy người dùng hiện tại (nếu cần thiết cho bảo mật, route handler sẽ tự bắt lỗi nếu ko có)
  const { data: { user } } = await supabase.auth.getUser();

  // Load sẵn 50 rows mới nhất
  const page = 1;
  const pageSize = 50; 
  const sortBy = 'date_published';
  const sortOrder = 'desc';
  const mode = 'or';
  const query = null;
  const minViews = null;
  const maxViews = null;
  const startDate = null;
  const endDate = null;
  const channels = null;
  const captionSearch = true;

  let initialData = { data: [], total: 0, error: null };

  if (user) {
    try {
      const [data, total, errorInfo] = await getDataInternal(
        supabase, query, page, pageSize, sortBy, sortOrder, mode,
        minViews, maxViews, startDate, endDate, channels, captionSearch
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

  return <HomePageClient initialData={initialData} />;
}
