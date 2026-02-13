# Trakt & TMDB 个人追番神器

这是一个运行在 Cloudflare Workers 上的轻量级 Serverless 追番 Web App。它结合 Trakt 的强大记录功能与 TMDB 的精美中文元数据，为你提供极速、无广告、隐私安全的个人追番体验。

![License](https://img.shields.io/badge/License-MIT-blue.svg)
![Platform](https://img.shields.io/badge/Platform-Cloudflare%20Workers-orange)

---

## ✨ 特性（Features）

* ⚡️ 极速体验：部署在 Cloudflare 边缘网络，秒开无延迟。
* 🔐 隐私安全：支持多用户 OAuth 登录，数据直接与 Trakt 官方接口交互，Token 仅保存在用户本地浏览器。
* 📱 移动优先：专为手机和平板设计的精美 UI，支持 PWA（添加到主屏幕）。
* 📅 追番日历：自动聚合“我的日历”和“当季热门”，不错过每一集更新。
* 🇨🇳 中文优化：Trakt 负责进度记录，TMDB 提供中文海报与简介，智能回落机制保证显示完整。
* ❤️ 完整交互：支持加入 / 取消 Watchlist、收藏（Collection / Favorite）、标记已看（History）。
* ♾️ 永久免费：依托 Cloudflare Workers 免费额度，个人使用永久免费。

---

## 🛠️ 部署前准备（Prerequisites）

在开始之前，请准备以下三个账号（均为免费注册）：

1. Cloudflare 账号：用于部署 Worker。
2. Trakt 账号：用于申请 API 权限与同步观看数据。
3. TMDB 账号：用于获取图片与中文元数据。

---

## 🚀 部署教程（完整流程）

### 一、获取 TMDB API Token

1. 登录 TMDB 官网。
2. 前往：账户设置 → API。
3. 申请新的 API Key（类型选择 Developer）。
4. 在 API 页面中找到：

   API Read Access Token

⚠️ 注意：

* 必须使用“API Read Access Token”（很长的一串字符）
* 不是短的 API Key
* 稍后将作为环境变量：`TMDB_TOKEN`

---

### 二、创建 Cloudflare Worker

1. 登录 Cloudflare Dashboard。
2. 进入：Workers & Pages。
3. 点击 “Create Application” → “Create Worker”。
4. 命名你的项目（例如：trakt），点击 Deploy。
5. 部署完成后点击 “Edit code”。
6. 清空编辑器中的默认代码。
7. 将本项目的 `worker.js` 代码全部复制并粘贴进去。
8. 点击右上角 “Deploy” 保存。

完成后，请记下你的 Worker 域名，格式通常为：

```
https://trakt.你的用户名.workers.dev
```

后续配置会使用该地址。

---

### 三、申请 Trakt API 权限

1. 访问 Trakt API Applications 页面。

2. 点击 “New Application”。

3. 填写信息：

   * Name：任意（例如 MyReflix）

   * Redirect URIs：

     必须填写：

     ```
     你的Worker域名/auth/callback
     ```

     示例：

     ```
     https://reflix.zhangsan.workers.dev/auth/callback
     ```

   * Javascript (CORS) origins：填写你的 Worker 域名（不带路径）

     示例：

     ```
     https://reflix.zhangsan.workers.dev
     ```

4. 点击 “Save App”。

5. 保存成功后，页面顶部会显示：

   * Client ID
   * Client Secret

请复制这两个值，下一步需要使用。

---

### 四、配置环境变量（Config Variables）

回到 Cloudflare Worker 控制台：

1. 打开你的 Worker 项目。
2. 进入：Settings → Variables。
3. 在 Environment Variables 区域点击 “Add variable”。
4. 添加以下三个变量：

| 变量名          | 值                      | 说明                  |
| ------------ | ---------------------- | ------------------- |
| TRAKT_ID     | Trakt Client ID        | 来自 Trakt 应用后台       |
| TRAKT_SECRET | Trakt Client Secret    | 来自 Trakt 应用后台（建议加密） |
| TMDB_TOKEN   | TMDB Read Access Token | 来自 TMDB API 页面      |

5. 点击 “Save and Deploy”。

至此部署完成。

---

## 📱 使用指南（User Guide）

1. 在浏览器中访问你的 Worker 域名。
2. 页面会显示动态海报墙的登录界面。
3. 点击 “Connect Trakt”。
4. 跳转到 Trakt 官方授权页面。
5. 点击 “Yes, Allow”。
6. 自动跳回你的网站。

🎉 恭喜！现在你可以开始管理你的追番列表。

---

## 💡 小技巧

### 添加到主屏幕

* iOS Safari：点击分享 → 添加到主屏幕
* Android Chrome：点击菜单 → 添加到主屏幕

即可获得类似原生 App 的全屏体验。

### 双击退出登录

在底部“我的”图标上双击，可弹出退出登录选项。

### 登录有效期

* Trakt 登录有效期约为 3 个月。
* 若出现 401 或加载失败提示，只需重新点击连接，无需重新部署。

---

## ❓ 常见问题（FAQ）

### 登录后提示 “Redirect URI mismatch”

请检查：

* Redirect URI 是否与你访问的域名完全一致
* 必须包含 `https://`
* 结尾必须为 `/auth/callback`

---

### 为什么海报显示英文？

程序优先尝试获取 TMDB 中文元数据。
如果 TMDB 没有该条目的中文翻译，则会自动回落为英文或原名。

---

### 多人使用会串号吗？

不会。

V30+ 版本已重构鉴权逻辑：

* Token 存储在用户本地浏览器
* 服务器仅作为转发代理

因此支持多人同时使用，并保护各自隐私。

---

## 📄 免责声明

本项目仅供学习与交流使用。

所有数据来源于 Trakt 与 TMDB，请遵守相关 API 使用条款。
本项目不提供任何视频资源。

---

Enjoy your shows! 🍿
