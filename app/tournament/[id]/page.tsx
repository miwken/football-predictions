"use client";

import { supabase } from '@/lib/supabaseClient';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState, useCallback } from 'react';

interface Match {
    id: string;
    match_number: number;
    home_team_id: number;
    away_team_id: number;
    city_id: number;
    stage_id: number;
    kickoff_at: string;
    home_team_name: string;
    away_team_name: string;
    venue_name: string;
    stage_name: string;
    stage_order: number;
}

const getBoosterLimit = (stageOrder: number): number => {
    if (stageOrder <= 3) return 4;
    if (stageOrder === 4) return 3;
    if (stageOrder === 5) return 2;
    return 1;
};

export default function TournamentPage() {
    const { id } = useParams();
    const router = useRouter();
    const [matches, setMatches] = useState<Match[]>([]);
    const [tournamentName, setTournamentName] = useState('');
    const [user, setUser] = useState<any>(null);
    const [isCreator, setIsCreator] = useState(false);
    const [predictions, setPredictions] = useState<Record<string, { home: number; away: number; booster: boolean }>>({});
    const [matchResults, setMatchResults] = useState<Record<string, { home: number; away: number }>>({});
    const [leaderboard, setLeaderboard] = useState<{ user_id: string; display_name: string; total_points: number }[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [boosterMatchIds, setBoosterMatchIds] = useState<Set<string>>(new Set());
    const [boostersCountByRound, setBoostersCountByRound] = useState<Record<number, number>>({});
    const [activeStageKey, setActiveStageKey] = useState<string | null>(null);

    // Auth
    useEffect(() => {
        supabase.auth.getSession().then(({ data: { session } }) => {
            if (!session) router.push('/auth/login');
            else setUser(session.user);
        });
    }, [router]);

    // Название турнира
    useEffect(() => {
        if (!id) return;
        supabase.from('tournaments').select('name').eq('id', id).single().then(({ data }) => {
            if (data) setTournamentName(data.name);
        });
    }, [id]);

    // Проверка создателя
    useEffect(() => {
        if (!user || !id) return;
        supabase
            .from('tournaments')
            .select('created_by_user_id')
            .eq('id', id)
            .single()
            .then(({ data: tourney }) => {
                setIsCreator(tourney?.created_by_user_id === user.id);
            });
    }, [user, id]);

    // Загрузка матчей и справочников
    const loadMatches = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            // 1. Матчи
            const { data: matchesData, error: matchesError } = await supabase
                .from('matches')
                .select('*')
                .order('kickoff_at', { ascending: true });
            if (matchesError) throw matchesError;
            if (!matchesData) throw new Error('No matches');

            // 2. Команды
            const { data: teamsData } = await supabase.from('teams').select('id, team_name');
            const teamsMap = new Map();
            teamsData?.forEach(t => teamsMap.set(String(t.id), t.team_name));

            // 3. Города/стадионы
            const { data: citiesData } = await supabase.from('host_cities').select('id, venue_name');
            const citiesMap = new Map();
            citiesData?.forEach(c => citiesMap.set(String(c.id), c.venue_name));

            // 4. Стадии
            const { data: stagesData } = await supabase.from('tournament_stages').select('id, stage_name, stage_order');
            const stagesMap = new Map();
            stagesData?.forEach(s => stagesMap.set(String(s.id), { stage_name: s.stage_name, stage_order: s.stage_order }));

            const fullMatches = matchesData.map(m => {
                const stage = stagesMap.get(String(m.stage_id)) || { stage_name: '', stage_order: 0 };
                return {
                    ...m,
                    home_team_name: teamsMap.get(String(m.home_team_id)) || 'TBD',
                    away_team_name: teamsMap.get(String(m.away_team_id)) || 'TBD',
                    venue_name: citiesMap.get(String(m.city_id)) || '',
                    stage_name: stage.stage_name,
                    stage_order: stage.stage_order,
                };
            });
            setMatches(fullMatches);
        } catch (err: any) {
            console.error(err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (user) loadMatches();
    }, [user, loadMatches]);

    // Результаты матчей
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

    // Прогнозы пользователя
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

    // Бустеры
    useEffect(() => {
        if (!user || !id) return;
        supabase
            .from('tournament_boosters')
            .select('match_id, round_number')
            .eq('tournament_id', id)
            .eq('user_id', user.id)
            .then(({ data }) => {
                if (data) {
                    const matchSet = new Set<string>();
                    const roundsCount: Record<number, number> = {};
                    data.forEach(b => {
                        matchSet.add(b.match_id);
                        roundsCount[b.round_number] = (roundsCount[b.round_number] || 0) + 1;
                    });
                    setBoosterMatchIds(matchSet);
                    setBoostersCountByRound(roundsCount);
                }
            });
    }, [user, id]);

    // Таблица лидеров
    const fetchLeaderboard = useCallback(async () => {
        if (!id) return;
        const { data: members } = await supabase
            .from('tournament_members')
            .select('user_id, users(display_name)')
            .eq('tournament_id', id);
        if (!members) return;
        const leaderData: { user_id: string; display_name: string; total_points: number }[] = [];
        for (const m of members) {
            const displayName = (m.users as any)?.display_name || 'Anonymous';
            const { data: pointsData } = await supabase
                .from('predictions')
                .select('points_earned')
                .eq('tournament_id', id)
                .eq('user_id', m.user_id);
            const total = pointsData?.reduce((sum, p) => sum + (p.points_earned || 0), 0) || 0;
            leaderData.push({ user_id: m.user_id, display_name: displayName, total_points: total });
        }
        leaderData.sort((a, b) => b.total_points - a.total_points);
        setLeaderboard(leaderData);
    }, [id]);

    useEffect(() => {
        fetchLeaderboard();
    }, [fetchLeaderboard, predictions, matchResults]);

    // Группировка матчей по stage_order
    const matchesByStage = matches.reduce((acc, match) => {
        const key = String(match.stage_order);
        if (!acc[key]) acc[key] = [];
        acc[key].push(match);
        return acc;
    }, {} as Record<string, Match[]>);

    // Определение активного тура
    useEffect(() => {
        if (matches.length === 0) return;
        const now = new Date();
        const keys = Object.keys(matchesByStage).sort((a, b) => Number(a) - Number(b));
        let active = null;
        for (const key of keys) {
            if (matchesByStage[key].some(m => new Date(m.kickoff_at) <= now)) active = key;
        }
        setActiveStageKey(active ?? keys[0]);
    }, [matches, matchesByStage]);

    const saveMatchResult = async (matchId: string, home: number, away: number) => {
        if (!isCreator) return alert('Только создатель турнира может вводить результаты');
        const { error } = await supabase
            .from('match_results')
            .upsert({ match_id: matchId, score_home: home, score_away: away, updated_at: new Date() });
        if (error) alert(error.message);
        else {
            alert('Результат сохранён');
            setMatchResults(prev => ({ ...prev, [matchId]: { home, away } }));
            fetchLeaderboard();
        }
    };

    const handlePredictionChange = (matchId: string, field: 'home' | 'away', value: string) => {
        let num = value === '' ? '' : parseInt(value);
        if (typeof num === 'number' && num < 0) num = 0;
        setPredictions(prev => ({
            ...prev,
            [matchId]: { ...prev[matchId], [field]: num }
        }));
    };

    const handleBooster = async (match: Match) => {
        const matchId = match.id;
        const stageOrder = match.stage_order;
        if (new Date() >= new Date(match.kickoff_at)) {
            alert('Нельзя изменить бустер после начала матча');
            return;
        }
        const hasBooster = boosterMatchIds.has(matchId);
        const currentCount = boostersCountByRound[stageOrder] || 0;
        const limit = getBoosterLimit(stageOrder);

        if (hasBooster) {
            const { error } = await supabase
                .from('tournament_boosters')
                .delete()
                .eq('tournament_id', id)
                .eq('user_id', user.id)
                .eq('match_id', matchId);
            if (error) alert(error.message);
            else {
                setBoosterMatchIds(prev => { const s = new Set(prev); s.delete(matchId); return s; });
                setBoostersCountByRound(prev => ({ ...prev, [stageOrder]: Math.max(0, (prev[stageOrder] || 0) - 1) }));
                setPredictions(prev => ({ ...prev, [matchId]: { ...prev[matchId], booster: false } }));
            }
        } else {
            if (currentCount >= limit) {
                alert(`В этом туре можно использовать не более ${limit} бустеров`);
                return;
            }
            const { error } = await supabase
                .from('tournament_boosters')
                .upsert({ tournament_id: id, user_id: user.id, round_number: stageOrder, match_id: matchId, applied_at: new Date() },
                    { onConflict: 'tournament_id, user_id, match_id' });
            if (error) alert(error.message);
            else {
                setBoosterMatchIds(prev => new Set(prev).add(matchId));
                setBoostersCountByRound(prev => ({ ...prev, [stageOrder]: (prev[stageOrder] || 0) + 1 }));
                setPredictions(prev => ({ ...prev, [matchId]: { ...prev[matchId], booster: true } }));
            }
        }
    };

    const savePrediction = async (match: Match) => {
        const pred = predictions[match.id];
        if (!pred || pred.home === undefined || pred.away === undefined) return alert('Введите счёт');
        if (new Date() >= new Date(match.kickoff_at)) return alert('Прогноз нельзя сделать после начала матча');
        const { error } = await supabase
            .from('predictions')
            .upsert({
                user_id: user.id, tournament_id: id, match_id: match.id,
                predicted_home: pred.home, predicted_away: pred.away,
                booster_used: pred.booster || false,
            }, { onConflict: 'user_id, tournament_id, match_id' });
        if (error) alert(error.message);
        else {
            alert('Прогноз сохранён');
            fetchLeaderboard();
        }
    };

    if (!user) return <div>Загрузка пользователя...</div>;
    if (loading) return <div>Загрузка матчей...</div>;
    if (error) return <div className="text-red-500">Ошибка: {error}</div>;

    const sortedStageKeys = Object.keys(matchesByStage).sort((a, b) => Number(a) - Number(b));
    const currentMatches = activeStageKey ? matchesByStage[activeStageKey] : [];
    const currentStageOrder = activeStageKey ? parseInt(activeStageKey) : 0;

    return (
        <div className="p-4 max-w-5xl mx-auto">
            <h1 className="text-2xl font-bold mb-4">Турнир: {tournamentName}</h1>
            {isCreator && (
                <button onClick={() => loadMatches()} className="bg-gray-300 p-1 px-3 rounded text-sm">Обновить</button>
            )}
            <div className="mb-4 overflow-x-auto whitespace-nowrap border-b">
                <div className="flex gap-2">
                    {sortedStageKeys.map(key => {
                        const stageName = matchesByStage[key][0]?.stage_name || `Тур ${key}`;
                        const boosterInfo = `${boostersCountByRound[Number(key)] || 0}/${getBoosterLimit(Number(key))}`;
                        return (
                            <button
                                key={key}
                                onClick={() => setActiveStageKey(key)}
                                className={`px-4 py-2 text-base font-medium rounded-t-lg ${activeStageKey === key ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}
                            >
                                {stageName} ({boosterInfo})
                            </button>
                        );
                    })}
                </div>
            </div>
            <div className="mb-8 p-2 border rounded bg-gray-50">
                <h2 className="text-xl font-semibold mb-2">Таблица лидеров</h2>
                <div className="overflow-x-auto">
                    <table className="min-w-full bg-white">
                        <thead><tr><th>Место</th><th>Участник</th><th>Очки</th></tr></thead>
                        <tbody>
                            {leaderboard.map((e, i) => (
                                <tr key={e.user_id} className={e.user_id === user.id ? 'bg-yellow-100' : ''}>
                                    <td className="text-center">{i + 1}</td><td>{e.display_name}</td><td className="text-center font-bold">{e.total_points}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
            <h2 className="text-xl font-semibold bg-gray-100 p-2 flex justify-between">
                <span>{matchesByStage[activeStageKey || '']?.[0]?.stage_name || `Тур ${activeStageKey}`}</span>
                <span>Бустеры: {boostersCountByRound[currentStageOrder] || 0}/{getBoosterLimit(currentStageOrder)}</span>
            </h2>
            {currentMatches.map(match => {
                const pred = predictions[match.id] || {};
                const isPast = new Date() >= new Date(match.kickoff_at);
                const hasBooster = boosterMatchIds.has(match.id);
                const used = boostersCountByRound[currentStageOrder] || 0;
                const limit = getBoosterLimit(currentStageOrder);
                const boosterDisabled = isPast || (hasBooster ? false : used >= limit);
                const result = matchResults[match.id];
                return (
                    <div key={match.id} className="border p-3 mb-2 rounded">
                        <div className="font-bold text-lg">{match.home_team_name} vs {match.away_team_name}</div>
                        <div className="text-sm text-gray-500">{new Date(match.kickoff_at).toLocaleString()} {match.venue_name && ` • ${match.venue_name}`}</div>
                        {result && <div className="text-sm text-green-700">Результат: {result.home} : {result.away}</div>}
                        <div className="flex flex-wrap gap-2 mt-2">
                            <input type="number" min="0" className="border p-2 w-16 text-center" value={pred.home ?? ''} onChange={e => handlePredictionChange(match.id, 'home', e.target.value)} disabled={isPast} />
                            <span>-</span>
                            <input type="number" min="0" className="border p-2 w-16 text-center" value={pred.away ?? ''} onChange={e => handlePredictionChange(match.id, 'away', e.target.value)} disabled={isPast} />
                            <button onClick={() => savePrediction(match)} disabled={isPast} className="bg-blue-500 text-white p-2 px-3 rounded">Сохранить</button>
                            <button onClick={() => handleBooster(match)} disabled={boosterDisabled} className={`p-2 px-3 rounded ${hasBooster ? 'bg-green-500 text-white' : boosterDisabled ? 'bg-gray-300' : 'bg-yellow-500'}`}>{hasBooster ? 'Бустер ✔' : 'x2 бустер'}</button>
                        </div>
                        {isCreator && <div className="mt-2 pt-2 border-t flex gap-2">
                            <input type="number" min="0" className="border p-2 w-16" id={`rh_${match.id}`} defaultValue={result?.home ?? ''} />
                            <span>-</span>
                            <input type="number" min="0" className="border p-2 w-16" id={`ra_${match.id}`} defaultValue={result?.away ?? ''} />
                            <button onClick={() => {
                                const home = document.getElementById(`rh_${match.id}`) as HTMLInputElement;
                                const away = document.getElementById(`ra_${match.id}`) as HTMLInputElement;
                                if (!home.value || !away.value) return alert('Введите оба значения');
                                saveMatchResult(match.id, parseInt(home.value), parseInt(away.value));
                            }} className="bg-green-600 text-white p-2 px-3 rounded">Сохранить результат</button>
                        </div>}
                        {isPast && !result && <div className="text-xs text-red-500 mt-1">Прогноз закрыт, результат не введён</div>}
                    </div>
                );
            })}
        </div>
    );
}