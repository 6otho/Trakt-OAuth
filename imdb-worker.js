/**
 * ==============================================================================
 * Cloudflare Worker 追番列表 (V39: 终极防屏蔽架构 - 全面转为客户端直连)
 * 彻底解决 Trakt Error 1015 (Cloudflare 机房 IP 被官方封锁的问题)
 * ==============================================================================
 */

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const path = url.pathname;

        // 基础配置检查
        if (!env.TRAKT_ID || !env.TRAKT_SECRET || !env.TMDB_TOKEN) {
            return new Response("Error: 请在后台配置 TRAKT_ID, TRAKT_SECRET 和 TMDB_TOKEN", { status: 500 });
        }

        // 🔐 1. OAuth 认证流程 (获取 Code 重定向)
        if (path === '/auth/login') {
            const redirectUri = `${url.origin}/auth/callback`;
            const traktUrl = `https://trakt.tv/oauth/authorize?response_type=code&client_id=${env.TRAKT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}`;
            return Response.redirect(traktUrl, 302);
        }

        // 🔐 2. OAuth Callback (转移到前端浏览器进行 Token 交换，避开 1015 拦截)
        if (path === '/auth/callback') {
            const code = url.searchParams.get('code');
            if (!code) return new Response("Login Failed: No Code provided", { status: 400 });

            const callbackHtml = `
            <!DOCTYPE html>
            <html lang="zh-CN"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head>
            <body style="background:#111;color:#fff;text-align:center;padding:50px;font-family:sans-serif;">
            <h3>🔄 正在获取授权...</h3>
            <script>
                async function getToken() {
                    try {
                        const res = await fetch('https://api.trakt.tv/oauth/token', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                code: '${code}',
                                client_id: '${env.TRAKT_ID}',
                                client_secret: '${env.TRAKT_SECRET}',
                                redirect_uri: '${url.origin}/auth/callback',
                                grant_type: 'authorization_code'
                            })
                        });
                        const data = await res.json();
                        if(data.access_token) {
                            localStorage.setItem('trakt_token', data.access_token);
                            localStorage.setItem('trakt_refresh', data.refresh_token);
                            document.body.innerHTML = "<h3>✅ 登录成功，正在跳转...</h3>";
                            setTimeout(function(){ window.location.href = '/'; }, 300);
                        } else {
                            document.body.innerHTML = "<h3>❌ 授权失败</h3><p>" + (data.error_description || JSON.stringify(data)) + "</p><button onclick='window.location.href=\"/\"' style='padding:10px 20px;border-radius:20px;background:#fff;color:#000;'>返回首页</button>";
                        }
                    } catch(e) {
                        document.body.innerHTML = "<h3>❌ 网络错误</h3><p>授权请求失败：" + e.message + "</p><button onclick='window.location.href=\"/\"' style='padding:10px 20px;border-radius:20px;background:#fff;color:#000;'>返回首页</button>";
                    }
                }
                getToken();
            </script>
            </body></html>`;
            return new Response(callbackHtml, { headers: { 'content-type': 'text/html;charset=UTF-8' } });
        }

        // 🚀 3. 主程序注入 (将环境变量安全注入给前端直接使用)
        const envScript = `<script>window.ENV = ${JSON.stringify({
            TRAKT_ID: env.TRAKT_ID,
            TMDB_TOKEN: env.TMDB_TOKEN
        })};</script>`;

        const finalHtml = htmlContent.replace('<!-- ENV_INJECTION -->', envScript);
        return new Response(finalHtml, { headers: { 'content-type': 'text/html;charset=UTF-8' } });
    },
};

// ================= 🎨 前端 Vue UI =================
const htmlContent = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
<title>Trakt追新</title>
<link rel="icon" type="image/png" href="https://trakt.tv/assets/logos/logomark.square.gradient-b644b16c38ff775861b4b1f58c1230f6a097a2466ab33ae00445a505c33fcb91.svg">
<!-- ENV_INJECTION -->
<script src="https://cdn.tailwindcss.com"></script>
<script src="https://unpkg.com/vue@3/dist/vue.global.js"></script>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
<link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700;900&display=swap" rel="stylesheet">
<style>
  :root { --bg-app: linear-gradient(135deg, #f0f2f5 0%, #d9e2ec 100%); --bg-desktop: #e0e5ec; --text-primary: #111; --text-secondary: #555; --text-tertiary: #666; --card-bg: #fff; --sheet-bg: #ffffff; --card-shadow: 0 8px 20px -6px rgba(0,0,0,0.08); --glass-header: rgba(240,242,245,0.85); --glass-nav: rgba(255,255,255,0.75); --glass-border: rgba(255,255,255,0.5); --accent-purple: #6D28D9; --pill-bg: rgba(255,255,255,0.6); --pill-active-text: #fff; --capsule-bg: rgba(0,0,0,0.06); --capsule-left-bg: #000; --capsule-left-text: #fff; --capsule-right-text: #000; --btn-bg: #111; --btn-text: #fff; --mask-gradient: linear-gradient(90deg, #EAECEF 28%, rgba(234,236,239,0.92) 55%, rgba(255,255,255,0.2) 100%); --overview-text: #222; --action-sheet-bg: rgba(255,255,255,0.85); }
  @media (prefers-color-scheme: dark) { :root { --bg-app: linear-gradient(135deg, #121212 0%, #1e1e24 100%); --bg-desktop: #000; --text-primary: #f5f5f5; --text-secondary: #a0a0a0; --text-tertiary: #888; --card-bg: #1e1e1e; --sheet-bg: #1e1e1e; --card-shadow: 0 8px 20px -6px rgba(0,0,0,0.4); --glass-header: rgba(18,18,18,0.85); --glass-nav: rgba(30,30,30,0.75); --glass-border: rgba(255,255,255,0.1); --accent-purple: #8b5cf6; --pill-bg: rgba(255,255,255,0.1); --pill-active-text: #fff; --capsule-bg: rgba(255,255,255,0.1); --capsule-left-bg: #f5f5f5; --capsule-left-text: #000; --capsule-right-text: #ddd; --btn-bg: #fff; --btn-text: #000; --mask-gradient: linear-gradient(90deg, #1e1e1e 28%, rgba(30,30,30,0.92) 55%, rgba(30,30,30,0.2) 100%); --overview-text: #fff; --action-sheet-bg: rgba(30,30,30,0.85); } }
  html, body { width: 100%; height: 100%; margin: 0; padding: 0; overflow: hidden; font-family: 'Roboto', sans-serif; background: var(--bg-app); -webkit-tap-highlight-color: transparent; overscroll-behavior: none; position: fixed; inset: 0; color: var(--text-primary); }
  #app-container { width: 100%; height: 100%; position: relative; display: flex; flex-direction: column; overflow: hidden; }
  @media (min-width: 768px) { body { background-color: var(--bg-desktop); display: flex; justify-content: center; align-items: center; position: static; } #app-container { width: 100%; max-width: 430px; height: 90vh; max-height: 880px; position: relative; border-radius: 44px; border: 8px solid #2a2a2a; box-shadow: 0 0 60px rgba(0,0,0,0.6); overflow: hidden; background: var(--bg-app); } }
  
  .top-glass-bar { position: absolute; top: 0; left: 0; right: 0; z-index: 20; background: var(--glass-header); backdrop-filter: blur(20px) saturate(180%); -webkit-backdrop-filter: blur(20px) saturate(180%); border-bottom: 1px solid var(--glass-border); padding-top: env(safe-area-inset-top); padding-bottom: 10px; }
  .header-nav { display: flex; align-items: center; padding: 8px 20px 4px 20px; justify-content: flex-start; gap: 15px; } 
  .page-header { padding: 0 20px; } 
  .sub-tabs { display: flex; gap: 8px; overflow-x: auto; padding: 0 20px 8px 20px; } 
  .week-grid-tabs { display: grid; grid-template-columns: repeat(7, 1fr); gap: 5px; padding: 0 20px 4px 20px; }
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
  
  /* ================= 🌟 全新大图横幅卡片样式 🌟 ================= */
  .anime-banner-card { position: relative; width: 100%; height: 130px; border-radius: 14px; background: #0a0b10; border: 1px solid rgba(255,255,255,0.08); overflow: hidden; display: flex; align-items: center; justify-content: space-between; box-shadow: 0 12px 24px rgba(0,0,0,0.4); transition: transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1), box-shadow 0.2s; cursor: pointer; color: #fff; margin-bottom: 4px; }
  .anime-banner-card:active { transform: scale(0.96); box-shadow: 0 5px 15px rgba(0,0,0,0.5); }
  .ab-bg { position: absolute; inset: 0; background-position: center 20%; background-size: cover; z-index: 0; opacity: 0.85; mask-image: linear-gradient(90deg, transparent 0%, rgba(0,0,0,0.8) 40%, rgba(0,0,0,0.9) 70%, transparent 100%); -webkit-mask-image: linear-gradient(90deg, transparent 5%, rgba(0,0,0,0.7) 40%, rgba(0,0,0,0.9) 65%, transparent 100%); }
  .ab-gradient { position: absolute; inset: 0; background: linear-gradient(90deg, rgba(10,11,16,1) 15%, rgba(10,11,16,0.2) 50%, rgba(10,11,16,0.85) 85%); z-index: 1; pointer-events: none; }
  
  .ab-content-left { position: relative; z-index: 2; display: flex; align-items: center; padding-left: 14px; height: 100%; width: 65%; pointer-events: none; }
  .ab-index { width: 22px; height: 22px; background: #fff; color: #000; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 900; font-size: 13px; margin-right: 14px; flex-shrink: 0; box-shadow: 0 4px 10px rgba(0,0,0,0.6); }
  .ab-text-col { display: flex; flex-direction: column; justify-content: center; align-items: flex-start; gap: 4px; overflow: hidden; }
  
  /* 🌟 核心修改：Logo和小白框强制统一最大宽度，精准对齐 🌟 */
  .ab-title-logo { max-width: 130px; height: 32px; object-fit: contain; object-position: left bottom; filter: drop-shadow(2px 2px 4px rgba(0,0,0,0.6)); margin-bottom: 2px; }
  .ab-cn-pill { background: #fff; color: #000; font-size: 11px; font-weight: 900; padding: 4px 8px; border-radius: 4px; display: inline-block; max-width: 130px; width: fit-content; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; box-shadow: 0 2px 5px rgba(0,0,0,0.3); margin-top: 2px; }

  .ab-eng-title { font-size: 12px; color: rgba(255,255,255,0.8); letter-spacing: 0.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-family: Georgia, 'Times New Roman', Times, serif; font-style: italic; }
  .ab-main-title { font-family: 'Arial Black', Impact, sans-serif; font-size: 24px; font-weight: 900; line-height: 1.1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-transform: uppercase; text-shadow: 2px 2px 6px rgba(0,0,0,0.9), 0 0 10px rgba(0,0,0,0.5); letter-spacing: -0.5px; }
  
  .ab-content-right { position: relative; z-index: 2; display: flex; flex-direction: column; align-items: flex-end; justify-content: center; padding-right: 18px; height: 100%; width: 35%; gap: 10px; pointer-events: none; }
  .ab-ep-pill { background: #fff; color: #000; font-size: 11px; font-weight: 900; padding: 4px 12px; border-radius: 6px; box-shadow: 0 4px 8px rgba(0,0,0,0.4); text-transform: uppercase; letter-spacing: 0.5px; }
  .ab-score-box { display: flex; align-items: center; }
  .ab-score-star { font-size: 16px; color: #FCD34D; margin-right: 6px; filter: drop-shadow(0 0 6px rgba(252,211,77,0.6)); margin-top: 5px; }
  .ab-score { font-size: 48px; font-weight: 900; font-family: 'Arial Black', Impact, sans-serif; line-height: 0.8; text-shadow: 3px 3px 10px rgba(0,0,0,0.6); color: #fff; letter-spacing: -2px; }
  
  .ab-more-btn { position: absolute; top: 10px; right: 10px; z-index: 10; color: rgba(255,255,255,0.4); padding: 5px; cursor: pointer; }
  .ab-progress-bar { position: absolute; bottom: 0; left: 0; right: 0; height: 3px; background: rgba(255,255,255,0.1); z-index: 3; }
  .ab-progress-fill { height: 100%; background: #fff; box-shadow: 0 0 8px rgba(255,255,255,0.8); }

  .bottom-nav { position: absolute; left: 50%; transform: translateX(-50%); width: 92%; max-width: 380px; height: 64px; background: var(--glass-nav); backdrop-filter: blur(25px) saturate(180%); -webkit-backdrop-filter: blur(25px) saturate(180%); border-radius: 99px; border: 1px solid var(--glass-border); box-shadow: 0 10px 25px rgba(0,0,0,0.12); display: flex; justify-content: space-evenly; align-items: center; z-index: 50; bottom: calc(10px + env(safe-area-inset-bottom)); }
  .nav-btn { display: flex; flex-direction: column; align-items: center; justify-content: center; color: var(--nav-icon-inactive); font-size: 10px; gap: 3px; width: 68px; height: 100%; transition: all 0.3s; font-weight: 600; }
  .nav-btn i { font-size: 26px; transition: transform 0.3s; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.05)); } 
  .nav-btn.active { color: var(--nav-icon-active); } .nav-btn.active i { transform: translateY(-3px) scale(1.1); color: var(--accent-purple); filter: drop-shadow(0 3px 6px rgba(109, 40, 217, 0.25)); }
  .nav-btn.active .user-avatar { border-color: var(--accent-purple); transform: translateY(-3px) scale(1.05); }
  .user-avatar { width: 28px; height: 28px; border-radius: 50%; background: #ccc; border: 2px solid transparent; transition: all 0.3s; box-shadow: 0 2px 5px rgba(0,0,0,0.15); object-fit: cover; }
  
  /* 🌟 核心修改：补充 var(--sheet-bg)，确保黑白模式字体底色不冲突 🌟 */
  .modal-overlay { position: absolute; inset: 0; z-index: 100; background: rgba(0,0,0,0.6); backdrop-filter: blur(8px); display: flex; align-items: flex-end; transition: opacity 0.3s; }
  .detail-sheet { width: 100%; max-height: 85%; background: var(--sheet-bg); color: var(--text-primary); border-radius: 32px 32px 0 0; padding-bottom: calc(30px + env(safe-area-inset-bottom)); box-shadow: 0 -10px 50px rgba(0,0,0,0.35); display: flex; flex-direction: column; overflow: hidden; animation: slideUp 0.4s cubic-bezier(0.19, 1, 0.22, 1); }
  @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
  .sheet-header { height: 240px; position: relative; flex-shrink: 0; }
  .sheet-backdrop { width: 100%; height: 100%; object-fit: cover; mask-image: linear-gradient(to bottom, black 60%, transparent 100%); -webkit-mask-image: linear-gradient(to bottom, black 60%, transparent 100%); }
  .sheet-close { position: absolute; top: 16px; right: 16px; width: 34px; height: 34px; border-radius: 50%; background: rgba(0,0,0,0.6); color: #fff; display: flex; justify-content: center; align-items: center; backdrop-filter: blur(15px); cursor: pointer; border: 1px solid rgba(255,255,255,0.2); }
  .sheet-body { padding: 0 24px 20px 24px; overflow-y: auto; margin-top: -40px; position: relative; z-index: 2; }
  .sheet-title { font-size: 28px; font-weight: 900; line-height: 1.1; margin-bottom: 16px; color: var(--text-primary); letter-spacing: -0.5px; }
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
            <!-- 🌟 全新的 Anime Banner 卡片结构 🌟 -->
            <div v-for="(item, index) in processedList" :key="item.id" class="anime-banner-card" @click="openModal(item)">
                <!-- 背景图与遮罩 -->
                <div class="ab-bg" :style="{ backgroundImage: 'url(' + getBackdrop(item) + ')' }"></div>
                <div class="ab-gradient"></div>
                
                <!-- 进度条(如果有) -->
                <div v-if="item.watch_progress > 0" class="ab-progress-bar">
                    <div class="ab-progress-fill" :style="{width: item.watch_progress + '%'}"></div>
                </div>

                <!-- 更多按钮 -->
                <div class="ab-more-btn" @click.stop="openMenu(item)">
                    <i class="fas fa-ellipsis-v"></i>
                </div>

                <!-- 左侧：序号与文本(或Logo) -->
                <div class="ab-content-left">
                    <div class="ab-index">{{ index + 1 }}</div>
                    
                    <div class="ab-text-col">
                        <!-- 🌟 有专属Logo则优先渲染Logo，统一与下方小白框左对齐 🌟 -->
                        <img v-if="item.show_logo" :src="getShowLogoUrl(item)" class="ab-title-logo" loading="lazy">
                        
                        <!-- 🌟 没有Logo时降级为显示原有文字标题 🌟 -->
                        <template v-else>
                            <div class="ab-eng-title">{{ getCardEngTitle(item) }}</div>
                            <div class="ab-main-title">{{ item.original_name || item.original_title || item.name || item.title }}</div>
                        </template>

                        <!-- 中文季数小标签 (保证与Logo尺寸完美对齐) -->
                        <div class="ab-cn-pill">{{ item.name || item.title }} {{ item.season_number ? ' 第'+item.season_number+'季' : '' }}</div>
                    </div>
                </div>

                <!-- 右侧：集数与超大评分 -->
                <div class="ab-content-right">
                    <div class="ab-ep-pill">{{ getCardEpInfo(item) }}</div>
                    <div class="ab-score-box">
                        <i class="fas fa-star ab-score-star"></i>
                        <span class="ab-score">{{ (item.vote_average || 0).toFixed(1) }}</span>
                    </div>
                </div>
            </div>
            <div v-if="processedList.length === 0" class="text-center py-20 text-gray-400 text-sm font-bold">暂时没有内容</div>
        </div>
    </div>
    <div class="bottom-nav">
        <div @click="switchMainTab('discover')" :class="['nav-btn', currentMainTab === 'discover' ? 'active' : '']"><i class="far fa-compass"></i><span>发现</span></div>
        <div @click="switchMainTab('schedule')" :class="['nav-btn', currentMainTab === 'schedule' ? 'active' : '']"><i class="far fa-calendar-alt"></i><span>新番</span></div>
        <div @click="handleMineClick" :class="['nav-btn', currentMainTab === 'mine' ? 'active' : '']"><img :src="userAvatar || 'https://ui-avatars.com/api/?name=Me&background=random&color=fff'" class="user-avatar" @error="handleAvatarError"><span>我的</span></div>
    </div>

    <!-- 🌟 修复黑白模式的详情弹窗 🌟 -->
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
        const fetchId = ref(0);
        const userAvatar = ref('');

        // 🟢 动态获取正确的 Trakt & TMDB 请求头
        const getTraktHeaders = () => {
            const token = localStorage.getItem('trakt_token');
            const h = { 'Content-Type': 'application/json', 'trakt-api-version': '2', 'trakt-api-key': window.ENV.TRAKT_ID };
            if (token) h['Authorization'] = 'Bearer ' + token;
            return h;
        };
        const getTmdbHeaders = () => {
            return { 'Authorization': 'Bearer ' + window.ENV.TMDB_TOKEN };
        };

        onMounted(() => {
            const token = localStorage.getItem('trakt_token');
            const savedAvatar = localStorage.getItem('trakt_avatar');
            if(savedAvatar) userAvatar.value = savedAvatar;
            
            if (token) {
                isLoggedIn.value = true;
                fetchData();
                fetchProfile();
            } else {
                fetchBackdrop();
            }
        });

        // ================= 数据获取逻辑 (纯前端请求，无视 Cloudflare 拦截) =================
        const fetchBackdrop = async () => {
            try {
                const res = await fetch('https://api.trakt.tv/movies/trending?limit=30', { headers: getTraktHeaders() });
                if(!res.ok) return;
                const items = await res.json();
                const posters = await Promise.all(items.map(async (item) => {
                    const tmdbId = item.movie && item.movie.ids ? item.movie.ids.tmdb : null;
                    if(!tmdbId) return null;
                    try {
                        const tmdbRes = await fetch('https://api.themoviedb.org/3/movie/' + tmdbId + '?language=en-US', { headers: getTmdbHeaders() });
                        const d = await tmdbRes.json();
                        return d.poster_path ? 'https://image.tmdb.org/t/p/w342' + d.poster_path : null;
                    } catch { return null; }
                }));
                backgroundPosters.value = posters.filter(p => p !== null);
            } catch(e){}
        };
        
        const fetchProfile = async () => {
            try {
                const res = await fetch('https://api.trakt.tv/users/me?extended=full', { headers: getTraktHeaders() });
                if (res.status === 401) { logout(); return; }
                const data = await res.json();
                if(data.images && data.images.avatar && data.images.avatar.full) {
                    userAvatar.value = data.images.avatar.full;
                    localStorage.setItem('trakt_avatar', userAvatar.value);
                }
            } catch(e){}
        };

        const hydrateTrakt = async (items, typeOverride) => {
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
                    // 🌟 追加 append_to_response=images 拉取剧集专属 Logo 🌟
                    const r = await fetch('https://api.themoviedb.org/3/' + mediaType + '/' + tmdbId + '?language=zh-CN&append_to_response=images&include_image_language=en,zh,ja,null', { headers: getTmdbHeaders() });
                    if (!r.ok) return null;
                    const d = await r.json();

                    // 🌟 核心修改：针对外国剧强制要求英文 Logo 🌟
                    let showLogo = null;
                    if (d.images && d.images.logos && d.images.logos.length > 0) {
                        const zhLogo = d.images.logos.find(l => l.iso_639_1 === 'zh');
                        const enLogo = d.images.logos.find(l => l.iso_639_1 === 'en');
                        const jaLogo = d.images.logos.find(l => l.iso_639_1 === 'ja');
                        
                        const countries = d.origin_country || [];
                        if (countries.some(c => ['CN', 'TW', 'HK'].includes(c))) {
                            // 国产/港台剧：优先中文
                            showLogo = (zhLogo || enLogo || d.images.logos[0]).file_path;
                        } else if (countries.includes('JP')) {
                            // 日漫/日剧：优先日文或中文
                            showLogo = (jaLogo || zhLogo || enLogo || d.images.logos[0]).file_path;
                        } else {
                            // 外国剧（欧美韩等）：绝对优先英文
                            showLogo = (enLogo || zhLogo || d.images.logos[0]).file_path;
                        }
                    }

                    let episodeStill = null;
                    let currentProgress = null;
                    let specificRuntime = null;

                    if (mediaType === 'tv' && item.episode) {
                        try {
                            const epRes = await fetch('https://api.themoviedb.org/3/tv/' + tmdbId + '/season/' + item.episode.season + '/episode/' + item.episode.number + '?language=zh-CN', { headers: getTmdbHeaders() });
                            const epData = await epRes.json();
                            if(epData.still_path) episodeStill = epData.still_path;
                            if(epData.runtime) specificRuntime = epData.runtime;
                        } catch(err) {}
                    }
                    if (typeOverride === 'continue' && item.progress) currentProgress = item.progress;
                    
                    return Object.assign({}, d, { 
                        media_type: mediaType, trakt_type: typeOverride, air_time_iso: airTime, episode_info: item.episode, 
                        show_logo: showLogo, // 🌟 挂载 Logo 数据 🌟
                        origin_country: d.origin_country || [], genres: d.genres || [],
                        runtime_real: specificRuntime || d.runtime || (d.episode_run_time ? d.episode_run_time[0] : null),
                        episode_image: episodeStill, next_ep_date: d.next_episode_to_air ? d.next_episode_to_air.air_date : null,
                        last_ep_date: d.last_air_date, last_ep_info: d.last_episode_to_air,
                        total_seasons: d.number_of_seasons, total_episodes: d.number_of_episodes, status: d.status,
                        watch_progress: currentProgress, is_tracking: item.is_mine || false 
                    }); 
                } catch { return null; }
            });
            const resolved = await Promise.all(promises);
            return resolved.filter(i => i !== null);
        };

        let fetchTimeout = null;
        const fetchData = () => {
            if(!isLoggedIn.value) return;
            if(fetchTimeout) clearTimeout(fetchTimeout);
            fetchTimeout = setTimeout(async () => {
                fetchId.value++;
                const currentReqId = fetchId.value;
                loading.value = true; rawData.value = [];
                
                try {
                    let rawList = [];
                    let overrideType = currentSubTab.value;
                    const h = getTraktHeaders();
                    
                    if(currentSubTab.value === 'continue') {
                        const res = await fetch('https://api.trakt.tv/sync/playback?limit=50', { headers: h });
                        if(res.status === 401) { logout(); return; }
                        const data = await res.json();
                        const seen = new Set();
                        for (const item of data) {
                            const id = item.show && item.show.ids ? item.show.ids.trakt : (item.movie && item.movie.ids ? item.movie.ids.trakt : item.id);
                            if (id && !seen.has(id)) { seen.add(id); rawList.push(item); }
                        }
                    } else if(currentSubTab.value === 'chase') {
                        const res = await fetch('https://api.trakt.tv/sync/watchlist?sort=added,desc', { headers: h });
                        if(res.status === 401) { logout(); return; }
                        rawList = await res.json();
                    } else if(currentSubTab.value === 'myschedule') {
                        const today = new Date().toISOString().split('T')[0];
                        const res = await fetch('https://api.trakt.tv/calendars/my/shows/' + today + '/14', { headers: h });
                        if(res.status === 401) { logout(); return; }
                        rawList = await res.json();
                    } else if(currentSubTab.value === 'trakt_fav') {
                        const [resShows, resMovies] = await Promise.all([
                            fetch('https://api.trakt.tv/users/me/favorites/shows', { headers: h }),
                            fetch('https://api.trakt.tv/users/me/favorites/movies', { headers: h })
                        ]);
                        let shows = resShows.ok ? await resShows.json() : [];
                        let movies = resMovies.ok ? await resMovies.json() : [];
                        let allItems = shows.concat(movies);
                        allItems.sort((a, b) => new Date(b.liked_at || 0).getTime() - new Date(a.liked_at || 0).getTime());
                        rawList = allItems.slice(0, 50);
                    } else if(currentSubTab.value === 'fav_all') {
                        const accRes = await fetch('https://api.themoviedb.org/3/account', { headers: getTmdbHeaders() });
                        const acc = await accRes.json();
                        const tvRes = await fetch('https://api.themoviedb.org/3/account/' + acc.id + '/favorite/tv?language=zh-CN&sort_by=created_at.desc', { headers: getTmdbHeaders() });
                        const tv = await tvRes.json();
                        rawList = tv.results.map(i => Object.assign({}, i, { media_type: 'tv' }));
                    } else if(currentSubTab.value === 'schedule') {
                        const today = new Date().toISOString().split('T')[0];
                        const [myRes, pubRes] = await Promise.all([
                            fetch('https://api.trakt.tv/calendars/my/shows/' + today + '/7', { headers: h }),
                            fetch('https://api.trakt.tv/calendars/all/shows/' + today + '/7?extended=full', { headers: h })
                        ]);
                        let myData = myRes.ok ? await myRes.json() : [];
                        let pubData = pubRes.ok ? await pubRes.json() : [];
                        const seenIds = new Set();
                        for(let i of myData) { if(i.show && i.show.ids && !seenIds.has(i.show.ids.trakt)) { seenIds.add(i.show.ids.trakt); rawList.push(Object.assign({}, i, {is_mine:true})); }}
                        const pubAnime = pubData.filter(i => (i.show && i.show.country === 'jp') && (i.show.genres && (i.show.genres.includes('anime') || i.show.genres.includes('animation'))));
                        for(let i of pubAnime) { if(i.show && i.show.ids && !seenIds.has(i.show.ids.trakt)) { seenIds.add(i.show.ids.trakt); rawList.push(i); }}
                    } else if(currentSubTab.value === 'trakt_hot') {
                        const res = await fetch('https://api.trakt.tv/shows/trending?limit=15', { headers: h });
                        rawList = res.ok ? await res.json() : [];
                    } else if(currentSubTab.value === 'hot') {
                        const r = await fetch('https://api.themoviedb.org/3/trending/all/week?language=zh-CN', { headers: getTmdbHeaders() });
                        if(r.ok) {
                            const data = await r.json();
                            if(currentReqId === fetchId.value) rawData.value = data.results;
                        }
                    }

                    if (currentSubTab.value !== 'hot') {
                        const detailed = await hydrateTrakt(rawList, overrideType);
                        if (currentReqId === fetchId.value) rawData.value = detailed;
                    }
                } catch(e) { console.error(e); } finally { 
                    if (currentReqId === fetchId.value) loading.value = false; 
                }
            }, 50);
        };

        const performAction = async (action, item) => {
            menuItem.value = null; selectedItem.value = null; showToast("正在提交...");
            try {
                let endpoint = '';
                let payload = {};
                const mediaObject = { ids: { tmdb: item.id } };
                if (item.media_type === 'movie') payload = { movies: [mediaObject] };
                else payload = { shows: [mediaObject] };

                if (action === 'add_chase') endpoint = 'sync/watchlist';         
                else if (action === 'remove_chase') endpoint = 'sync/watchlist/remove'; 
                else if (action === 'add_history') endpoint = 'sync/history';    
                else if (action === 'add_collection') endpoint = 'sync/collection';         
                else if (action === 'remove_collection') endpoint = 'sync/collection/remove';

                const res = await fetch('https://api.trakt.tv/' + endpoint, {
                    method: 'POST', 
                    headers: getTraktHeaders(),
                    body: JSON.stringify(payload)
                });
                if(!res.ok) throw new Error("失败");
                const map = { 'add_chase': '🔖 已加入追番', 'remove_chase': '🗑️ 已取消追番', 'add_history': '🎉 标记为已看', 'add_collection': '❤️ 已收藏', 'remove_collection': '💔 已取消收藏'};
                showToast(map[action] || '操作成功');
                setTimeout(fetchData, 1000);
            } catch(e) { showToast("❌ 操作失败"); }
        };

        const handleAvatarError = (e) => { e.target.src = 'https://ui-avatars.com/api/?name=Me&background=random&color=fff'; };
        const logout = () => { localStorage.removeItem('trakt_token'); localStorage.removeItem('trakt_avatar'); isLoggedIn.value = false; showLogoutModal.value = false; rawData.value = []; userAvatar.value = ''; fetchBackdrop(); };
        const showToast = (msg) => { toastMsg.value = msg; setTimeout(() => { toastMsg.value = ''; }, 2500); };
        
        const subTabs = computed(() => {
            if (currentMainTab.value === 'mine') return [ { key: 'continue', name: '继续观看' }, { key: 'chase', name: '我的追番' }, { key: 'myschedule', name: '即将播出' }, { key: 'trakt_fav', name: 'Trakt红心' } ]; 
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

        const switchMainTab = (tab) => { currentMainTab.value = tab; if(tab === 'mine') currentSubTab.value = 'continue'; else if(tab === 'schedule') currentSubTab.value = 'schedule'; else currentSubTab.value = 'trakt_hot'; };
        const handleMineClick = () => { const now = Date.now(); if (currentMainTab.value === 'mine' && (now - lastMineClickTime.value < 300)) { showLogoutModal.value = true; } else { switchMainTab('mine'); } lastMineClickTime.value = now; };

        watch([currentSubTab, selectedWeekDay], () => { if(currentMainTab.value !== 'schedule') fetchData(); });
        watch(currentMainTab, () => { fetchData(); })

        // ================= 🌟 卡片专属格式化函数 🌟 =================
        const getCardEngTitle = (item) => {
            if (item.status === 'Returning Series') return 'Returning Series';
            if (item.original_name) return item.original_name;
            if (item.original_title) return item.original_title;
            return 'TV Series';
        };

        const getCardEpInfo = (item) => {
            if (item.media_type === 'movie') return 'Movie';
            if (item.episode_info) {
                return 'S' + item.episode_info.season + ' Episode ' + item.episode_info.number;
            }
            if (item.next_ep_date) return 'Airing';
            if (item.status === 'Ended') return 'Ended';
            return 'Series';
        };

        // 🌟 新增：获取剧集专属 Logo 🌟
        const getShowLogoUrl = (item) => {
            if (item.show_logo) {
                return TMDB_IMG + 'w300' + item.show_logo; // 使用 300px 宽度的高清小图，保证 Logo 清晰
            }
            return null;
        };
        
        const formatSubtitle = (item) => { if (item.episode_info) return 'S' + item.episode_info.season + ' E' + item.episode_info.number; if (item.total_episodes) return '共 ' + item.total_episodes + ' 集'; return item.original_name || item.title || 'Movie'; };
        const formatDuration = (item) => { let t = item.runtime_real; if (!t && item.media_type === 'tv') { const isAnime = (item.origin_country && item.origin_country.includes('JP')) || (item.genres && item.genres.some(g => g.name === 'Animation' || g.name === '动画')); t = isAnime ? 24 : 45; } if (!t || t === 0) return '未知'; return t + '分钟'; };
        const formatTraktStats = (item) => { if (item.media_type === 'movie') return 'Movie'; let total = item.total_episodes || 0; let current = item.episode_info ? item.episode_info.number : 0; let remaining = Math.max(0, total - current); if (item.status === 'Ended' && remaining <= 0) return '已完结'; let runtimeStr = formatDuration(item); let runtime = parseInt(runtimeStr) || 24; let minsLeft = remaining * runtime; let timeStr = minsLeft > 60 ? Math.floor(minsLeft/60) + '小时 ' + (minsLeft%60) + '分' : minsLeft + '分钟'; return '剩余' + remaining + '集 · ' + timeStr; };
        const formatScheduleInfo = (item) => { if (item.watch_progress) return '已看 ' + parseFloat(item.watch_progress).toFixed(1) + '%'; if (item.status === 'Returning Series' && item.next_ep_date) { const day = new Date(item.next_ep_date).getDay(); const weekStr = ['日','一','二','三','四','五','六'][day]; return '每周' + weekStr + '更新'; } if (item.status === 'Ended' && item.first_air_date && item.last_ep_date) { const start = item.first_air_date.slice(0,4); const end = item.last_ep_date.slice(0,4); return start + ' - ' + end; } if(item.release_date) return item.release_date; if(item.first_air_date) return '首播: ' + item.first_air_date; return '未知日程'; };
        const formatCapsuleRight = (item) => { if (item.media_type === 'movie') { return item.release_date ? item.release_date.split('-')[0] : '电影'; } const total = item.total_episodes || 0; const lastEp = item.last_ep_info; const current = lastEp ? lastEp.episode_number : 0; if (total > 0) { if (item.status === 'Ended' || item.status === 'Canceled') return total + '集全'; if (current > 0) return current + '/' + total + '集'; return '共' + total + '集'; } if (item.status === 'Returning Series') return '更新中'; if (item.status === 'Ended') return '已完结'; return 'TV Series'; };
        const getRelativeDateLabel = (item) => { const dateStr = item.air_time_iso || item.first_air_date; if (!dateStr) return ''; const targetDate = new Date(dateStr); const today = new Date(); today.setHours(0,0,0,0); const targetCheck = new Date(targetDate); targetCheck.setHours(0,0,0,0); const diffTime = targetCheck - today; const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); if (diffDays === 0) return '今天'; if (diffDays === 1) return '明天'; if (diffDays === 2) return '后天'; const weekStr = ['周日','周一','周二','周三','周四','周五','周六'][targetDate.getDay()]; if (Math.abs(diffDays) > 7) return (targetDate.getMonth()+1) + '/' + targetDate.getDate(); return weekStr; };
        const formatVotes = (num) => { if(!num) return '0'; if(num > 1000) return (num/1000).toFixed(1) + 'k'; return num; };
        const getPoster = (i) => i.poster_path ? TMDB_IMG + 'w200' + i.poster_path : 'https://via.placeholder.com/200x300/e0e0e0/ffffff?text=No+Poster';
        const getBackdrop = (i) => { if (i.episode_image) return TMDB_IMG + 'w780' + i.episode_image; if (i.backdrop_path) return TMDB_IMG + 'w780' + i.backdrop_path; return 'https://via.placeholder.com/600x340/e0e0e0/ffffff?text=TMDB&Trakt'; };
        const openModal = (item) => { selectedItem.value = item; };
        const openMenu = (item) => { menuItem.value = item; };
        
        const getWatchedTime = (item) => {
            const totalMinutes = item.runtime_real || 0;
            const progress = item.watch_progress || 0;
            const totalWatchedSeconds = Math.floor(totalMinutes * 60 * (progress / 100));
            const h = Math.floor(totalWatchedSeconds / 3600);
            const m = Math.floor((totalWatchedSeconds % 3600) / 60);
            const s = totalWatchedSeconds % 60;
            const hStr = h.toString().padStart(2, '0');
            const mStr = m.toString().padStart(2, '0');
            const sStr = s.toString().padStart(2, '0');
            if (h > 0) return hStr + ':' + mStr + ':' + sStr;
            return mStr + ':' + sStr;
        };

        return { currentMainTab, switchMainTab, currentSubTab, subTabs, filterType, weekDays, selectedWeekDay, loading, processedList, getPageTitle, selectedItem, menuItem, toastMsg, openModal, openMenu, performAction, getPoster, getBackdrop, formatSubtitle, formatDuration, formatScheduleInfo, formatCapsuleRight, formatTraktStats, getRelativeDateLabel, formatVotes, isLoggedIn, logout, handleMineClick, showLogoutModal, backgroundPosters, getWatchedTime, userAvatar, handleAvatarError, getCardEngTitle, getCardEpInfo, getShowLogoUrl };
    }
}).mount('#app-container');
</script>
</body>
</html>
`;
