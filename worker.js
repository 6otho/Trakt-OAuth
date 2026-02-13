/**
 * ==============================================================================
 * Cloudflare Worker 追番列表 (V31: 像素级左对齐 + 移除右上角退出)
 * ==============================================================================
 */

const REFLIX_HEADERS = {
    'Content-Type': 'application/json',
    'trakt-api-version': '2',
    'User-Agent': 'Reflix/3.1.0 (iPad; iOS 16.1; Scale/2.00)',
    'Accept': '*/*'
};

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const path = url.pathname;

        // 基础配置检查
        if (!env.TRAKT_ID || !env.TRAKT_SECRET || !env.TMDB_TOKEN) {
            return new Response("Error: 请在后台配置 TRAKT_ID, TRAKT_SECRET 和 TMDB_TOKEN", { status: 500 });
        }

        // 🔓 0. 公开数据接口 (海报墙)
        if (path === '/api/public/backdrop') {
            return await handlePublicBackdrop(env);
        }

        // 🔐 1. OAuth 认证流程
        if (path === '/auth/login') {
            const redirectUri = `${url.origin}/auth/callback`;
            const traktUrl = `https://trakt.tv/oauth/authorize?response_type=code&client_id=${env.TRAKT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}`;
            return Response.redirect(traktUrl, 302);
        }

        if (path === '/auth/callback') {
            const code = url.searchParams.get('code');
            if (!code) return new Response("Login Failed: No Code provided", { status: 400 });

            try {
                const tokenRes = await fetch('https://api.trakt.tv/oauth/token', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'User-Agent': REFLIX_HEADERS['User-Agent']
                    },
                    body: JSON.stringify({
                        code: code,
                        client_id: env.TRAKT_ID,
                        client_secret: env.TRAKT_SECRET,
                        redirect_uri: `${url.origin}/auth/callback`,
                        grant_type: 'authorization_code'
                    })
                });

                const textData = await tokenRes.text();
                let tokenData;
                try { tokenData = JSON.parse(textData); } catch (e) {
                    return new Response(`Trakt Error: Non-JSON response.\n${textData.substring(0,200)}`, { status: 500 });
                }

                if (!tokenRes.ok || !tokenData.access_token) {
                    return new Response(`Auth Error: ${tokenData.error_description || JSON.stringify(tokenData)}`, { status: 400 });
                }

                const html = `
                <!DOCTYPE html>
                <html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{font-family:sans-serif;text-align:center;padding:50px;background:#111;color:#fff}</style></head>
                <body><h3>✅ 登录成功</h3><p>正在跳转...</p>
                <script>
                    localStorage.setItem('trakt_token', '${tokenData.access_token}');
                    localStorage.setItem('trakt_refresh', '${tokenData.refresh_token}');
                    setTimeout(() => { window.location.href = '/'; }, 300);
                </script></body></html>`;
                return new Response(html, { headers: { 'content-type': 'text/html;charset=UTF-8' } });

            } catch (e) {
                return new Response(`System Error: ${e.message}`, { status: 500 });
            }
        }

        // 🛡️ 2. 受保护 API
        if (path.startsWith('/api')) {
            const userToken = request.headers.get('Authorization');
            if (!userToken || userToken === 'Bearer null') {
                return new Response(JSON.stringify({ error: "Unauthorized", need_login: true }), { status: 401 });
            }

            const cleanEnv = {
                TRAKT_ID: env.TRAKT_ID,
                TMDB_TOKEN: env.TMDB_TOKEN,
                USER_TOKEN: userToken.replace('Bearer ', '')
            };

            try {
                if (request.method === 'POST' && path === '/api/action') {
                    return await handleUserAction(request, cleanEnv);
                }

                if (path.includes('/user/continue')) return handleTraktRequest(cleanEnv, 'sync/playback', 50, 'continue');
                if (path.includes('/user/watchlist')) return handleTraktRequest(cleanEnv, 'sync/watchlist', 100, 'chase');
                if (path.includes('/user/myschedule')) return handleTraktRequest(cleanEnv, 'calendars/my/shows', 14, 'myschedule');
                if (path.includes('/user/trakt_fav')) return handleTrueFavorites(cleanEnv);
                if (path.includes('/user/favs')) return handleUserFavs(cleanEnv);
                
                if (path.includes('/list')) {
                    return handleListRequest(cleanEnv, url.searchParams);
                }

                return new Response(JSON.stringify({ error: "Endpoint Not Found" }), { status: 404 });
            } catch (e) {
                return new Response(JSON.stringify({ error: e.message }), { status: 500 });
            }
        }

        return new Response(htmlContent, { headers: { 'content-type': 'text/html;charset=UTF-8' } });
    },
};

// --- 海报墙接口 ---
async function handlePublicBackdrop(env) {
    const headers = { ...REFLIX_HEADERS, 'trakt-api-key': env.TRAKT_ID };
    try {
        const res = await fetch('https://api.trakt.tv/movies/trending?limit=30', { headers });
        if (!res.ok) return new Response(JSON.stringify([]), {status: 200});
        const items = await res.json();
        
        const posters = await Promise.all(items.map(async (item) => {
            const tmdbId = item.movie?.ids?.tmdb;
            if(!tmdbId) return null;
            try {
                const tmdbRes = await fetch(`https://api.themoviedb.org/3/movie/${tmdbId}?language=en-US`, { 
                    headers: { 'Authorization': `Bearer ${env.TMDB_TOKEN}` } 
                });
                const d = await tmdbRes.json();
                return d.poster_path ? `https://image.tmdb.org/t/p/w342${d.poster_path}` : null;
            } catch { return null; }
        }));
        
        return new Response(JSON.stringify(posters.filter(p => p !== null)), { headers: {'Content-Type': 'application/json'} });
    } catch(e) {
        return new Response(JSON.stringify([]), {status: 200});
    }
}

// --- 交互动作 ---
async function handleUserAction(request, env) {
    const body = await request.json();
    const { action, item } = body; 
    let endpoint = '';
    let payload = {};
    
    const mediaObject = { ids: { tmdb: item.id } };
    if (item.media_type === 'movie') payload = { movies: [mediaObject] };
    else payload = { shows: [mediaObject] };

    const headers = { ...REFLIX_HEADERS, 'trakt-api-key': env.TRAKT_ID, 'Authorization': `Bearer ${env.USER_TOKEN}` };

    if (action === 'add_chase') endpoint = 'sync/watchlist';         
    else if (action === 'remove_chase') endpoint = 'sync/watchlist/remove'; 
    else if (action === 'add_history') endpoint = 'sync/history';    
    else if (action === 'add_collection') endpoint = 'sync/collection';         
    else if (action === 'remove_collection') endpoint = 'sync/collection/remove';

    if (!endpoint) return new Response(JSON.stringify({error: "Unknown Action"}), {status: 400});

    const res = await fetch(`https://api.trakt.tv/${endpoint}`, { method: 'POST', headers, body: JSON.stringify(payload) });
    const data = await res.json();
    return new Response(JSON.stringify(data), { headers: {'Content-Type': 'application/json'} });
}

// --- Favorites (Red Hearts) ---
async function handleTrueFavorites(env) {
    const headers = { ...REFLIX_HEADERS, 'trakt-api-key': env.TRAKT_ID, 'Authorization': `Bearer ${env.USER_TOKEN}` };
    const [resShows, resMovies] = await Promise.all([
        fetch('https://api.trakt.tv/users/me/favorites/shows', { headers }),
        fetch('https://api.trakt.tv/users/me/favorites/movies', { headers })
    ]);
    let shows = [], movies = [];
    if (resShows.ok) shows = await resShows.json();
    if (resMovies.ok) movies = await resMovies.json();

    let allItems = [...(Array.isArray(shows)?shows:[]), ...(Array.isArray(movies)?movies:[])];
    
    allItems.sort((a, b) => {
        const timeA = new Date(a.liked_at || 0).getTime();
        const timeB = new Date(b.liked_at || 0).getTime();
        return timeB - timeA;
    });

    return new Response(JSON.stringify(await hydrateTrakt(env, allItems.slice(0, 50), 'trakt_fav')), { headers: { 'Content-Type': 'application/json' } });
}

// --- 通用 Trakt 请求 ---
async function handleTraktRequest(env, path, limit, typeOverride) {
    const headers = { ...REFLIX_HEADERS, 'trakt-api-key': env.TRAKT_ID, 'Authorization': `Bearer ${env.USER_TOKEN}` };
    let url = `https://api.trakt.tv/${path}`;
    if (path.includes('watchlist')) url += `?sort=added,desc`; 
    else if (path.includes('playback')) url += `?limit=${limit}`; 
    else if (path.includes('calendars')) url = `${url}/${new Date().toISOString().split('T')[0]}/${limit}`;

    const res = await fetch(url, { headers });
    let rawData = [];
    if (res.ok) {
        const json = await res.json();
        if (Array.isArray(json)) rawData = json;
    }
    
    if (typeOverride === 'continue') {
        const seen = new Set();
        const unique = [];
        for (const item of rawData) {
            const id = item.show?.ids?.trakt || item.movie?.ids?.trakt || item.id;
            if (id && !seen.has(id)) { seen.add(id); unique.push(item); }
        }
        rawData = unique;
    }

    const hydrated = await hydrateTrakt(env, rawData, typeOverride);
    return new Response(JSON.stringify(hydrated), { headers: {'Content-Type': 'application/json'} });
}

// --- 列表请求 ---
async function handleListRequest(env, params) {
    const headers = { ...REFLIX_HEADERS, 'trakt-api-key': env.TRAKT_ID, 'Authorization': `Bearer ${env.USER_TOKEN}` };
    const tab = params.get('tab');
    let results = [];

    if (tab === 'schedule') {
        const today = new Date().toISOString().split('T')[0];
        const days = 7;
        const [myRes, pubRes] = await Promise.all([
            fetch(`https://api.trakt.tv/calendars/my/shows/${today}/${days}`, { headers }),
            fetch(`https://api.trakt.tv/calendars/all/shows/${today}/${days}?extended=full`, { headers })
        ]);
        let myData = myRes.ok ? await myRes.json() : [];
        let pubData = pubRes.ok ? await pubRes.json() : [];
        
        const seenIds = new Set();
        const merged = [];
        for(let i of myData) { if(i.show?.ids?.trakt && !seenIds.has(i.show.ids.trakt)) { seenIds.add(i.show.ids.trakt); merged.push({...i, is_mine:true}); }}
        const pubAnime = pubData.filter(i => (i.show?.country === 'jp') && (i.show?.genres?.includes('anime') || i.show?.genres?.includes('animation')));
        for(let i of pubAnime) { if(i.show?.ids?.trakt && !seenIds.has(i.show.ids.trakt)) { seenIds.add(i.show.ids.trakt); merged.push(i); }}
        
        results = await hydrateTrakt(env, merged, 'schedule');
    } else if (tab === 'trakt_hot') {
        const res = await fetch('https://api.trakt.tv/shows/trending?limit=15', { headers });
        if(res.ok) results = await hydrateTrakt(env, await res.json(), 'trending');
    } else {
        const r = await fetch(`https://api.themoviedb.org/3/trending/all/week?language=zh-CN`, { headers: { 'Authorization': `Bearer ${env.TMDB_TOKEN}` } });
        if(r.ok) results = (await r.json()).results;
    }
    return new Response(JSON.stringify(results), { headers: {'Content-Type': 'application/json'} });
}

async function hydrateTrakt(env, items, typeOverride) {
    if (!Array.isArray(items)) return [];
    const promises = items.slice(0, 35).map(async (item) => {
        let tmdbId, mediaType, airTime;
        if (item.first_aired) airTime = item.first_aired;
        else if (item.paused_at) airTime = item.paused_at; 
        else if (item.liked_at) airTime = item.liked_at; 
        else if (item.collected_at) airTime = item.collected_at;
        
        if (item.show) { tmdbId = item.show.ids.tmdb; mediaType = 'tv'; }
        else if (item.movie) { tmdbId = item.movie.ids.tmdb; mediaType = 'movie'; }
        else { tmdbId = item.id; mediaType = item.media_type || 'tv'; }
        
        if (!tmdbId) return null;
        try {
            const r = await fetch(`https://api.themoviedb.org/3/${mediaType}/${tmdbId}?language=zh-CN`, { headers: { 'Authorization': `Bearer ${env.TMDB_TOKEN}` } });
            if (!r.ok) return null;
            const d = await r.json();
            
            let episodeStill = null;
            let currentProgress = null;
            if (mediaType === 'tv' && item.episode) {
                try {
                    const epRes = await fetch(`https://api.themoviedb.org/3/tv/${tmdbId}/season/${item.episode.season}/episode/${item.episode.number}?language=zh-CN`, { headers: { 'Authorization': `Bearer ${env.TMDB_TOKEN}` } });
                    const epData = await epRes.json();
                    if(epData.still_path) episodeStill = epData.still_path;
                } catch(err) {}
            }
            if (typeOverride === 'continue' && item.progress) currentProgress = item.progress;
            return { 
                ...d, media_type: mediaType, trakt_type: typeOverride, air_time_iso: airTime, episode_info: item.episode, 
                origin_country: d.origin_country || [], genres: d.genres || [],
                runtime_real: d.runtime || (d.episode_run_time ? d.episode_run_time[0] : null),
                episode_image: episodeStill, next_ep_date: d.next_episode_to_air ? d.next_episode_to_air.air_date : null,
                last_ep_date: d.last_air_date, last_ep_info: d.last_episode_to_air,
                total_seasons: d.number_of_seasons, total_episodes: d.number_of_episodes, status: d.status,
                watch_progress: currentProgress, is_tracking: item.is_mine || false 
            }; 
        } catch { return null; }
    });
    const resolved = await Promise.all(promises);
    return resolved.filter(i => i !== null);
}

async function handleUserFavs(env) {
    const headers = { 'Authorization': `Bearer ${env.TMDB_TOKEN}` };
    const acc = await (await fetch('https://api.themoviedb.org/3/account', { headers })).json();
    const tv = await (await fetch(`https://api.themoviedb.org/3/account/${acc.id}/favorite/tv?language=zh-CN&sort_by=created_at.desc`, { headers })).json();
    const detailedList = await hydrateTrakt(env, tv.results.map(i => ({...i, media_type: 'tv'})), 'favs');
    return new Response(JSON.stringify(detailedList), { headers: {'Content-Type': 'application/json'} });
}

// ================= 🎨 前端 Vue UI =================
const htmlContent = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
<title>Trakt追新</title>
<link rel="icon" type="image/png" href="https://trakt.tv/assets/logos/logomark.square.gradient-b644b16c38ff775861b4b1f58c1230f6a097a2466ab33ae00445a505c33fcb91.svg">
<script src="https://cdn.tailwindcss.com"></script>
<script src="https://unpkg.com/vue@3/dist/vue.global.js"></script>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
<link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700;900&display=swap" rel="stylesheet">
<style>
  :root { --bg-app: linear-gradient(135deg, #f0f2f5 0%, #d9e2ec 100%); --bg-desktop: #e0e5ec; --text-primary: #111; --text-secondary: #555; --text-tertiary: #666; --card-bg: #fff; --card-shadow: 0 8px 20px -6px rgba(0,0,0,0.08); --glass-header: rgba(240,242,245,0.85); --glass-nav: rgba(255,255,255,0.75); --glass-border: rgba(255,255,255,0.5); --accent-purple: #6D28D9; --pill-bg: rgba(255,255,255,0.6); --pill-active-text: #fff; --capsule-bg: rgba(0,0,0,0.06); --capsule-left-bg: #000; --capsule-left-text: #fff; --capsule-right-text: #000; --btn-bg: #111; --btn-text: #fff; --mask-gradient: linear-gradient(90deg, #EAECEF 28%, rgba(234,236,239,0.92) 55%, rgba(255,255,255,0.2) 100%); --overview-text: #222; --action-sheet-bg: rgba(255,255,255,0.85); }
  @media (prefers-color-scheme: dark) { :root { --bg-app: linear-gradient(135deg, #121212 0%, #1e1e24 100%); --bg-desktop: #000; --text-primary: #f5f5f5; --text-secondary: #a0a0a0; --text-tertiary: #888; --card-bg: #1e1e1e; --card-shadow: 0 8px 20px -6px rgba(0,0,0,0.4); --glass-header: rgba(18,18,18,0.85); --glass-nav: rgba(30,30,30,0.75); --glass-border: rgba(255,255,255,0.1); --accent-purple: #8b5cf6; --pill-bg: rgba(255,255,255,0.1); --pill-active-text: #fff; --capsule-bg: rgba(255,255,255,0.1); --capsule-left-bg: #f5f5f5; --capsule-left-text: #000; --capsule-right-text: #ddd; --btn-bg: #fff; --btn-text: #000; --mask-gradient: linear-gradient(90deg, #1e1e1e 28%, rgba(30,30,30,0.92) 55%, rgba(30,30,30,0.2) 100%); --overview-text: #fff; --action-sheet-bg: rgba(30,30,30,0.85); } }
  html, body { width: 100%; height: 100%; margin: 0; padding: 0; overflow: hidden; font-family: 'Roboto', sans-serif; background: var(--bg-app); -webkit-tap-highlight-color: transparent; overscroll-behavior: none; position: fixed; inset: 0; color: var(--text-primary); }
  #app-container { width: 100%; height: 100%; position: relative; display: flex; flex-direction: column; overflow: hidden; }
  @media (min-width: 768px) { body { background-color: var(--bg-desktop); display: flex; justify-content: center; align-items: center; position: static; } #app-container { width: 100%; max-width: 430px; height: 90vh; max-height: 880px; position: relative; border-radius: 44px; border: 8px solid #2a2a2a; box-shadow: 0 0 60px rgba(0,0,0,0.6); overflow: hidden; background: var(--bg-app); } }
  
  /* 🔥 强制左对齐修正 */
  .top-glass-bar { position: absolute; top: 0; left: 0; right: 0; z-index: 20; background: var(--glass-header); backdrop-filter: blur(20px) saturate(180%); -webkit-backdrop-filter: blur(20px) saturate(180%); border-bottom: 1px solid var(--glass-border); padding-top: env(safe-area-inset-top); padding-bottom: 10px; }
  
  /* 统一左内边距 24px */
  .header-nav { display: flex; align-items: center; padding: 8px 24px 4px 24px; justify-content: flex-start; gap: 15px; } 
  .page-header { padding: 0 24px; }
  .sub-tabs { display: flex; gap: 8px; overflow-x: auto; padding: 0 24px 8px 24px; } 
  .week-grid-tabs { display: grid; grid-template-columns: repeat(7, 1fr); gap: 5px; padding: 0 24px 4px 24px; }

  .media-segment { display: flex; align-items: center; background: var(--pill-bg); backdrop-filter: blur(10px); border-radius: 99px; padding: 3px; border: 1px solid var(--glass-border); }
  .seg-btn { border-radius: 99px; padding: 6px 14px; display: flex; align-items: center; justify-content: center; gap: 6px; color: var(--text-secondary); transition: all 0.3s; font-size: 13px; cursor: pointer; font-weight: 600; }
  .seg-btn.active { background: var(--accent-purple); color: var(--pill-active-text); box-shadow: 0 2px 8px rgba(109, 40, 217, 0.3); }
  
  .page-title { font-size: 26px; font-weight: 900; color: var(--text-primary); margin-bottom: 8px; letter-spacing: -0.5px; }
  .sub-tabs::-webkit-scrollbar { display: none; }
  .sub-pill { padding: 7px 14px; border-radius: 12px; font-size: 12px; font-weight: 700; background: var(--pill-bg); border: 1px solid var(--glass-border); color: var(--text-secondary); white-space: nowrap; transition: all 0.2s; flex-shrink: 0; }
  .sub-pill.active { background: var(--text-primary); color: var(--bg-app); border-color: var(--text-primary); transform: scale(1.03); opacity: 0.95; color: var(--card-bg) !important; }
  .week-pill { padding: 7px 0; font-size: 12px; width: 100%; min-width: 0; text-align: center; background: var(--pill-bg); border-radius: 10px; font-weight: 700; color: var(--text-secondary); transition: all 0.2s; }
  .week-pill.active { background: var(--accent-purple); color: var(--pill-active-text); box-shadow: 0 3px 8px rgba(109, 40, 217, 0.3); }
  
  .scroll-content { position: absolute; inset: 0; overflow-y: auto; padding: 0 16px; padding-top: calc(env(safe-area-inset-top) + 165px); padding-bottom: calc(env(safe-area-inset-bottom) + 80px); -webkit-overflow-scrolling: touch; overscroll-behavior-y: contain; z-index: 1; }
  .scroll-content::-webkit-scrollbar { display: none; } 
  .list-container { display: flex; flex-direction: column; gap: 14px; }
  .rich-card { position: relative; width: 100%; height: 135px; border-radius: 22px; overflow: hidden; background: var(--card-bg); box-shadow: var(--card-shadow); display: flex; align-items: center; flex-shrink: 0; transition: transform 0.2s; cursor: pointer; }
  .rich-card:active { transform: scale(0.97); }
  .card-bg { position: absolute; inset: 0; background-size: cover; background-position: center; opacity: 0.85; z-index: 0; filter: saturate(1.1); }
  .card-mask { position: absolute; inset: 0; background: var(--mask-gradient); z-index: 1; }
  .card-body { position: relative; z-index: 2; width: 100%; height: 100%; display: flex; align-items: center; padding-left: 14px; }
  .poster-wrapper { position: relative; width: 76px; height: 112px; margin-right: 12px; flex-shrink: 0; }
  .poster-thumb { width: 100%; height: 100%; border-radius: 12px; object-fit: cover; box-shadow: 0 5px 10px rgba(0,0,0,0.15); background: #333; }
  .date-badge { position: absolute; bottom: 0; left: 0; right: 0; background: rgba(0,0,0,0.65); backdrop-filter: blur(4px); color: #fff; font-size: 10px; font-weight: 700; text-align: center; padding: 3px 0; border-radius: 0 0 12px 12px; z-index: 10; letter-spacing: 0.5px; }
  .info-col { flex: 1; height: 112px; display: flex; flex-direction: column; padding-top: 4px; position: relative; min-width: 0; }
  .title-txt { font-size: 16px; font-weight: 900; color: var(--text-primary); margin-bottom: 2px; line-height: 1.2; display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden; letter-spacing: -0.3px; }
  .subtitle-txt { font-size: 12px; color: var(--text-secondary); font-weight: 600; display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden; margin-bottom: 4px; }
  .status-txt { font-size: 11px; color: var(--text-tertiary); font-weight: 600; margin-bottom: auto; display: flex; align-items: center; gap: 4px; }
  .capsule-bar { margin-bottom: 5px; width: 88%; height: 24px; background: var(--capsule-bg); border-radius: 99px; display: flex; align-items: center; position: relative; backdrop-filter: blur(10px); padding: 2px; border: 1px solid var(--glass-border); }
  .capsule-left { background: var(--capsule-left-bg); color: var(--capsule-left-text); padding: 0 10px; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 800; border-radius: 99px; white-space: nowrap; z-index: 2; box-shadow: 2px 0 6px rgba(0,0,0,0.1); }
  .capsule-right { flex: 1; text-align: right; padding-right: 10px; color: var(--capsule-right-text); font-size: 10px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; opacity: 0.9; }
  .check-mark { position: absolute; bottom: 7px; right: 10px; color: var(--accent-purple); font-size: 15px; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.1)); z-index: 5; }
  .bottom-nav { position: absolute; left: 50%; transform: translateX(-50%); width: 92%; max-width: 380px; height: 64px; background: var(--glass-nav); backdrop-filter: blur(25px) saturate(180%); -webkit-backdrop-filter: blur(25px) saturate(180%); border-radius: 99px; border: 1px solid var(--glass-border); box-shadow: 0 10px 25px rgba(0,0,0,0.12); display: flex; justify-content: space-evenly; align-items: center; z-index: 50; bottom: calc(10px + env(safe-area-inset-bottom)); }
  .nav-btn { display: flex; flex-direction: column; align-items: center; justify-content: center; color: var(--nav-icon-inactive); font-size: 10px; gap: 3px; width: 68px; height: 100%; transition: all 0.3s; font-weight: 600; }
  .nav-btn i { font-size: 26px; transition: transform 0.3s; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.05)); } 
  .nav-btn.active { color: var(--nav-icon-active); } .nav-btn.active i { transform: translateY(-3px) scale(1.1); color: var(--accent-purple); filter: drop-shadow(0 3px 6px rgba(109, 40, 217, 0.25)); }
  .nav-btn.active .user-avatar { border-color: var(--accent-purple); transform: translateY(-3px) scale(1.05); }
  .user-avatar { width: 28px; height: 28px; border-radius: 50%; background: #ccc; border: 2px solid transparent; transition: all 0.3s; box-shadow: 0 2px 5px rgba(0,0,0,0.15); }
  .modal-overlay { position: absolute; inset: 0; z-index: 100; background: rgba(0,0,0,0.5); backdrop-filter: blur(6px); display: flex; align-items: flex-end; transition: opacity 0.3s; }
  .detail-sheet { width: 100%; max-height: 85%; background: var(--sheet-bg); border-radius: 32px 32px 0 0; padding-bottom: calc(30px + env(safe-area-inset-bottom)); box-shadow: 0 -10px 50px rgba(0,0,0,0.35); display: flex; flex-direction: column; overflow: hidden; animation: slideUp 0.4s cubic-bezier(0.19, 1, 0.22, 1); }
  @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
  .sheet-header { height: 240px; position: relative; flex-shrink: 0; }
  .sheet-backdrop { width: 100%; height: 100%; object-fit: cover; mask-image: linear-gradient(to bottom, black 60%, transparent 100%); -webkit-mask-image: linear-gradient(to bottom, black 60%, transparent 100%); }
  .sheet-close { position: absolute; top: 16px; right: 16px; width: 34px; height: 34px; border-radius: 50%; background: rgba(0,0,0,0.5); color: #fff; display: flex; justify-content: center; align-items: center; backdrop-filter: blur(15px); cursor: pointer; border: 1px solid rgba(255,255,255,0.2); }
  .sheet-body { padding: 0 24px 20px 24px; overflow-y: auto; margin-top: -40px; position: relative; z-index: 2; }
  .sheet-title { font-size: 28px; font-weight: 900; line-height: 1.1; margin-bottom: 16px; color: var(--text-primary); letter-spacing: -0.5px; text-shadow: 0 20px 40px var(--sheet-bg); }
  .rating-row { display: flex; gap: 12px; margin-bottom: 16px; align-items: center; }
  .rating-badge { display: flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 12px; font-size: 13px; font-weight: 800; }
  .rating-badge.tmdb { background: rgba(13, 37, 63, 0.15); color: #0d253f; } .rating-badge.trakt { background: rgba(237, 28, 36, 0.15); color: #ed1c24; }
  @media (prefers-color-scheme: dark) { .rating-badge.tmdb { background: rgba(13, 37, 63, 0.6); color: #90cea1; } .rating-badge.trakt { background: rgba(237, 28, 36, 0.4); color: #ff9999; } }
  .platform-logo { height: 14px; width: auto; }
  .genre-row { display: flex; gap: 8px; overflow-x: auto; margin-bottom: 20px; padding-bottom: 4px; } .genre-row::-webkit-scrollbar { display: none; }
  .genre-pill { flex-shrink: 0; padding: 4px 10px; border-radius: 8px; border: 1px solid var(--glass-border); color: var(--text-secondary); font-size: 11px; font-weight: 600; background: var(--pill-bg); }
  .sheet-info-grid { display: flex; gap: 15px; margin-bottom: 20px; font-size: 13px; color: var(--text-secondary); font-weight: 600; }
  .info-item { display: flex; align-items: center; gap: 5px; }
  .sheet-overview { font-size: 16px; line-height: 1.7; color: var(--overview-text); margin-bottom: 30px; font-weight: 400; opacity: 1; }
  .sheet-btn { width: 100%; padding: 16px; border-radius: 18px; background: var(--btn-bg); color: var(--btn-text); font-weight: 800; font-size: 17px; display: flex; justify-content: center; align-items: center; gap: 10px; box-shadow: 0 10px 25px rgba(0,0,0,0.25); transition: transform 0.2s; } .sheet-btn:active { transform: scale(0.98); }
  .loading-box { display: flex; justify-content: center; padding-top: 200px; color: var(--text-tertiary); }
  .action-menu-overlay { position: absolute; inset: 0; background: rgba(0,0,0,0.4); z-index: 200; display: flex; flex-direction: column; justify-content: flex-end; animation: fadeIn 0.2s; }
  .action-sheet { background: var(--action-sheet-bg); border-radius: 24px 24px 0 0; padding: 20px; padding-bottom: calc(20px + env(safe-area-inset-bottom)); animation: slideUp 0.3s cubic-bezier(0.2, 0.8, 0.2, 1); backdrop-filter: blur(25px) saturate(180%); -webkit-backdrop-filter: blur(25px) saturate(180%); border-top: 1px solid var(--glass-border); }
  .action-btn { display: flex; align-items: center; gap: 12px; padding: 16px; font-size: 16px; font-weight: 600; color: var(--text-primary); border-bottom: 1px solid var(--glass-border); } .action-btn:last-child { border-bottom: none; }
  .toast-box { position: absolute; top: 110px; left: 50%; transform: translateX(-50%); background: rgba(0,0,0,0.85); color: #fff; padding: 10px 20px; border-radius: 50px; font-size: 13px; font-weight: 600; z-index: 300; display: flex; align-items: center; gap: 8px; backdrop-filter: blur(10px); box-shadow: 0 5px 15px rgba(0,0,0,0.2); animation: toastPop 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275); }
  .more-btn-area { position: absolute; top: 0; right: 0; width: 50px; height: 50px; display: flex; justify-content: center; align-items: center; z-index: 10; color: #fff; text-shadow: 0 1px 3px rgba(0,0,0,0.6); }

  .login-overlay { position: fixed; inset: 0; z-index: 999; background: #000; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 30px; overflow: hidden; }
  .poster-bg { position: absolute; inset: -10%; z-index: 0; display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; opacity: 0.4; filter: blur(3px) brightness(0.6); transform: rotate(-5deg) scale(1.1); pointer-events: none; }
  .poster-col { display: flex; flex-direction: column; gap: 12px; width: 100%; animation: marquee 60s linear infinite; }
  .poster-col:nth-child(2) { animation-direction: reverse; margin-top: -100px; }
  .poster-col:nth-child(3) { animation-duration: 75s; }
  .poster-img { width: 100%; height: auto; border-radius: 10px; object-fit: cover; box-shadow: 0 4px 10px rgba(0,0,0,0.5); display: block; aspect-ratio: 2/3; }
  @keyframes marquee { 0% { transform: translateY(0); } 100% { transform: translateY(-50%); } }
  .login-card { position: relative; z-index: 2; background: rgba(255,255,255,0.9); padding: 40px 30px; border-radius: 30px; box-shadow: 0 20px 50px rgba(0,0,0,0.5); width: 100%; max-width: 320px; text-align: center; backdrop-filter: blur(20px); }
  @media (prefers-color-scheme: dark) { .login-card { background: rgba(30,30,30,0.85); border: 1px solid rgba(255,255,255,0.1); } }
  .login-logo { width: 64px; height: 64px; margin-bottom: 20px; border-radius: 14px; box-shadow: 0 5px 15px rgba(0,0,0,0.2); }
  .login-btn { background: #ED1C24; color: #fff; width: 100%; padding: 16px; border-radius: 99px; font-weight: 800; font-size: 16px; display: flex; align-items: center; justify-content: center; gap: 10px; margin-top: 24px; box-shadow: 0 5px 20px rgba(237,28,36,0.4); transition: transform 0.2s; }
  .login-btn:active { transform: scale(0.96); }
  .logout-confirm-box { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 280px; background: var(--card-bg); padding: 25px; border-radius: 20px; text-align: center; z-index: 500; box-shadow: 0 10px 40px rgba(0,0,0,0.3); border: 1px solid var(--glass-border); }
  .logout-btn-group { display: flex; gap: 10px; margin-top: 20px; }
  .logout-btn { flex: 1; padding: 10px; border-radius: 10px; font-weight: bold; cursor: pointer; }
  .btn-cancel { background: var(--capsule-bg); color: var(--text-primary); }
  .btn-confirm { background: #ED1C24; color: #fff; }
</style>
</head>
<body>
<div id="app-container">

    <div v-if="!isLoggedIn" class="login-overlay">
        <div class="poster-bg" v-if="backgroundPosters.length > 0">
            <div class="poster-col">
                <img v-for="(img, i) in backgroundPosters.slice(0,10)" :key="'c1'+i" :src="img" class="poster-img">
                <img v-for="(img, i) in backgroundPosters.slice(0,10)" :key="'c1d'+i" :src="img" class="poster-img">
            </div>
            <div class="poster-col">
                <img v-for="(img, i) in backgroundPosters.slice(10,20)" :key="'c2'+i" :src="img" class="poster-img">
                <img v-for="(img, i) in backgroundPosters.slice(10,20)" :key="'c2d'+i" :src="img" class="poster-img">
            </div>
            <div class="poster-col">
                <img v-for="(img, i) in backgroundPosters.slice(20,30)" :key="'c3'+i" :src="img" class="poster-img">
                <img v-for="(img, i) in backgroundPosters.slice(20,30)" :key="'c3d'+i" :src="img" class="poster-img">
            </div>
        </div>
        <div class="login-card">
            <img src="https://trakt.tv/assets/logos/logomark.square.gradient-b644b16c38ff775861b4b1f58c1230f6a097a2466ab33ae00445a505c33fcb91.svg" class="login-logo mx-auto">
            <h1 style="font-size:26px; font-weight:900; margin-bottom:8px; letter-spacing:-0.5px;">Trakt追新</h1>
            <p style="color:var(--text-secondary); font-size:14px; font-weight:500; opacity:0.8;">自动同步您的观影数据与收藏</p>
            <a href="/auth/login" class="login-btn"><i class="fas fa-plug"></i> Connect Trakt</a>
        </div>
    </div>
    
    <div v-if="showLogoutModal" class="modal-overlay" @click.self="showLogoutModal = false">
        <div class="logout-confirm-box">
            <h3 style="font-size:18px; font-weight:800; margin-bottom:8px;">确定要退出吗？</h3>
            <p style="color:var(--text-secondary); font-size:13px;">退出后需要重新登录才能同步数据</p>
            <div class="logout-btn-group">
                <div class="logout-btn btn-cancel" @click="showLogoutModal = false">取消</div>
                <div class="logout-btn btn-confirm" @click="logout">退出登录</div>
            </div>
        </div>
    </div>

    <div class="top-glass-bar">
        <div class="header-nav">
            <div class="media-segment">
                <div @click="filterType = 'all'" :class="['seg-btn', filterType === 'all' ? 'active' : '']"><i class="fas fa-layer-group"></i><span v-if="filterType === 'all'">媒体库</span></div>
                <div @click="filterType = 'tv'" :class="['seg-btn', filterType === 'tv' ? 'active' : '']"><i class="fas fa-tv"></i><span v-if="filterType === 'tv'">电视剧</span></div>
                <div @click="filterType = 'movie'" :class="['seg-btn', filterType === 'movie' ? 'active' : '']"><i class="fas fa-film"></i><span v-if="filterType === 'movie'">电影</span></div>
            </div>
            <div style="width:24px;"></div>
        </div>
        <div class="page-header">
            <h2 class="page-title">{{ getPageTitle() }}</h2>
            <div class="week-grid-tabs" v-if="currentMainTab === 'schedule'">
                 <button v-for="(d, idx) in weekDays" :key="idx" @click="selectedWeekDay = idx" :class="['week-pill', selectedWeekDay === idx ? 'active' : '']">{{ d }}</button>
            </div>
            <div class="sub-tabs" v-else>
                <button v-for="tab in subTabs" :key="tab.key" @click="currentSubTab = tab.key" :class="['sub-pill', currentSubTab === tab.key ? 'active' : '']">{{ tab.name }}</button>
            </div>
        </div>
    </div>
    
    <div v-if="toastMsg" class="toast-box"><i class="fas fa-info-circle text-blue-400"></i> {{ toastMsg }}</div>

    <div class="scroll-content">
        <div v-if="loading" class="loading-box"><i class="fas fa-circle-notch fa-spin fa-2x"></i></div>
        <div v-else class="list-container">
            <div v-for="item in processedList" :key="item.id" class="rich-card" @click="openModal(item)">
                <div class="card-bg" :style="{ backgroundImage: 'url(' + getBackdrop(item) + ')' }"></div>
                <div class="card-mask"></div>
                <div class="card-body">
                    <div class="poster-wrapper">
                         <img :src="getPoster(item)" class="poster-thumb" loading="lazy">
                         <div v-if="currentMainTab === 'schedule'" class="date-badge">{{ getRelativeDateLabel(item) }}</div>
                    </div>
                    <div class="info-col">
                        <div class="more-btn-area" @click.stop="openMenu(item)"><i class="fas fa-ellipsis-h"></i></div>
                        <div class="title-txt">{{ item.name || item.title }}</div>
                        <div class="subtitle-txt">{{ formatSubtitle(item) }}</div>
                        <div class="status-txt"><i class="far fa-calendar-check"></i> {{ formatScheduleInfo(item) }}</div>
                        <div class="capsule-bar">
                            <div class="capsule-left">{{ formatDuration(item) }}</div>
                            <div class="capsule-right" style="font-size:9px">
                                {{ currentSubTab === 'continue' ? formatTraktStats(item) : formatCapsuleRight(item) }}
                            </div>
                        </div>
                        <div class="check-mark"><i class="fas fa-check-circle"></i></div>
                    </div>
                </div>
            </div>
            <div v-if="processedList.length === 0" class="text-center py-20 text-gray-400 text-sm font-bold">暂时没有内容</div>
        </div>
    </div>
    <div class="bottom-nav">
        <div @click="switchMainTab('discover')" :class="['nav-btn', currentMainTab === 'discover' ? 'active' : '']"><i class="far fa-compass"></i><span>发现</span></div>
        <div @click="switchMainTab('schedule')" :class="['nav-btn', currentMainTab === 'schedule' ? 'active' : '']"><i class="far fa-calendar-alt"></i><span>新番</span></div>
        <div @click="handleMineClick" :class="['nav-btn', currentMainTab === 'mine' ? 'active' : '']"><img src="https://ui-avatars.com/api/?name=Me&background=random&color=fff" class="user-avatar"><span>我的</span></div>
    </div>

    <div v-if="selectedItem" class="modal-overlay" @click.self="selectedItem = null">
        <div class="detail-sheet">
            <div class="sheet-header">
                <img :src="getBackdrop(selectedItem)" class="sheet-backdrop">
                <div class="sheet-close" @click="selectedItem = null"><i class="fas fa-times"></i></div>
            </div>
            <div class="sheet-body">
                <h2 class="sheet-title">{{ selectedItem.name || selectedItem.title }}</h2>
                <div class="rating-row">
                    <div class="rating-badge tmdb"><img src="https://www.themoviedb.org/assets/2/v4/logos/v2/blue_square_2-d537fb228cf3ded904ef09b136fe3fec72548ebc1fea3fbbd1ad9e36364db38b.svg" class="platform-logo"><span class="score-val">{{ selectedItem.vote_average?.toFixed(1) || '0.0' }}</span></div>
                    <div class="rating-badge trakt" v-if="selectedItem.vote_count"><img src="https://trakt.tv/assets/logos/logomark.square.gradient-b644b16c38ff775861b4b1f58c1230f6a097a2466ab33ae00445a505c33fcb91.svg" class="platform-logo"><span class="score-val" style="color:var(--text-primary)">{{ formatVotes(selectedItem.vote_count) }}</span></div>
                </div>
                <div class="genre-row" v-if="selectedItem.genres && selectedItem.genres.length"><span v-for="g in selectedItem.genres" :key="g.id" class="genre-pill">{{ g.name }}</span></div>
                <div class="sheet-info-grid">
                    <div class="info-item" v-if="selectedItem.runtime_real"><i class="far fa-clock"></i> {{ selectedItem.runtime_real }}分钟</div>
                    <div class="info-item">{{ formatSubtitle(selectedItem) }}</div>
                </div>
                <p class="sheet-overview">{{ selectedItem.overview || '暂无简介...' }}</p>
                <div class="sheet-btn" @click="performAction('add_chase', selectedItem)"><i class="fas fa-bookmark"></i> 加入我的追番</div>
            </div>
        </div>
    </div>

    <div v-if="menuItem" class="action-menu-overlay" @click.self="menuItem = null">
        <div class="action-sheet">
            <div style="font-size:18px; font-weight:800; margin-bottom:15px; padding:0 10px; color:var(--text-primary);">{{ menuItem.name || menuItem.title }}</div>
            <div class="action-btn" @click="performAction('add_chase', menuItem)"><i class="fas fa-bookmark text-blue-500"></i> 加入追番 (Watchlist)</div>
            <div class="action-btn" @click="performAction('remove_chase', menuItem)"><i class="fas fa-ban text-gray-500"></i> 取消追番 (Untrack)</div>
            <div class="action-btn" @click="performAction('add_collection', menuItem)"><i class="fas fa-heart text-red-500"></i> 加入Trakt收藏 (Collection)</div>
             <div class="action-btn" @click="performAction('remove_collection', menuItem)"><i class="far fa-heart text-gray-400"></i> 取消Trakt收藏</div>
            <div class="action-btn" @click="performAction('add_history', menuItem)"><i class="fas fa-check-circle text-green-500"></i> 标记为已看 (Watched)</div>
            <div class="action-btn" @click="menuItem = null" style="justify-content:center; color:var(--text-tertiary); font-weight:500; margin-top:10px; border:none;">关闭</div>
        </div>
    </div>
</div>

<script>
const { createApp, ref, computed, onMounted, watch } = Vue;
createApp({
    setup() {
        const TMDB_IMG = 'https://image.tmdb.org/t/p/';
        const currentMainTab = ref('discover'); 
        const currentSubTab = ref('trakt_hot');
        const filterType = ref('all'); 
        const loading = ref(false);
        const rawData = ref([]);
        const selectedItem = ref(null);
        const menuItem = ref(null);
        const toastMsg = ref('');
        const weekDays = ['周日','周一','周二','周三','周四','周五','周六'];
        const selectedWeekDay = ref(new Date().getDay()); 
        const isLoggedIn = ref(false);
        const showLogoutModal = ref(false);
        const lastMineClickTime = ref(0);
        const backgroundPosters = ref([]);
        
        // ⚡️ 竞态锁
        const fetchId = ref(0);

        onMounted(() => {
            const token = localStorage.getItem('trakt_token');
            if (token) {
                isLoggedIn.value = true;
                fetchData();
            } else {
                fetchBackdrop();
            }
        });

        const fetchBackdrop = async () => {
            try {
                const res = await fetch('/api/public/backdrop');
                if(res.ok) backgroundPosters.value = await res.json();
            } catch(e){}
        };

        const logout = () => {
            localStorage.removeItem('trakt_token');
            isLoggedIn.value = false;
            showLogoutModal.value = false;
            rawData.value = [];
            fetchBackdrop(); 
        };

        const subTabs = computed(() => {
            if (currentMainTab.value === 'mine') return [ 
                { key: 'continue', name: '继续观看' },
                { key: 'chase',    name: '我的追番' },
                { key: 'myschedule', name: '即将播出' },
                { key: 'trakt_fav',  name: 'Trakt红心' }
            ]; 
            else if (currentMainTab.value === 'schedule') return []; 
            else return [ { key: 'trakt_hot', name: '热门趋势' }, { key: 'hot', name: '本周热榜' } ];
        });
        
        const getPageTitle = () => { 
            if(currentMainTab.value === 'schedule') return '追新时刻表'; 
            const map = { 'continue': '继续观看', 'chase': '我的追番', 'myschedule': '即将播出', 'trakt_fav': 'Trakt 喜爱(Hearts)', 'fav_all': 'TMDB收藏', 'trakt_hot': 'Trakt 热门', 'hot': 'TMDB 热榜' }; 
            return map[currentSubTab.value] || '发现'; 
        };
        
        const processedList = computed(() => {
            let list = rawData.value;
            if (filterType.value === 'tv') list = list.filter(i => i.media_type === 'tv');
            if (filterType.value === 'movie') list = list.filter(i => i.media_type === 'movie');
            if (currentMainTab.value === 'schedule') {
                return list.filter(i => { const dateStr = i.air_time_iso || i.first_air_date; if(!dateStr) return false; return new Date(dateStr).getDay() === selectedWeekDay.value; });
            }
            return list;
        });

        const fetchData = async () => {
            if(!isLoggedIn.value) return;
            fetchId.value++;
            const currentReqId = fetchId.value;
            
            loading.value = true; rawData.value = []; let url = '';
            if(currentSubTab.value === 'continue') url = '/api/user/continue';
            else if(currentSubTab.value === 'chase') url = '/api/user/watchlist';
            else if(currentSubTab.value === 'myschedule') url = '/api/user/myschedule';
            else if(currentSubTab.value === 'trakt_fav') url = '/api/user/trakt_fav';
            else if(currentSubTab.value === 'fav_all') url = '/api/user/favs';
            else url = \`/api/list?tab=\${currentSubTab.value}\`;
            
            try {
                const token = localStorage.getItem('trakt_token');
                const res = await fetch(url, {
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                
                if (currentReqId !== fetchId.value) return;

                if(res.status === 401) { logout(); return; }
                const data = await res.json();
                if(data.error) throw new Error(data.error);
                rawData.value = Array.isArray(data) ? data : (data.results || []);
            } catch(e) { console.error(e); } finally { 
                if (currentReqId === fetchId.value) loading.value = false; 
            }
        };

        const performAction = async (action, item) => {
            menuItem.value = null; selectedItem.value = null; showToast("正在提交...");
            try {
                const token = localStorage.getItem('trakt_token');
                const res = await fetch('/api/action', {
                    method: 'POST', 
                    headers: {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token},
                    body: JSON.stringify({ action, item })
                });
                if(!res.ok) throw new Error("失败");
                const map = { 'add_chase': '🔖 已加入追番', 'remove_chase': '🗑️ 已取消追番', 'add_history': '🎉 标记为已看', 'add_collection': '❤️ 已收藏', 'remove_collection': '💔 已取消收藏'};
                showToast(map[action] || '操作成功');
                setTimeout(fetchData, 1000);
            } catch(e) { showToast("❌ 操作失败"); }
        };

        const showToast = (msg) => { toastMsg.value = msg; setTimeout(() => toastMsg.value = '', 2500); };
        const switchMainTab = (tab) => { 
            currentMainTab.value = tab; 
            if(tab === 'mine') currentSubTab.value = 'continue'; 
            else if(tab === 'schedule') currentSubTab.value = 'schedule'; 
            else currentSubTab.value = 'trakt_hot'; 
            fetchData(); 
        };
        
        const handleMineClick = () => {
            const now = Date.now();
            if (currentMainTab.value === 'mine' && (now - lastMineClickTime.value < 300)) {
                showLogoutModal.value = true;
            } else {
                switchMainTab('mine');
            }
            lastMineClickTime.value = now;
        };

        watch([currentSubTab, selectedWeekDay], () => { if(currentMainTab.value !== 'schedule') fetchData(); });
        watch(currentMainTab, () => { fetchData(); })

        const formatSubtitle = (item) => { if (item.episode_info) return \`S\${item.episode_info.season} E\${item.episode_info.number}\`; if (item.total_episodes) return \`共 \${item.total_episodes} 集\`; return item.original_name || item.title || 'Movie'; };
        const formatDuration = (item) => { let t = item.runtime_real; if (!t && item.media_type === 'tv') { const isAnime = (item.origin_country?.includes('JP')) || (item.genres?.some(g => g.name === 'Animation' || g.name === '动画')); t = isAnime ? 24 : 45; } if (!t || t === 0) return '未知'; return \`\${t}分钟\`; };
        const formatTraktStats = (item) => { if (item.media_type === 'movie') return 'Movie'; let total = item.total_episodes || 0; let current = item.episode_info ? item.episode_info.number : 0; let remaining = Math.max(0, total - current); if (item.status === 'Ended' && remaining <= 0) return '已完结'; let runtimeStr = formatDuration(item); let runtime = parseInt(runtimeStr) || 24; let minsLeft = remaining * runtime; let timeStr = minsLeft > 60 ? \`\${Math.floor(minsLeft/60)}小时 \${minsLeft%60}分\` : \`\${minsLeft}分钟\`; return \`剩余\${remaining}集 · \${timeStr}\`; };
        const formatScheduleInfo = (item) => { if (item.watch_progress) return \`已看 \${parseFloat(item.watch_progress).toFixed(1)}%\`; if (item.status === 'Returning Series' && item.next_ep_date) { const day = new Date(item.next_ep_date).getDay(); const weekStr = ['日','一','二','三','四','五','六'][day]; return \`每周\${weekStr}更新\`; } if (item.status === 'Ended' && item.first_air_date && item.last_ep_date) { const start = item.first_air_date.slice(0,4); const end = item.last_ep_date.slice(0,4); return \`\${start} - \${end}\`; } if(item.release_date) return item.release_date; if(item.first_air_date) return \`首播: \${item.first_air_date}\`; return '未知日程'; };
        const formatCapsuleRight = (item) => { if (item.media_type === 'movie') { return item.release_date ? item.release_date.split('-')[0] : '电影'; } const total = item.total_episodes || 0; const lastEp = item.last_ep_info; const current = lastEp ? lastEp.episode_number : 0; if (total > 0) { if (item.status === 'Ended' || item.status === 'Canceled') return \`\${total}集全\`; if (current > 0) return \`\${current}/\${total}集\`; return \`共\${total}集\`; } if (item.status === 'Returning Series') return '更新中'; if (item.status === 'Ended') return '已完结'; return 'TV Series'; };
        const getRelativeDateLabel = (item) => { const dateStr = item.air_time_iso || item.first_air_date; if (!dateStr) return ''; const targetDate = new Date(dateStr); const today = new Date(); today.setHours(0,0,0,0); const targetCheck = new Date(targetDate); targetCheck.setHours(0,0,0,0); const diffTime = targetCheck - today; const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); if (diffDays === 0) return '今天'; if (diffDays === 1) return '明天'; if (diffDays === 2) return '后天'; const weekStr = ['周日','周一','周二','周三','周四','周五','周六'][targetDate.getDay()]; if (Math.abs(diffDays) > 7) return \`\${targetDate.getMonth()+1}/\${targetDate.getDate()}\`; return weekStr; };
        const formatVotes = (num) => { if(!num) return '0'; if(num > 1000) return (num/1000).toFixed(1) + 'k'; return num; };
        const getPoster = (i) => i.poster_path ? TMDB_IMG + 'w200' + i.poster_path : 'https://via.placeholder.com/200x300/e0e0e0/ffffff?text=No+Poster';
        const getBackdrop = (i) => { if (i.episode_image) return TMDB_IMG + 'w780' + i.episode_image; if (i.backdrop_path) return TMDB_IMG + 'w780' + i.backdrop_path; return 'https://via.placeholder.com/600x340/e0e0e0/ffffff?text=TMDB&Trakt'; };
        const openModal = (item) => { selectedItem.value = item; };
        const openMenu = (item) => { menuItem.value = item; }; 
        onMounted(() => { if(isLoggedIn.value) fetchData(); });
        return { currentMainTab, switchMainTab, currentSubTab, subTabs, filterType, weekDays, selectedWeekDay, loading, processedList, getPageTitle, selectedItem, menuItem, toastMsg, openModal, openMenu, performAction, getPoster, getBackdrop, formatSubtitle, formatDuration, formatScheduleInfo, formatCapsuleRight, formatTraktStats, getRelativeDateLabel, formatVotes, isLoggedIn, logout, handleMineClick, showLogoutModal, backgroundPosters };
    }
}).mount('#app-container');
</script>
</body>
</html>
`;
