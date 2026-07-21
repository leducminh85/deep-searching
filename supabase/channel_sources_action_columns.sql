ALTER TABLE public.channel_sources
ADD COLUMN IF NOT EXISTS user_email TEXT,
ADD COLUMN IF NOT EXISTS action_type TEXT NOT NULL DEFAULT 'add';

CREATE INDEX IF NOT EXISTS idx_channel_sources_user_email
ON public.channel_sources(user_email);

CREATE INDEX IF NOT EXISTS idx_channel_sources_action_type
ON public.channel_sources(action_type);
