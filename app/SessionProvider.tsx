'use client';

import { supabase } from '@/lib/supabaseClient';
import { useEffect, useState } from 'react';

export default function SessionProvider({ children }: { children: React.ReactNode }) {
    const [ready, setReady] = useState(false);

    useEffect(() => {
        const initSession = async () => {
            // Пытаемся восстановить сессию из localStorage (если есть)
            const storedSession = localStorage.getItem('supabase_session');
            if (storedSession) {
                try {
                    const { data } = await supabase.auth.setSession(JSON.parse(storedSession));
                    if (data.session) {
                        console.log('Session restored from localStorage');
                    }
                } catch (e) {
                    console.error('Failed to restore session', e);
                }
            }

            // Подписываемся на изменения сессии, чтобы сохранять её в localStorage
            const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
                if (session) {
                    localStorage.setItem('supabase_session', JSON.stringify(session));
                } else {
                    localStorage.removeItem('supabase_session');
                }
                setReady(true);
            });

            setReady(true);
            return () => listener?.subscription.unsubscribe();
        };

        initSession();
    }, []);

    if (!ready) return <div>Загрузка...</div>;
    return <>{children}</>;
}