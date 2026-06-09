import { createBrowserClient } from '@supabase/ssr'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey, {
    cookieOptions: {
        path: '/',
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        // Не указываем domain явно, чтобы работало на всех поддоменах Vercel
    },
    global: {
        fetch: (url, options) => {
            // Увеличиваем таймаут до 30 секунд для мобильных сетей
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30000);
            return fetch(url, { ...options, signal: controller.signal })
                .finally(() => clearTimeout(timeoutId));
        }
    }
});