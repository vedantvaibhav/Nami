import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)

// Single source of truth for the display bits of a Supabase auth user (Google
// metadata shape lives here, not scattered across the avatar + settings UI).
export function userProfile(user) {
  const meta = user?.user_metadata || {}
  const email = user?.email || ''
  return {
    avatarUrl: meta.avatar_url || meta.picture || null,
    name: meta.full_name || meta.name || 'Signed in',
    email,
    initial: (email || '?')[0].toUpperCase(),
  }
}
