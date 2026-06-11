"use client";

import { supabase } from '@/lib/supabaseClient';
import { useParams, useRouter } from 'next/navigation';
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

const CACHE_TTL = 60 * 60 * 1000;

async function getCached(key: string) {
    if (typeof window === 'undefined') return null;
    const cached = localStorage.getItem(key);
    if (!cached) return null;
    const { data, timestamp } = JSON.parse(cached);
    if (Date.now() - timestamp < CACHE_TTL) return data;
    localStorage.removeItem(key);
    return null;
}

async function setCache(key: string, data: any) {
    if (typeof window === 'undefined') return;
    localStorage.setItem(key, JSON.stringify({ data, timestamp: Date.now() }));
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
    const [loadStatus, setLoadStatus] = useState('');
    const abortControllerRef = useRef<AbortController | null>(null);

    const [boosterMatchIds, setBoosterMatchIds] = useState<Set<string>>(new Set());
    const [boostersCountByRound, setBoostersCountByRound] = useState<Record<number, number>>({});

    const [activeStageKey, setActiveStageKey] = useState<string | null>(null);

    useEffect(() => {
        supabase.auth.getSession().then(({ data: { session } }) => {
            if (!session) router.push('/auth/login');
            else setUser(session.user);
        });
    }, [router]);

    useEffect(() => {
        if (!id) return;
        supabase.from('tournaments').select('name').eq('id', id).single().then(({ data }) => {
            if (data) setTournamentName(data.name);
        });
    }, [id]);

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

    const fetchAllData = useCallback(async (forceRefresh = false) => {
        if (abortControllerRef.current) abortControllerRef.current.abort();
        const controller = new AbortController();
        abortControllerRef.current = controller;
        setLoading(true);
        setError(null);

        try {
            let matchesData = null;
            if (!forceRefresh) matchesData = await getCached('matches_cache');
            if (matchesData) {
                setLoadStatus('Загрузка из кэша...');
                setMatches(matchesData);
                forceRefresh = true;
            }
            if (!matchesData || forceRefresh) {
                setLoadStatus('Загрузка матчей с сервера...');
                const { data, error: matchesError } = await supabase
                    .from('matches')
                    .select('*')
                    .order('kickoff_at', { ascending: true })
                    .abortSignal(controller.signal);
                if (matchesError) throw matchesError;
                matchesData = data;
                if (data && data.length) await setCache('matches_cache', data);
            }

            setLoadStatus('Загрузка справочников...');
            let teamsData = await getCached('teams_cache');
            if (!teamsData) {
                const { data } = await supabase.from('teams').select('id, team_name');
                teamsData = data;
                await setCache('teams_cache', teamsData);
            }
            let citiesData = await getCached('cities_cache');
            if (!citiesData) {
                const { data } = await supabase.from('host_cities').select('id, city_name, venue_name');
                citiesData = data;
                await setCache('cities_cache', citiesData);
            }
            let stagesData = await getCached('stages_cache');
            if (!stagesData) {
                const { data } = await supabase.from('tournament_stages').select('id, stage_name, stage_order');
                stagesData = data;
                await setCache('stages_cache', stagesData);
            }

            const teamsMap = new Map();
            (teamsData || []).forEach((t: any) => teamsMap.set(String(t.id), t.team_name));
            const citiesMap = new Map();
            (citiesData || []).forEach((c: any) => citiesMap.set(String(c.id), { city_name: c.city_name, venue_name: c.venue_name }));
            const stagesMap = new Map();
            (stagesData || []).forEach((s: any) => stagesMap.set(String(s.id), { stage_name: s.stage_name, stage_order: s.stage_order }));

            const fullMatches = (matchesData || []).map((m: any) => {
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
            setLoading(false);
        } catch (err: any) {
            if (err.name === 'AbortError') return;
            console.error(err);
            setError('Не удалось загрузить данные. Проверьте соединение.');
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (user) fetchAllData();
        return () => {
            if (abortControllerRef.current) abortControllerRef.current.abort();
        };
    }, [fetchAllData, user]);

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
                    data.forEach(p => {
                        predMap[p.match_id] = { home: p.predicted_home, away: p.predicted_away, booster: p.booster_used };
                    });
                    setPredictions(predMap);
                }
            });
    }, [user, id]);

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
                } else {
                    setBoosterMatchIds(new Set());
                    setBoostersCountByRound({});
                }
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
            const displayName = (m.users as any)?.display_name || 'Anonymous';
            const { data: pointsData } = await supabase
                .from('predictions')
                .select('points_earned')
                .eq('tournament_id', id)
                .eq('user_id', m.user_id);
            const total = pointsData?.reduce((sum, p) => sum + (p.points_earned || 0), 0) || 0;
            leaderData.push({
                user_id: m.user_id,
                display_name: displayName,
                total_points: total,
            });
        }
        leaderData.sort((a, b) => b.total_points - a.total_points);
        setLeaderboard(leaderData);
    }, [id]);

    useEffect(() => {
        fetchLeaderboard();
    }, [fetchLeaderboard, predictions, matchResults]);

    const matchesByStage = matches.reduce((acc, match) => {
        let key: string;
        if (match.stage_order && match.stage_order > 0) key = String(match.stage_order);
        else key = match.stage_name || 'other';
        if (!acc[key]) acc[key] = [];
        acc[key].push(match);
        return acc;
    }, {} as Record<string, Match[]>);

    useEffect(() => {
        if (matches.length === 0) return;
        const now = new Date();
        const stageKeys = Object.keys(matchesByStage).sort((a, b) => {
            const aNum = parseInt(a);
            const bNum = parseInt(b);
            if (!isNaN(aNum) && !isNaN(bNum)) return aNum - bNum;
            return a.localeCompare(b);
        });
        if (stageKeys.length === 0) return;
        let activeKey: string | null = null;
        for (const key of stageKeys) {
            const hasStarted = matchesByStage[key].some(m => new Date(m.kickoff_at) <= now);
            if (hasStarted) activeKey = key;
        }
        setActiveStageKey(activeKey ?? stageKeys[0]);
    }, [matches, matchesByStage]);

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
        let num = value === '' ? '' : parseInt(value);
        if (typeof num === 'number' && num < 0) num = 0;
        setPredictions(prev => ({
            ...prev,
            [matchId]: {
                ...prev[matchId],
                [field]: num,
            }
        }));
    };

    const handleBooster = async (match: Match) => {
        const matchId = match.id;
        const stageOrder = match.stage_order;
        const isStarted = new Date() >= new Date(match.kickoff_at);
        if (isStarted) {
            alert('Нельзя изменить бустер после начала матча');
            return;
        }

        const hasBooster = boosterMatchIds.has(matchId);
        const currentCount = boostersCountByRound[stageOrder] || 0;
        const limit = getBoosterLimit(stageOrder);

        if (hasBooster) {
            // Удаляем бустер
            const { error } = await supabase
                .from('tournament_boosters')
                .delete()
                .eq('tournament_id', id)
                .eq('user_id', user.id)
                .eq('match_id', matchId);
            if (error) {
                alert('Ошибка при удалении бустера: ' + error.message);
                return;
            }
            setBoosterMatchIds(prev => {
                const newSet = new Set(prev);
                newSet.delete(matchId);
                return newSet;
            });
            // Уменьшаем счётчик бустеров для этого тура
            setBoostersCountByRound(prev => ({
                ...prev,
                [stageOrder]: Math.max(0, (prev[stageOrder] || 0) - 1)
            }));
            // Обновляем прогноз
            setPredictions(prev => {
                const newPred = { ...prev };
                if (newPred[matchId]) newPred[matchId] = { ...newPred[matchId], booster: false };
                return newPred;
            });
        } else {
            if (currentCount >= limit) {
                alert(`В этом туре можно использовать не более ${limit} бустеров`);
                return;
            }
            const { error } = await supabase
                .from('tournament_boosters')
                .upsert(
                    {
                        tournament_id: id,
                        user_id: user.id,
                        round_number: stageOrder,
                        match_id: matchId,
                        applied_at: new Date()
                    },
                    { onConflict: 'tournament_id, user_id, match_id' }
                );
            if (error) {
                alert('Ошибка при назначении бустера: ' + error.message);
                return;
            }
            setBoosterMatchIds(prev => new Set(prev).add(matchId));
            setBoostersCountByRound(prev => ({
                ...prev,
                [stageOrder]: (prev[stageOrder] || 0) + 1
            }));
            setPredictions(prev => {
                const newPred = { ...prev };
                if (newPred[matchId]) {
                    newPred[matchId] = { ...newPred[matchId], booster: true };
                } else {
                    newPred[matchId] = { home: 0, away: 0, booster: true };
                }
                return newPred;
            });
        }
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

    if (!user) return <div className="p-4">Загрузка пользователя...</div>;
    if (loading) return (
        <div className="p-4">
            <p>Загрузка...</p>
            <p className="text-sm text-gray-500">{loadStatus}</p>
        </div>
    );
    if (error) return (
        <div className="p-4">
            <p className="text-red-500">{error}</p>
            <button onClick={() => fetchAllData(true)} className="mt-2 bg-blue-500 text-white p-2 rounded">Повторить</button>
        </div>
    );

    const sortedStageKeys = Object.keys(matchesByStage).sort((a, b) => {
        const aNum = parseInt(a);
        const bNum = parseInt(b);
        if (!isNaN(aNum) && !isNaN(bNum)) return aNum - bNum;
        return a.localeCompare(b);
    });

    const currentStageMatches = activeStageKey ? matchesByStage[activeStageKey] : [];
    const currentStageOrder = activeStageKey ? parseInt(activeStageKey) : 0;
    const currentStageName = currentStageMatches[0]?.stage_name || (activeStageKey ? `Тур ${activeStageKey}` : '');

    return (
        <div className="p-4 max-w-5xl mx-auto">
            <h1 className="text-2xl font-bold mb-4">Турнир: {tournamentName}</h1>
            {isCreator && (
                <div className="mb-4 text-right">
                    <button onClick={() => fetchAllData(true)} className="bg-gray-300 p-2 px-4 rounded text-sm">Сбросить кэш</button>
                </div>
            )}

            {sortedStageKeys.length > 1 && (
                <div className="mb-4 overflow-x-auto whitespace-nowrap border-b">
                    <div className="flex gap-2">
                        {sortedStageKeys.map(key => {
                            const stageOrderNum = parseInt(key);
                            const stageName = matchesByStage[key][0]?.stage_name || `Тур ${key}`;
                            const isActive = activeStageKey === key;
                            const boosterInfo = `(${boostersCountByRound[stageOrderNum] || 0}/${getBoosterLimit(stageOrderNum)})`;
                            return (
                                <button
                                    key={key}
                                    onClick={() => setActiveStageKey(key)}
                                    className={`px-4 py-2 text-base font-medium rounded-t-lg transition whitespace-nowrap ${isActive
                                            ? 'bg-blue-500 text-white border-b-2 border-blue-700'
                                            : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                                        }`}
                                >
                                    {stageName} <span className="text-xs ml-1">{boosterInfo}</span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}

            <div className="mb-8 p-4 border rounded bg-gray-50">
                <h2 className="text-xl font-semibold mb-2">Таблица лидеров</h2>
                <div className="overflow-x-auto">
                    <table className="min-w-full bg-white">
                        <thead>
                            <tr><th className="py-2 px-4 border-b">Место</th><th className="py-2 px-4 border-b">Участник</th><th className="py-2 px-4 border-b">Очки</th></tr></thead>
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
            </div>

            <div>
                <h2 className="text-xl font-semibold bg-gray-100 p-2 mb-3 flex justify-between">
                    <span>{currentStageName}</span>
                    <span className="text-sm font-normal text-gray-600">
                        Бустеры: {boostersCountByRound[currentStageOrder] || 0}/{getBoosterLimit(currentStageOrder)}
                    </span>
                </h2>
                {currentStageMatches.map(match => {
                    const pred = predictions[match.id] || {};
                    const isPast = new Date() >= new Date(match.kickoff_at);
                    const hasBooster = boosterMatchIds.has(match.id);
                    const result = matchResults[match.id];
                    const used = boostersCountByRound[currentStageOrder] || 0;
                    const limit = getBoosterLimit(currentStageOrder);
                    const boosterButtonDisabled = isPast || (hasBooster ? false : used >= limit);
                    return (
                        <div key={match.id} className="border p-4 mb-3 rounded shadow-sm">
                            <div className="font-bold text-lg mb-1">{match.home_team_name} vs {match.away_team_name}</div>
                            <div className="text-sm text-gray-500 mb-2">
                                {new Date(match.kickoff_at).toLocaleString()} {match.venue_name && ` • ${match.venue_name}`}
                            </div>
                            {result && <div className="text-sm text-green-700 mt-1 mb-2">Результат: {result.home} : {result.away}</div>}
                            <div className="flex flex-col sm:flex-row gap-3 mt-2">
                                <div className="flex items-center gap-2">
                                    <input
                                        type="number"
                                        min="0"
                                        placeholder="0"
                                        className="border p-3 w-20 text-center text-lg rounded"
                                        value={pred.home !== undefined ? pred.home : ''}
                                        onChange={(e) => handlePredictionChange(match.id, 'home', e.target.value)}
                                        disabled={isPast}
                                    />
                                    <span className="text-xl">-</span>
                                    <input
                                        type="number"
                                        min="0"
                                        placeholder="0"
                                        className="border p-3 w-20 text-center text-lg rounded"
                                        value={pred.away !== undefined ? pred.away : ''}
                                        onChange={(e) => handlePredictionChange(match.id, 'away', e.target.value)}
                                        disabled={isPast}
                                    />
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    <button
                                        onClick={() => savePrediction(match)}
                                        disabled={isPast}
                                        className="bg-blue-500 text-white p-3 px-5 rounded disabled:bg-gray-300 text-base"
                                    >
                                        Сохранить
                                    </button>
                                    <button
                                        onClick={() => handleBooster(match)}
                                        disabled={boosterButtonDisabled}
                                        className={`p-3 px-5 rounded text-base ${hasBooster ? 'bg-green-500 text-white' : boosterButtonDisabled ? 'bg-gray-300' : 'bg-yellow-500 text-white'}`}
                                    >
                                        {hasBooster ? 'Бустер ✔' : 'x2 бустер'}
                                    </button>
                                </div>
                            </div>
                            {isCreator && (
                                <div className="mt-4 pt-3 border-t flex flex-col sm:flex-row gap-2 items-start sm:items-center">
                                    <span className="text-sm font-medium text-gray-600">Ввести результат:</span>
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="number"
                                            min="0"
                                            placeholder="0"
                                            className="border p-3 w-20 text-center text-lg rounded"
                                            id={`result_home_${match.id}`}
                                            defaultValue={result?.home ?? ''}
                                        />
                                        <span>-</span>
                                        <input
                                            type="number"
                                            min="0"
                                            placeholder="0"
                                            className="border p-3 w-20 text-center text-lg rounded"
                                            id={`result_away_${match.id}`}
                                            defaultValue={result?.away ?? ''}
                                        />
                                        <button
                                            onClick={() => {
                                                const home = (document.getElementById(`result_home_${match.id}`) as HTMLInputElement).value;
                                                const away = (document.getElementById(`result_away_${match.id}`) as HTMLInputElement).value;
                                                if (home === '' || away === '') return alert('Введите оба значения');
                                                saveMatchResult(match.id, parseInt(home), parseInt(away));
                                            }}
                                            className="bg-green-600 text-white p-3 px-5 rounded text-base"
                                        >
                                            Сохранить результат
                                        </button>
                                    </div>
                                </div>
                            )}
                            {isPast && !result && <div className="text-xs text-red-500 mt-2">Прогноз закрыт, результат ещё не введён</div>}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}