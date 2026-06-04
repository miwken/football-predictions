"use client";

import { supabase } from '@/lib/supabaseClient';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';

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

interface Leader {
    user_id: string;
    display_name: string;
    total_points: number;
}

export default function TournamentPage() {
    const { id } = useParams();
    const [matches, setMatches] = useState<Match[]>([]);
    const [tournamentName, setTournamentName] = useState('');
    const [user, setUser] = useState<any>(null);
    const [isCreator, setIsCreator] = useState(false);
    const [predictions, setPredictions] = useState<Record<string, { home: number; away: number; booster: boolean }>>({});
    const [boostedRounds, setBoostedRounds] = useState<Set<number>>(new Set());
    const [leaders, setLeaders] = useState<Leader[]>([]);
    const [results, setResults] = useState<Record<string, { home: number; away: number }>>({});

    // Получить пользователя и проверить, создатель ли он
    useEffect(() => {
        supabase.auth.getUser().then(({ data }) => {
            if (data.user) {
                setUser(data.user);
                // Проверяем, создатель ли турнира
                supabase
                    .from('tournaments')
                    .select('created_by_user_id')
                    .eq('id', id)
                    .single()
                    .then(({ data: t }) => {
                        if (t && t.created_by_user_id === data.user.id) setIsCreator(true);
                    });
            } else {
                // редирект на логин
                window.location.href = '/auth/login';
            }
        });
    }, [id]);

    useEffect(() => {
        supabase.from('tournaments').select('name').eq('id', id).single().then(({ data }) => {
            if (data) setTournamentName(data.name);
        });
    }, [id]);

    // Загрузка матчей с подтягиванием имён
    useEffect(() => {
        const fetchMatches = async () => {
            const { data: matchesData, error: matchesError } = await supabase
                .from('matches')
                .select('*')
                .order('kickoff_at', { ascending: true });

            if (matchesError || !matchesData) return;

            const { data: teamsData } = await supabase.from('teams').select('id, team_name');
            const teamsMap = new Map();
            teamsData?.forEach(t => teamsMap.set(String(t.id), t.team_name));

            const { data: citiesData } = await supabase.from('host_cities').select('id, city_name, venue_name');
            const citiesMap = new Map();
            citiesData?.forEach(c => citiesMap.set(String(c.id), { city_name: c.city_name, venue_name: c.venue_name }));

            const { data: stagesData } = await supabase.from('tournament_stages').select('id, stage_name, stage_order');
            const stagesMap = new Map();
            stagesData?.forEach(s => stagesMap.set(String(s.id), { stage_name: s.stage_name, stage_order: s.stage_order }));

            const fullMatches = matchesData.map(m => {
                const city = citiesMap.get(String(m.city_id)) || { city_name: '', venue_name: '' };
                const stage = stagesMap.get(String(m.stage_id)) || { stage_name: '', stage_order: 0 };
                return {
                    ...m,
                    home_team_name: teamsMap.get(String(m.home_team_id)) || 'TBD',
                    away_team_name: teamsMap.get(String(m.away_team_id)) || 'TBD',
                    city_name: city.city_name,
                    venue_name: city.venue_name,
                    stage_name: stage.stage_name,
                    stage_order: stage.stage_order,
                };
            });
            setMatches(fullMatches);
        };

        fetchMatches();
    }, []);

    // Загрузка прогнозов текущего пользователя
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
                    data.forEach(p => {
                        predMap[p.match_id] = { home: p.predicted_home, away: p.predicted_away, booster: p.booster_used };
                    });
                    setPredictions(predMap);
                }
            });
    }, [user, id]);

    // Загрузка бустеров
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

    // Загрузка существующих результатов матчей (для отображения)
    useEffect(() => {
        const fetchResults = async () => {
            const { data } = await supabase.from('match_results').select('match_id, score_home, score_away');
            if (data) {
                const resMap: Record<string, any> = {};
                data.forEach(r => {
                    resMap[r.match_id] = { home: r.score_home, away: r.score_away };
                });
                setResults(resMap);
            }
        };
        fetchResults();
    }, []);

    // Таблица лидеров
    const fetchLeaderboard = async () => {
        if (!id) return;
        const { data, error } = await supabase
            .from('predictions')
            .select(`
        user_id,
        users (display_name),
        points_earned
      `)
            .eq('tournament_id', id);

        if (error) {
            console.error(error);
            return;
        }

        // Агрегируем очки по пользователям
        const pointsMap = new Map<string, { name: string; total: number }>();
        data?.forEach((p: any) => {
            const userId = p.user_id;
            const displayName = p.users?.display_name || 'Unknown';
            const points = p.points_earned || 0;
            if (!pointsMap.has(userId)) {
                pointsMap.set(userId, { name: displayName, total: 0 });
            }
            pointsMap.get(userId)!.total += points;
        });

        const leaderboard = Array.from(pointsMap.entries()).map(([userId, val]) => ({
            user_id: userId,
            display_name: val.name,
            total_points: val.total,
        }));
        leaderboard.sort((a, b) => b.total_points - a.total_points);
        setLeaders(leaderboard);
    };

    useEffect(() => {
        if (id) fetchLeaderboard();
    }, [id, predictions, results]); // пересчёт при изменении прогнозов или результатов

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
        if (error) return alert(error.message);
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
        else alert('Прогноз сохранён');
    };

    // Ввод результата (только для создателя)
    const saveResult = async (matchId: string, home: number, away: number) => {
        if (!isCreator) return alert('Только создатель турнира может вводить результаты');
        const { error } = await supabase
            .from('match_results')
            .upsert({ match_id: matchId, score_home: home, score_away: away }, { onConflict: 'match_id' });
        if (error) alert(error.message);
        else {
            alert('Результат сохранён, очки пересчитаны');
            // Обновим локальное состояние результатов
            setResults(prev => ({ ...prev, [matchId]: { home, away } }));
            fetchLeaderboard(); // принудительно обновим таблицу лидеров
        }
    };

    const matchesByStage = matches.reduce((acc, match) => {
        const stage = match.stage_order;
        if (!acc[stage]) acc[stage] = [];
        acc[stage].push(match);
        return acc;
    }, {} as Record<number, Match[]>);

    if (!user) return <div>Загрузка...</div>;

    return (
        <div className="p-4 max-w-4xl mx-auto">
            <h1 className="text-2xl font-bold mb-4">Турнир: {tournamentName}</h1>

            {/* Таблица лидеров */}
            <div className="mb-8 p-4 bg-gray-50 rounded">
                <h2 className="text-xl font-semibold mb-2">Таблица лидеров</h2>
                {leaders.length === 0 && <p>Нет данных</p>}
                <table className="w-full border-collapse">
                    <thead>
                        <tr className="border-b">
                            <th className="text-left p-2">Место</th>
                            <th className="text-left p-2">Участник</th>
                            <th className="text-left p-2">Очки</th>
                        </tr>
                    </thead>
                    <tbody>
                        {leaders.map((leader, idx) => (
                            <tr key={leader.user_id} className="border-b">
                                <td className="p-2">{idx + 1}</td>
                                <td className="p-2">{leader.display_name}</td>
                                <td className="p-2">{leader.total_points}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Список матчей с прогнозами и вводом результатов */}
            {Object.entries(matchesByStage)
                .sort(([a], [b]) => Number(a) - Number(b))
                .map(([stageOrder, stageMatches]) => {
                    const stageName = stageMatches[0]?.stage_name || `Этап ${stageOrder}`;
                    return (
                        <div key={stageOrder} className="mb-8">
                            <h2 className="text-xl font-semibold bg-gray-100 p-2">{stageName}</h2>
                            {stageMatches.map(match => {
                                const pred = predictions[match.id] || {};
                                const isPast = new Date() >= new Date(match.kickoff_at);
                                const boosterDisabled = isPast || pred.booster || boostedRounds.has(match.stage_order);
                                const currentResult = results[match.id];
                                return (
                                    <div key={match.id} className="border p-3 mb-2 rounded">
                                        <div className="font-bold">{match.home_team_name} vs {match.away_team_name}</div>
                                        <div className="text-sm text-gray-500">
                                            {new Date(match.kickoff_at).toLocaleString()}
                                            {match.venue_name && ` • ${match.venue_name}`}
                                        </div>

                                        {/* Прогноз пользователя */}
                                        <div className="flex gap-2 mt-2 items-center">
                                            <input
                                                type="number"
                                                placeholder="0"
                                                className="border p-1 w-16 text-center"
                                                value={pred.home !== undefined ? pred.home : ''}
                                                onChange={(e) => handlePredictionChange(match.id, 'home', e.target.value)}
                                                disabled={isPast}
                                            />
                                            <span>-</span>
                                            <input
                                                type="number"
                                                placeholder="0"
                                                className="border p-1 w-16 text-center"
                                                value={pred.away !== undefined ? pred.away : ''}
                                                onChange={(e) => handlePredictionChange(match.id, 'away', e.target.value)}
                                                disabled={isPast}
                                            />
                                            <button
                                                onClick={() => savePrediction(match)}
                                                disabled={isPast}
                                                className="bg-blue-500 text-white p-1 px-3 rounded disabled:bg-gray-300"
                                            >
                                                Сохранить
                                            </button>
                                            <button
                                                onClick={() => handleBooster(match.id, match.stage_order)}
                                                disabled={boosterDisabled}
                                                className={`p-1 px-3 rounded ${boosterDisabled ? 'bg-gray-300' : 'bg-yellow-500 text-white'}`}
                                            >
                                                {pred.booster ? 'Бустер ✔' : 'x2 бустер'}
                                            </button>
                                        </div>
                                        {isPast && <div className="text-xs text-red-500 mt-1">Прогноз закрыт</div>}

                                        {/* Результат матча (для создателя) */}
                                        {isCreator && (
                                            <div className="mt-2 pt-2 border-t">
                                                <div className="text-sm font-semibold">Ввод результата (для создателя)</div>
                                                <div className="flex gap-2 items-center mt-1">
                                                    <input
                                                        type="number"
                                                        placeholder="0"
                                                        className="border p-1 w-16 text-center"
                                                        value={currentResult?.home !== undefined ? currentResult.home : ''}
                                                        onChange={(e) => setResults(prev => ({
                                                            ...prev,
                                                            [match.id]: { ...prev[match.id], home: parseInt(e.target.value) || 0 }
                                                        }))}
                                                    />
                                                    <span>-</span>
                                                    <input
                                                        type="number"
                                                        placeholder="0"
                                                        className="border p-1 w-16 text-center"
                                                        value={currentResult?.away !== undefined ? currentResult.away : ''}
                                                        onChange={(e) => setResults(prev => ({
                                                            ...prev,
                                                            [match.id]: { ...prev[match.id], away: parseInt(e.target.value) || 0 }
                                                        }))}
                                                    />
                                                    <button
                                                        onClick={() => saveResult(match.id, results[match.id]?.home || 0, results[match.id]?.away || 0)}
                                                        className="bg-green-500 text-white p-1 px-3 rounded"
                                                    >
                                                        Сохранить результат
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    );
                })}
        </div>
    );
}