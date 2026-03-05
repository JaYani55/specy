import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// Create a client without the Content-Type header
export const fileUploadClient = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: true,
    detectSessionInUrl: false,
    storageKey: 'supabase.auth.token',
    flowType: 'pkce',
    storage: window.localStorage
  },
  global: {
    headers: {
      'Accept': 'application/json',
      'pragma': 'no-cache',
      'cache-control': 'no-cache'
      // No Content-Type header!
    }
  }
});