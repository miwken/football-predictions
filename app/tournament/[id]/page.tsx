"use client";

import { supabase } from '@/lib/supabaseClient';
import { useParams } from 'next/navigation';
import { useEffect, useState, useCallback, useRef } from 'react';

interface Match {
    id: string;
    match_number: number;
    home_team_id: number;
    away_team_id: number;
    city_id: number;
    stage_id: number;
    kickoff_at: string;
    match_label: string;
    home_team_name: string;
    away_team_name: string;
    city_name: string;
    venue_name: string;
    stage_name: string;
    stage_order: number;
}

export default function TournamentPage() {
    const { id } = useParams();
    const [matches, setMatches] = useState<Match[]>([]);
    const [tournamentName, setTournamentName] = useState('');
    const [user, setUser] = useState<any>(null);
    const [isCreator, setIsCreator] = useState(false);
    const [predictions, setPredictions] = useState<Record<string, { home: number; away: number; booster: boolean }>>({});
    const [boostedRounds, setBoostedRounds] = useState<Set<number>>(new Set());
    const [matchResults, setMatchResults] = useState<Record<string, { home: number; away: number }>>({});
    const [leaderboard, setLeaderboard] = useState<{ user_id: string; display_name: string; total_points: number }[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const abortControllerRef = useRef<AbortController | null>(null);

    // Загрузка пользователя и проверка создателя
    useEffect(() => {
        supabase.auth.getUser().then(({ data }) => {
            if (!data.user) return;
            setUser(data.user);
            supabase
                .from('tournaments')
                .select('created_by_user_id')
                .eq('id', id)
                .single()
                .then(({ data: tourney }) => {
                    setIsCreator(tourney?.created_by_user_id === data.user.id);
                });
        });
    }, [id]);

    // Загрузка названия турнира
    useEffect(() => {
        supabase.from('tournaments').select('name').eq('id', id).single().then(({ data }) => {
            if (data) setTournamentName(data.name);
        });
    }, [id]);

    // Загрузка матчей с повторными попытками
    const fetchMatchesWithRetry = useCallback(async (retries = 2) => {
        if (abortControllerRef.current) abortControllerRef.current.abort();
        const controller = new AbortController();
        abortControllerRef.current = controller;

        setLoading(true);
        setError(null);

        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                const { data, error: fetchError } = await supabase
                    .from('matches')
                    .select(`
            id,
            match_number,
            home_team_id,
            away_team_id,
            city_id,
            stage_id,
            kickoff_at,
            match_label,
            home_team:teams!inner (team_name),
            away_team:teams!inner (team_name),
            city:host_cities (city_name, venue_name),
            stage:tournament_stages (stage_name, stage_order)
          `)
                    .order('kickoff_at', { ascending: true })
                    .abortSignal(controller.signal);

                if (fetchError) throw fetchError;
                if (!data || data.length === 0) {
                    setMatches([]);
                } else {
                    const formatted = data.map((m: any) => ({
                        id: m.id,
                        match_number: m.match_number,
                        home_team_id: m.home_team_id,
                        away_team_id: m.away_team_id,
                        city_id: m.city_id,
                        stage_id: m.stage_id,
                        kickoff_at: m.kickoff_at,
                        match_label: m.match_label,
                        home_team_name: m.home_team?.team_name || 'TBD',
                        away_team_name: m.away_team?.team_name || 'TBD',
                        city_name: m.city?.city_name || '',
                        venue_name: m.city?.venue_name || '',
                        stage_name: m.stage?.stage_name || '',
                        stage_order: m.stage?.stage_order || 0,
                    }));
                    setMatches(formatted);
                }
                setLoading(false);
                return;
            } catch (err: any) {
                if (err.name === 'AbortError') return;
                console.error(`Attempt ${attempt + 1} failed:`, err);
                if (attempt === retries) {
                    setError('Не удалось загрузить матчи. Проверьте соединение и попробуйте снова.');
                    setLoading(false);
                } else {
                    await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1))); // задержка перед повторной попыткой
                }
            }
        }
    }, []);

    useEffect(() => {
        fetchMatchesWithRetry();
        return () => {
            if (abortControllerRef.current) abortControllerRef.current.abort();
        };
    }, [fetchMatchesWithRetry]);

    // Остальные запросы (результаты, прогнозы, бустеры, лидерборд)
    useEffect(() => {
        const fetchResults = async () => {
            const { data } = await supabase.from('match_results').select('match_id, score_home, score_away');
            if (data) {
                const resultsMap: Record<string, { home: number; away: number }> = {};
                data.forEach(r => { resultsMap[r.match_id] = { home: r.score_home, away: r.score_away }; });
                setMatchResults(resultsMap);
            }
        };
        fetchResults();
    }, []);

    useEffect(() => {
        if (!user || !id) return;
        supabase
            .from('predictions')
            .select('*')
            .eq('user_id', user.id)
            .eq('tournament_id', id)
            .then(({ data }) => {
                if (data) {
                    const predMap: Record<string, any> = {};
                    data.forEach(p => { predMap[p.match_id] = { home: p.predicted_home, away: p.predicted_away, booster: p.booster_used }; });
                    setPredictions(predMap);
                }
            });
    }, [user, id]);

    useEffect(() => {
        if (!user || !id) return;
        supabase
            .from('tournament_boosters')
            .select('round_number')
            .eq('user_id', user.id)
            .eq('tournament_id', id)
            .then(({ data }) => {
                if (data) setBoostedRounds(new Set(data.map(b => b.round_number)));
            });
    }, [user, id]);

    const fetchLeaderboard = useCallback(async () => {
        if (!id) return;
        const { data: members } = await supabase
            .from('tournament_members')
            .select('user_id, users(display_name)')
            .eq('tournament_id', id);
        if (!members) return;
        const leaderData: { user_id: string; display_name: string; total_points: number }[] = [];
        for (const m of members) {
            const { data: pointsData } = await supabase
                .from('predictions')
                .select('points_earned')
                .eq('tournament_id', id)
                .eq('user_id', m.user_id);
            const total = pointsData?.reduce((sum, p) => sum + (p.points_earned || 0), 0) || 0;
            leaderData.push({
                user_id: m.user_id,
                display_name: m.users?.display_name || 'Anonymous',
                total_points: total,
            });
        }
        leaderData.sort((a, b) => b.total_points - a.total_points);
        setLeaderboard(leaderData);
    }, [id]);

    useEffect(() => {
        fetchLeaderboard();
    }, [fetchLeaderboard, predictions, matchResults]);

    // Остальные обработчики (saveMatchResult, handlePredictionChange, handleBooster, savePrediction) без изменений
    // ... (они такие же, как в предыдущей версии)

    const saveMatchResult = async (matchId: string, home: number, away: number) => {
        if (!isCreator) return alert('Только создатель турнира может вводить результаты');
        const { error } = await supabase
            .from('match_results')
            .upsert({ match_id: matchId, score_home: home, score_away: away, updated_at: new Date() });
        if (error) alert('Ошибка: ' + error.message);
        else {
            alert('Результат сохранён');
            setMatchResults(prev => ({ ...prev, [matchId]: { home, away } }));
            fetchLeaderboard();
        }
    };

    const handlePredictionChange = (matchId: string, field: 'home' | 'away', value: string) => {
        setPredictions(prev => ({
            ...prev,
            [matchId]: {
                ...prev[matchId],
                [field]: value === '' ? '' : parseInt(value),
            }
        }));
    };

    const handleBooster = async (matchId: string, stageOrder: number) => {
        if (boostedRounds.has(stageOrder)) {
            alert('Вы уже использовали бустер на этом этапе');
            return;
        }
        const { error } = await supabase
            .from('tournament_boosters')
            .insert([{ tournament_id: id, user_id: user.id, round_number: stageOrder, match_id: matchId }]);
        if (error) {
            alert(error.message);
            return;
        }
        setBoostedRounds(prev => new Set(prev).add(stageOrder));
        setPredictions(prev => ({
            ...prev,
            [matchId]: { ...prev[matchId], booster: true }
        }));
    };

    const savePrediction = async (match: Match) => {
        const pred = predictions[match.id];
        if (!pred || pred.home === undefined || pred.away === undefined) {
            return alert('Введите счёт');
        }
        if (new Date() >= new Date(match.kickoff_at)) {
            return alert('Прогноз нельзя сделать после начала матча');
        }
        const { error } = await supabase
            .from('predictions')
            .upsert({
                user_id: user.id,
                tournament_id: id,
                match_id: match.id,
                predicted_home: pred.home,
                predicted_away: pred.away,
                booster_used: pred.booster || false,
            }, { onConflict: 'user_id, tournament_id, match_id' });
        if (error) alert(error.message);
        else {
            alert('Прогноз сохранён');
            fetchLeaderboard();
        }
    };

    const matchesByStage = matches.reduce((acc, match) => {
        const stage = match.stage_order;
        if (!acc[stage]) acc[stage] = [];
        acc[stage].push(match);
        return acc;
    }, {} as Record<number, Match[]>);

    if (!user) return <div className="p-4">Загрузка пользователя...</div>;
    if (loading) return <div className="p-4">Загрузка матчей...</div>;
    if (error) return (
        <div className="p-4">
            <p className="text-red-500">{error}</p>
            <button onClick={() => fetchMatchesWithRetry()} className="mt-2 bg-blue-500 text-white p-2 rounded">Повторить</button>
        </div>
    );

    return (
        <div className="p-4 max-w-5xl mx-auto">
            <h1 className="text-2xl font-bold mb-4">Турнир: {tournamentName}</h1>
            <div className="mb-8 p-4 border rounded bg-gray-50">
                <h2 className="text-xl font-semibold mb-2">Таблица лидеров</h2>
                <table className="min-w-full bg-white">
                    <thead><tr><th className="py-2 px-4 border-b">Место</th><th className="py-2 px-4 border-b">Участник</th><th className="py-2 px-4 border-b">Очки</th></tr></thead>
                    <tbody>
                        {leaderboard.map((entry, idx) => (
                            <tr key={entry.user_id} className={entry.user_id === user.id ? 'bg-yellow-100' : ''}>
                                <td className="py-2 px-4 border-b text-center">{idx + 1}</td>
                                <td className="py-2 px-4 border-b">{entry.display_name}</td>
                                <td className="py-2 px-4 border-b text-center font-bold">{entry.total_points}</td>
                            </tr>
                        ))}
                        {leaderboard.length === 0 && <tr><td colSpan={3} className="text-center py-4">Нет участников</td></tr>}
                    </tbody>
                </table>
            </div>
            {Object.entries(matchesByStage).sort(([a], [b]) => Number(a) - Number(b)).map(([stageOrder, stageMatches]) => {
                const stageName = stageMatches[0]?.stage_name || `Этап ${stageOrder}`;
                return (
                    <div key={stageOrder} className="mb-8">
                        <h2 className="text-xl font-semibold bg-gray-100 p-2">{stageName}</h2>
                        {stageMatches.map(match => {
                            const pred = predictions[match.id] || {};
                            const isPast = new Date() >= new Date(match.kickoff_at);
                            const boosterDisabled = isPast || pred.booster || boostedRounds.has(match.stage_order);
                            const result = matchResults[match.id];
                            return (
                                <div key={match.id} className="border p-3 mb-2 rounded">
                                    <div className="font-bold">{match.home_team_name} vs {match.away_team_name}</div>
                                    <div className="text-sm text-gray-500">{new Date(match.kickoff_at).toLocaleString()} {match.venue_name && ` • ${match.venue_name}`}</div>
                                    {result && <div className="text-sm text-green-700 mt-1">Результат: {result.home} : {result.away}</div>}
                                    <div className="flex flex-wrap gap-2 mt-2 items-center">
                                        <input type="number" placeholder="0" className="border p-1 w-16 text-center" value={pred.home !== undefined ? pred.home : ''} onChange={(e) => handlePredictionChange(match.id, 'home', e.target.value)} disabled={isPast} />
                                        <span>-</span>
                                        <input type="number" placeholder="0" className="border p-1 w-16 text-center" value={pred.away !== undefined ? pred.away : ''} onChange={(e) => handlePredictionChange(match.id, 'away', e.target.value)} disabled={isPast} />
                                        <button onClick={() => savePrediction(match)} disabled={isPast} className="bg-blue-500 text-white p-1 px-3 rounded disabled:bg-gray-300">Сохранить</button>
                                        <button onClick={() => handleBooster(match.id, match.stage_order)} disabled={boosterDisabled} className={`p-1 px-3 rounded ${boosterDisabled ? 'bg-gray-300' : 'bg-yellow-500 text-white'}`}>{pred.booster ? 'Бустер ✔' : 'x2 бустер'}</button>
                                    </div>
                                    {isCreator && (
                                        <div className="mt-2 pt-2 border-t flex gap-2 items-center">
                                            <span className="text-sm font-medium text-gray-600">Ввести результат:</span>
                                            <input type="number" placeholder="0" className="border p-1 w-16 text-center" id={`result_home_${match.id}`} defaultValue={result?.home ?? ''} />
                                            <span>-</span>
                                            <input type="number" placeholder="0" className="border p-1 w-16 text-center" id={`result_away_${match.id}`} defaultValue={result?.away ?? ''} />
                                            <button onClick={() => {
                                                const home = (document.getElementById(`result_home_${match.id}`) as HTMLInputElement).value;
                                                const away = (document.getElementById(`result_away_${match.id}`) as HTMLInputElement).value;
                                                if (home === '' || away === '') return alert('Введите оба значения');
                                                saveMatchResult(match.id, parseInt(home), parseInt(away));
                                            }} className="bg-green-600 text-white p-1 px-3 rounded">Сохранить результат</button>
                                        </div>
                                    )}
                                    {isPast && !result && <div className="text-xs text-red-500 mt-1">Прогноз закрыт, результат ещё не введён</div>}
                                </div>
                            );
                        })}
                    </div>
                );
            })}
        </div>
    );
}