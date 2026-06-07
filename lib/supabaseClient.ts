import { createBrowserClient } from '@supabase/ssr'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey, {
    cookieOptions: {
        path: '/',
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
    },
    global: {
        fetch: (url, options) => {
            // Добавляем таймаут для мобильных сетей
            return fetch(url, { ...options, signal: AbortSignal.timeout(15000) });
        }
    }
});