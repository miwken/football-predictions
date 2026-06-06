"use client";

import { supabase } from '@/lib/supabaseClient';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { User } from '@supabase/supabase-js';

interface Tournament {
    id: string;
    name: string;
    access_password: string;
    created_by_user_id: string;
    created_at: string;
}

export default function TournamentsPage() {
    const [user, setUser] = useState<User | null>(null);
    const [tournaments, setTournaments] = useState<Tournament[]>([]);
    const [newTournamentName, setNewTournamentName] = useState('');
    const [newTournamentPassword, setNewTournamentPassword] = useState('');
    const [joinTournamentName, setJoinTournamentName] = useState('');
    const [joinPassword, setJoinPassword] = useState('');
    const router = useRouter();

    useEffect(() => {
        supabase.auth.getUser().then(({ data }) => {
            if (!data.user) router.push('/auth/login');
            else setUser(data.user);
        });
    }, []);

    const loadTournaments = async () => {
        if (!user) return;
        const { data, error } = await supabase
            .from('tournament_members')
            .select('tournament_id, tournaments(*)')
            .eq('user_id', user.id);
        if (error) console.error(error);
        else setTournaments(data.map(m => m.tournaments));
    };

    useEffect(() => {
        if (user) loadTournaments();
    }, [user]);

    const createTournament = async () => {
        if (!newTournamentName || !newTournamentPassword) return alert('Заполните название и пароль');
        const { data: tournament, error: createError } = await supabase
            .from('tournaments')
            .insert([{ name: newTournamentName, access_password: newTournamentPassword, created_by_user_id: user.id }])
            .select()
            .single();
        if (createError) return alert(createError.message);
        const { error: joinError } = await supabase
            .from('tournament_members')
            .insert([{ user_id: user.id, tournament_id: tournament.id }]);
        if (joinError) alert(joinError.message);
        else {
            setNewTournamentName('');
            setNewTournamentPassword('');
            loadTournaments();
        }
    };

    const joinTournament = async () => {
        if (!joinTournamentName || !joinPassword) return alert('Введите название турнира и пароль');
        const { data: tournament, error: findError } = await supabase
            .from('tournaments')
            .select('*')
            .eq('name', joinTournamentName)
            .eq('access_password', joinPassword)
            .maybeSingle();
        if (findError || !tournament) return alert('Турнир не найден или пароль неверен');
        const { error: joinError } = await supabase
            .from('tournament_members')
            .insert([{ user_id: user.id, tournament_id: tournament.id }]);
        if (joinError && joinError.code === '23505') alert('Вы уже участник этого турнира');
        else if (joinError) alert(joinError.message);
        else {
            setJoinTournamentName('');
            setJoinPassword('');
            loadTournaments();
        }
    };

    if (!user) return <div>Загрузка...</div>;

    return (
        <div className="p-4 max-w-2xl mx-auto">
            <h1 className="text-2xl font-bold mb-4">Мои турниры</h1>
            <div className="mb-6">
                <h2 className="text-xl font-semibold">Создать турнир</h2>
                <input className="border p-2 w-full mb-2" placeholder="Название турнира" value={newTournamentName} onChange={e => setNewTournamentName(e.target.value)} />
                <input className="border p-2 w-full mb-2" placeholder="Пароль" type="password" value={newTournamentPassword} onChange={e => setNewTournamentPassword(e.target.value)} />
                <button onClick={createTournament} className="bg-blue-500 text-white p-2 rounded">Создать</button>
            </div>
            <div className="mb-6">
                <h2 className="text-xl font-semibold">Войти в турнир по паролю</h2>
                <input className="border p-2 w-full mb-2" placeholder="Название турнира" value={joinTournamentName} onChange={e => setJoinTournamentName(e.target.value)} />
                <input className="border p-2 w-full mb-2" placeholder="Пароль" type="password" value={joinPassword} onChange={e => setJoinPassword(e.target.value)} />
                <button onClick={joinTournament} className="bg-green-500 text-white p-2 rounded">Войти</button>
            </div>
            <h2 className="text-xl font-semibold mb-2">Ваши турниры</h2>
            {tournaments.length === 0 && <p>Вы ещё не создали и не вступили ни в один турнир.</p>}
            {tournaments.map(t => (
                <div key={t.id} className="border p-2 mb-2 rounded">
                    <strong>{t.name}</strong> (создатель: {t.created_by_user_id === user.id ? 'Вы' : 'Другой'})
                    <button onClick={() => router.push(`/tournament/${t.id}`)} className="ml-4 bg-gray-300 p-1 rounded">Перейти</button>
                </div>
            ))}
        </div>
    );
}