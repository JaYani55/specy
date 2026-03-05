import { createClient } from '@supabase/supabase-js';

const MAX_RETRIES = 3;

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

console.log('Supabase URL:', supabaseUrl ? 'Set' : 'Not set'); // Don't log the actual URL for security
console.log('Supabase Publishable Key:', supabasePublishableKey ? 'Set' : 'Not set'); // Don't log the actual key

if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error('Missing Supabase environment variables');
}

// Create a custom storage implementation
class CustomStorage implements Storage {
  getItem(key: string): string | null {
    try {
      const value = localStorage.getItem(key);
      if (value !== null) return value;
      return sessionStorage.getItem(key);
    } catch (err) {
      console.warn("Storage read error:", err);
      return null;
    }
  }

  setItem(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
      try { sessionStorage.setItem(key, value); } catch (e) { /* ignore */ }
    } catch (err) {
      console.warn("Storage write error:", err);
    }
  }

  removeItem(key: string): void {
    try {
      localStorage.removeItem(key);
      try { sessionStorage.removeItem(key); } catch (e) { /* ignore */ }
    } catch (err) {
      console.warn("Storage remove error:", err);
    }
  }

  // Required by Storage interface
  clear(): void {
    try {
      // Clear all storage types
      localStorage.clear();
      sessionStorage.clear();
      
      // Clear all cookies
      document.cookie.split(";").forEach(cookie => {
        const eqPos = cookie.indexOf("=");
        const name = eqPos > -1 ? cookie.substr(0, eqPos) : cookie;
        document.cookie = name + "=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/";
      });

      // Clear IndexedDB (Firefox specific)
      window.indexedDB.databases?.().then(dbs => {
        dbs?.forEach(db => {
          window.indexedDB.deleteDatabase(db.name);
        });
      }).catch(() => {
        // Ignore errors if databases() is not supported
      });

    } catch (err) {
      console.warn("Storage clear error:", err);
    }
  }

  // Required by Storage interface
  get length(): number {
    try {
      return localStorage.length;
    } catch (err) {
      console.warn("Storage length error:", err);
      return 0;
    }
  }

  // Required by Storage interface
  key(index: number): string | null {
    try {
      return localStorage.key(index);
    } catch (err) {
      console.warn("Storage key error:", err);
      return null;
    }
  }
}

// Enhanced configuration for better cross-browser support
export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: true,
    detectSessionInUrl: false,
    storageKey: 'supabase.auth.token',
    flowType: 'pkce',
    storage: new CustomStorage() // Add this line to use your CustomStorage
  },
  global: {
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'pragma': 'no-cache',
      'cache-control': 'no-cache'
    }
  }
});
