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

const CACHE_TTL = 60 * 60 * 1000; // 1 час

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

export default function TournamentPage() {
    const { id } = useParams();
    const router = useRouter();
    const [matches, setMatches] = useState<Match[]>([]);
    const [tournamentName, setTournamentName] = useState('');
    const [user, setUser] = useState<any>(null);
    const [isCreator, setIsCreator] = useState(false);
    const [predictions, setPredictions] = useState<Record<string, { home: number; away: number; booster: boolean }>>({});
    const [boostedRounds, setBoostedRounds] = useState<Set<number>>(new Set());
    const [boosterMatchByRound, setBoosterMatchByRound] = useState<Record<number, string>>({});
    const [matchResults, setMatchResults] = useState<Record<string, { home: number; away: number }>>({});
    const [leaderboard, setLeaderboard] = useState<{ user_id: string; display_name: string; total_points: number }[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [loadStatus, setLoadStatus] = useState('');
    const abortControllerRef = useRef<AbortController | null>(null);

    // Проверка сессии и редирект
    useEffect(() => {
        supabase.auth.getSession().then(({ data: { session } }) => {
            if (!session) {
                router.push('/auth/login');
            } else {
                setUser(session.user);
            }
        });
    }, [router]);

    // Название турнира
    useEffect(() => {
        if (!id) return;
        supabase.from('tournaments').select('name').eq('id', id).single().then(({ data }) => {
            if (data) setTournamentName(data.name);
        });
    }, [id]);

    // Проверка, создатель ли пользователь
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

    // Основная загрузка данных (матчи + справочники) с кэшем
    const fetchAllData = useCallback(async (forceRefresh = false) => {
        if (abortControllerRef.current) abortControllerRef.current.abort();
        const controller = new AbortController();
        abortControllerRef.current = controller;

        setLoading(true);
        setError(null);

        try {
            // 1. Матчи
            let matchesData = null;
            if (!forceRefresh) matchesData = await getCached('matches_cache');
            if (matchesData) {
                setLoadStatus('Загрузка из кэша...');
                setMatches(matchesData);
                forceRefresh = true; // в фоне обновим
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

            // 2. Справочники
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

    // Загрузка результатов матчей
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
                    data.forEach(p => { predMap[p.match_id] = { home: p.predicted_home, away: p.predicted_away, booster: p.booster_used }; });
                    setPredictions(predMap);
                }
            });
    }, [user, id]);

    // Бустеры (загружаем и номер тура, и match_id)
    useEffect(() => {
        if (!user || !id) return;
        supabase
            .from('tournament_boosters')
            .select('round_number, match_id')
            .eq('user_id', user.id)
            .eq('tournament_id', id)
            .then(({ data }) => {
                if (data) {
                    const rounds = new Set<number>();
                    const matchMap: Record<number, string> = {};
                    data.forEach(b => {
                        rounds.add(b.round_number);
                        matchMap[b.round_number] = b.match_id;
                    });
                    setBoostedRounds(rounds);
                    setBoosterMatchByRound(matchMap);
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

    // Сохранение результата (только создатель)
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

    // Изменение прогноза
    const handlePredictionChange = (matchId: string, field: 'home' | 'away', value: string) => {
        setPredictions(prev => ({
            ...prev,
            [matchId]: {
                ...prev[matchId],
                [field]: value === '' ? '' : parseInt(value),
            }
        }));
    };

    // логика бустеров
    const handleBooster = async (matchId: string, stageOrder: number) => {
        // Проверка, не начался ли какой-то матч тура
        const matchesInRound = matches.filter(m => m.stage_order === stageOrder);
        const anyMatchStarted = matchesInRound.some(m => new Date() >= new Date(m.kickoff_at));
        if (anyMatchStarted) {
            alert('Нельзя изменить бустер: один из матчей тура уже начался');
            return;
        }

        // Upsert: если запись с таким составным ключом есть, обновляем match_id
        const { error } = await supabase
            .from('tournament_boosters')
            .upsert(
                { tournament_id: id, user_id: user.id, round_number: stageOrder, match_id: matchId, applied_at: new Date() },
                { onConflict: 'tournament_id, user_id, round_number' }
            );

        if (error) {
            alert('Ошибка при назначении бустера: ' + error.message);
            return;
        }

        // Обновляем локальные состояния
        setBoostedRounds(prev => new Set(prev).add(stageOrder));
        setBoosterMatchByRound(prev => ({ ...prev, [stageOrder]: matchId }));

        // Обновляем predictions: снимаем бустер со всех матчей тура и ставим на выбранный
        setPredictions(prev => {
            const newPred = { ...prev };
            Object.keys(newPred).forEach(mid => {
                const m = matches.find(m => m.id === mid);
                if (m && m.stage_order === stageOrder && newPred[mid]) {
                    newPred[mid] = { ...newPred[mid], booster: false };
                }
            });
            if (newPred[matchId]) {
                newPred[matchId] = { ...newPred[matchId], booster: true };
            } else {
                newPred[matchId] = { home: 0, away: 0, booster: true };
            }
            return newPred;
        });
    };

    // Сохранение прогноза
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

    // Группировка матчей по этапам (с учётом stage_order)
    const matchesByStage: Record<string, Match[]> = matches.reduce((acc, match) => {
        let key: string;
        if (match.stage_order && match.stage_order > 0) {
            key = String(match.stage_order);
        } else {
            key = match.stage_name || 'other';
        }
        if (!acc[key]) acc[key] = [];
        acc[key].push(match);
        return acc;
    }, {} as Record<string, Match[]>);

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

    return (
        <div className="p-4 max-w-5xl mx-auto">
            <h1 className="text-2xl font-bold mb-4">Турнир: {tournamentName}</h1>
            {isCreator && (
                <div className="mb-4 text-right">
                    <button onClick={() => fetchAllData(true)} className="bg-gray-300 p-1 px-3 rounded text-sm">Сбросить кэш</button>
                </div>
            )}
            {/* Таблица лидеров */}
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

            {/* Список матчей по турам */}
            {Object.entries(matchesByStage)
                .sort(([a], [b]) => {
                    const aNum = parseInt(a);
                    const bNum = parseInt(b);
                    if (!isNaN(aNum) && !isNaN(bNum)) return aNum - bNum;
                    return a.localeCompare(b);
                })
                .map(([key, stageMatches]) => {
                    const stageName = stageMatches[0]?.stage_name || `Этап ${key}`;
                    // Проверяем, можно ли менять бустеры в этом туре (ни один матч не начался)
                    const canChangeBooster = !stageMatches.some(m => new Date() >= new Date(m.kickoff_at));
                    return (
                        <div key={key} className="mb-8">
                            <h2 className="text-xl font-semibold bg-gray-100 p-2">{stageName}</h2>
                            {stageMatches.map(match => {
                                const pred = predictions[match.id] || {};
                                const isPast = new Date() >= new Date(match.kickoff_at);
                                const isBoosterOnThisMatch = boosterMatchByRound[match.stage_order] === match.id;
                                // Кнопка бустера доступна, если матч ещё не начался, и (либо бустер ещё не назначен, либо назначен на другой матч и можно менять)
                                const boosterDisabled = isPast || (isBoosterOnThisMatch && !canChangeBooster);
                                const boosterButtonText = isBoosterOnThisMatch ? 'Бустер ✔' : 'x2 бустер';
                                const result = matchResults[match.id];
                                return (
                                    <div key={match.id} className="border p-3 mb-2 rounded">
                                        <div className="font-bold">{match.home_team_name} vs {match.away_team_name}</div>
                                        <div className="text-sm text-gray-500">{new Date(match.kickoff_at).toLocaleString()} {match.venue_name && ` • ${match.venue_name}`}</div>
                                        {result && <div className="text-sm text-green-700 mt-1">Результат: {result.home} : {result.away}</div>}
                                        <div className="flex flex-wrap gap-2 mt-2 items-center">
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
                                                {boosterButtonText}
                                            </button>
                                        </div>
                                        {/* Блок ввода результата для создателя */}
                                        {isCreator && (
                                            <div className="mt-2 pt-2 border-t flex gap-2 items-center">
                                                <span className="text-sm font-medium text-gray-600">Ввести результат:</span>
                                                <input type="number" placeholder="0" className="border p-1 w-16 text-center" id={`result_home_${match.id}`} defaultValue={result?.home ?? ''} />
                                                <span>-</span>
                                                <input type="number" placeholder="0" className="border p-1 w-16 text-center" id={`result_away_${match.id}`} defaultValue={result?.away ?? ''} />
                                                <button
                                                    onClick={() => {
                                                        const home = (document.getElementById(`result_home_${match.id}`) as HTMLInputElement).value;
                                                        const away = (document.getElementById(`result_away_${match.id}`) as HTMLInputElement).value;
                                                        if (home === '' || away === '') return alert('Введите оба значения');
                                                        saveMatchResult(match.id, parseInt(home), parseInt(away));
                                                    }}
                                                    className="bg-green-600 text-white p-1 px-3 rounded"
                                                >
                                                    Сохранить результат
                                                </button>
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