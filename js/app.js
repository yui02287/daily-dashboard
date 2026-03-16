/* ====================================================
   每日任務板 — app.js
   架構：StateManager → GamificationEngine → TodoManager
         → CalendarClient → WeatherWidget → UIRenderer
         → DashboardApp (協調者)
   ==================================================== */

'use strict';

/* ---------- 設定（由 localStorage 讀取，不硬寫在程式碼中） ---------- */
const CONFIG = {
  get OPENWEATHER_API_KEY() { return localStorage.getItem('ddash_owm_key') || ''; },
  get GOOGLE_CLIENT_ID()    { return localStorage.getItem('ddash_gcal_client_id') || ''; },
  WEATHER_LANG:  'zh_tw',
  WEATHER_UNITS: 'metric',
};

/* =====================================================
   1. StateManager — localStorage 讀寫
   ===================================================== */
class StateManager {
  constructor() {
    this.KEYS = {
      MANUAL_TODOS: 'ddash_manual_todos',
      COMPLETIONS: 'ddash_completions',
      XP: 'ddash_xp',
      STREAK: 'ddash_streak',
      ACHIEVEMENTS: 'ddash_achievements',
      GCAL_TOKEN: 'ddash_gcal_token',
      CONTENT_ADDITIONS: 'ddash_content_additions',
    };
  }

  _read(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v !== null ? JSON.parse(v) : fallback;
    } catch { return fallback; }
  }

  _write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { console.warn('localStorage write failed', e); }
  }

  getManualTodos() { return this._read(this.KEYS.MANUAL_TODOS, []); }
  saveManualTodos(todos) { this._write(this.KEYS.MANUAL_TODOS, todos); }

  getCompletions() { return this._read(this.KEYS.COMPLETIONS, {}); }
  saveCompletions(completions) { this._write(this.KEYS.COMPLETIONS, completions); }

  getXP() { return this._read(this.KEYS.XP, 0); }
  saveXP(xp) { this._write(this.KEYS.XP, xp); }

  getStreak() { return this._read(this.KEYS.STREAK, { current: 0, longest: 0, lastActiveDate: null }); }
  saveStreak(streak) { this._write(this.KEYS.STREAK, streak); }

  getAchievements() { return this._read(this.KEYS.ACHIEVEMENTS, []); }
  saveAchievements(list) { this._write(this.KEYS.ACHIEVEMENTS, list); }

  getGCalToken() { return this._read(this.KEYS.GCAL_TOKEN, null); }
  saveGCalToken(token) { this._write(this.KEYS.GCAL_TOKEN, token); }

  getContentAdditions() { return this._read(this.KEYS.CONTENT_ADDITIONS, []); }
  saveContentAdditions(list) { this._write(this.KEYS.CONTENT_ADDITIONS, list); }
}

/* =====================================================
   2. GamificationEngine — 積分、等級、成就、連續天數
   ===================================================== */
class GamificationEngine {
  constructor(stateManager) {
    this.state = stateManager;
    this.LEVEL_THRESHOLDS = [0, 100, 300, 600, 1000, 1500, 2100, 2800, 3600, 4500];
    this.PRIORITY_POINTS = { High: 20, Medium: 15, Low: 10 };
    this.STREAK_BONUS = 5;

    this.ACHIEVEMENTS = [
      { id: 'first_todo', icon: '🌱', name: '第一步', desc: '完成第一個代辦', check: (s) => s.totalCompleted >= 1 },
      { id: 'early_bird', icon: '🐦', name: '早起鳥', desc: '中午前完成任一代辦', check: (s) => s.completedBeforeNoon >= 1 },
      { id: 'streak_7', icon: '🔥', name: '週連勝', desc: '連續七天有完成代辦', check: (s) => s.streak.current >= 7 },
      { id: 'streak_30', icon: '⚡', name: '無法阻擋', desc: '連續三十天有完成代辦', check: (s) => s.streak.current >= 30 },
      { id: 'perfect_day', icon: '💯', name: '完美一天', desc: '當日代辦全部完成', check: (s) => s.dailyPct >= 100 && s.totalActive > 0 },
      { id: 'video_5', icon: '🎬', name: '內容創作者', desc: '影片題材累計完成五支', check: (s) => s.videosDone >= 5 },
      { id: 'video_20', icon: '🏆', name: '頻道主力', desc: '影片題材累計完成二十支', check: (s) => s.videosDone >= 20 },
    ];
  }

  getLevel(xp) {
    let level = 1;
    for (let i = this.LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
      if (xp >= this.LEVEL_THRESHOLDS[i]) { level = i + 1; break; }
    }
    return level;
  }

  getLevelProgress(xp) {
    const level = this.getLevel(xp);
    const current = this.LEVEL_THRESHOLDS[level - 1];
    const next = this.LEVEL_THRESHOLDS[level] ?? null;
    if (next === null) return { level, current: xp, next: null, pct: 100 };
    const pct = Math.min(100, Math.round((xp - current) / (next - current) * 100));
    return { level, current: xp - current, next: next - current, pct };
  }

  awardPoints(todo) {
    const base = this.PRIORITY_POINTS[todo.priority] ?? 15;
    const streak = this.state.getStreak();
    const bonus = streak.current > 0 ? this.STREAK_BONUS : 0;
    const total = base + bonus;
    const xp = this.state.getXP() + total;
    this.state.saveXP(xp);
    return total;
  }

  deductPoints(todo) {
    const base = this.PRIORITY_POINTS[todo.priority] ?? 15;
    const xp = Math.max(0, this.state.getXP() - base);
    this.state.saveXP(xp);
  }

  updateStreak() {
    const today = this._todayStr();
    const streak = this.state.getStreak();
    if (streak.lastActiveDate === today) return; // 今天已更新過

    const yesterday = this._offsetDay(-1);
    if (streak.lastActiveDate === yesterday) {
      streak.current += 1;
    } else if (streak.lastActiveDate !== today) {
      streak.current = 1;
    }
    streak.longest = Math.max(streak.longest, streak.current);
    streak.lastActiveDate = today;
    this.state.saveStreak(streak);
  }

  checkAchievements(statsSnapshot) {
    const earned = new Set(this.state.getAchievements());
    const newOnes = [];
    for (const ach of this.ACHIEVEMENTS) {
      if (!earned.has(ach.id) && ach.check(statsSnapshot)) {
        earned.add(ach.id);
        newOnes.push(ach);
      }
    }
    if (newOnes.length) this.state.saveAchievements([...earned]);
    return newOnes;
  }

  _todayStr() {
    return new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD
  }
  _offsetDay(n) {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return d.toLocaleDateString('sv-SE');
  }
}

/* =====================================================
   3. TodoManager — 合併代辦來源、CRUD
   ===================================================== */
class TodoManager {
  constructor(stateManager, gamificationEngine) {
    this.state = stateManager;
    this.gamify = gamificationEngine;
    this._dailyData = null;
  }

  async loadDailyData() {
    try {
      const res = await fetch('./data/daily.json?v=' + Date.now());
      if (!res.ok) throw new Error('HTTP ' + res.status);
      this._dailyData = await res.json();
    } catch (e) {
      console.warn('Failed to load daily.json:', e);
      this._dailyData = { notion_todos: [], notion_content: [], rss_news: [], meta: { date: '' } };
    }
    return this._dailyData;
  }

  getDailyData() { return this._dailyData; }

  mergeAllTodos(gcalEvents = []) {
    const completions = this.state.getCompletions();
    const manualTodos = this.state.getManualTodos();
    const notionTodos = this._dailyData?.notion_todos ?? [];

    const all = [];

    // Notion todos
    for (const t of notionTodos) {
      all.push({
        id: 'notion_' + t.id,
        source: 'notion',
        name: t.name,
        dueDate: t.due_date || null,
        priority: t.priority || 'Medium',
        category: t.category || '',
        points: t.points || 15,
        notes: t.notes || '',
        completed: !!completions['notion_' + t.id],
        completedAt: completions['notion_' + t.id]?.completedAt || null,
      });
    }

    // Google Calendar events
    for (const ev of gcalEvents) {
      all.push({
        id: 'gcal_' + ev.id,
        source: 'gcal',
        name: ev.name,
        dueDate: ev.dueDate || null,
        priority: 'Medium',
        category: '行程',
        points: 15,
        notes: ev.notes || '',
        completed: !!completions['gcal_' + ev.id],
        completedAt: completions['gcal_' + ev.id]?.completedAt || null,
      });
    }

    // Manual todos
    for (const t of manualTodos) {
      all.push({
        ...t,
        completed: !!completions[t.id],
        completedAt: completions[t.id]?.completedAt || null,
      });
    }

    return all;
  }

  addManualTodo(name, deadline, priority) {
    const todos = this.state.getManualTodos();
    const id = 'manual_' + Date.now();
    todos.push({ id, source: 'manual', name, dueDate: deadline || null, priority: priority || 'Medium', category: '', points: this.gamify.PRIORITY_POINTS[priority] ?? 15, notes: '' });
    this.state.saveManualTodos(todos);
    return id;
  }

  removeManualTodo(id) {
    const todos = this.state.getManualTodos().filter(t => t.id !== id);
    this.state.saveManualTodos(todos);
    // remove completions
    const completions = this.state.getCompletions();
    delete completions[id];
    this.state.saveCompletions(completions);
  }

  completeTodo(todo) {
    const completions = this.state.getCompletions();
    if (completions[todo.id]) return 0; // 已完成
    const pts = this.gamify.awardPoints(todo);
    completions[todo.id] = { completedAt: new Date().toISOString(), pointsAwarded: pts };
    this.state.saveCompletions(completions);
    this.gamify.updateStreak();
    return pts;
  }

  uncompleteTodo(todo) {
    const completions = this.state.getCompletions();
    if (!completions[todo.id]) return;
    this.gamify.deductPoints(todo);
    delete completions[todo.id];
    this.state.saveCompletions(completions);
  }

  getActiveTodos(allTodos) { return allTodos.filter(t => !t.completed); }
  getCompletedTodos(allTodos) { return allTodos.filter(t => t.completed); }

  // Content/Video topics
  mergeContentItems() {
    const notionContent = this._dailyData?.notion_content ?? [];
    const manualContent = this.state.getContentAdditions();
    const all = [];
    for (const c of notionContent) {
      all.push({ id: 'notion_c_' + c.id, source: 'notion', topic: c.topic, status: c.status, plannedDate: c.planned_date, platform: c.platform, tags: c.tags || [], notes: c.notes || '' });
    }
    for (const c of manualContent) {
      all.push(c);
    }
    return all;
  }

  addContentItem(topic, date, platform) {
    const list = this.state.getContentAdditions();
    const id = 'manual_c_' + Date.now();
    list.push({ id, source: 'manual', topic, status: '構思中', plannedDate: date || null, platform: platform || 'YouTube', tags: [], notes: '' });
    this.state.saveContentAdditions(list);
    return id;
  }

  removeContentItem(id) {
    const list = this.state.getContentAdditions().filter(c => c.id !== id);
    this.state.saveContentAdditions(list);
  }

  markContentDone(id) {
    const list = this.state.getContentAdditions().map(c => c.id === id ? { ...c, status: '已發布' } : c);
    this.state.saveContentAdditions(list);
  }
}

/* =====================================================
   4. CalendarClient — Google Calendar OAuth
   ===================================================== */
class CalendarClient {
  constructor(stateManager) {
    this.state = stateManager;
    this._client = null;
    this._connected = false;
  }

  isReady() {
    return typeof google !== 'undefined' && typeof google.accounts !== 'undefined';
  }

  isConnected() { return this._connected; }

  init() {
    if (!this.isReady() || !CONFIG.GOOGLE_CLIENT_ID) return;
    const saved = this.state.getGCalToken();
    if (saved && new Date(saved.expiry) > new Date()) {
      this._connected = true;
      this._token = saved.access_token;
    }
  }

  authorize() {
    return new Promise((resolve, reject) => {
      if (!this.isReady()) return reject(new Error('GIS 未載入'));
      this._client = google.accounts.oauth2.initTokenClient({
        client_id: CONFIG.GOOGLE_CLIENT_ID,
        scope: 'https://www.googleapis.com/auth/calendar.readonly',
        callback: (resp) => {
          if (resp.error) return reject(resp);
          this._token = resp.access_token;
          this._connected = true;
          // 快取 token（55 分鐘）
          const expiry = new Date(Date.now() + 55 * 60 * 1000).toISOString();
          this.state.saveGCalToken({ access_token: resp.access_token, expiry });
          resolve();
        },
      });
      this._client.requestAccessToken();
    });
  }

  async fetchTodayEvents() {
    if (!this._token) return [];
    const today = new Date();
    const timeMin = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
    const timeMax = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).toISOString();
    const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true&orderBy=startTime`;
    try {
      const res = await fetch(url, { headers: { Authorization: 'Bearer ' + this._token } });
      if (!res.ok) throw new Error('Calendar API ' + res.status);
      const data = await res.json();
      return (data.items || []).map(ev => ({
        id: ev.id,
        name: ev.summary || '（無標題）',
        dueDate: (ev.start?.dateTime || ev.start?.date || '').slice(0, 10),
        notes: ev.description || '',
      }));
    } catch (e) {
      console.warn('GCal fetch error:', e);
      return [];
    }
  }

  disconnect() {
    this._connected = false;
    this._token = null;
    this.state.saveGCalToken(null);
    if (typeof google !== 'undefined') {
      google.accounts.oauth2.revoke(this._token, () => { });
    }
  }
}

/* =====================================================
   5. WeatherWidget — 地理定位 + OpenWeatherMap
   ===================================================== */
class WeatherWidget {
  constructor() {
    this._cache_key = 'ddash_weather_cache';
  }

  async init() {
    // sessionStorage 快取 30 分鐘
    try {
      const cached = JSON.parse(sessionStorage.getItem(this._cache_key) || 'null');
      if (cached && (Date.now() - cached.ts) < 30 * 60 * 1000) {
        this.render(cached.data);
        return;
      }
    } catch { }

    if (!CONFIG.OPENWEATHER_API_KEY) {
      this.renderError('請點右上角 ⚙️ 設定 OpenWeatherMap API Key');
      return;
    }

    if (!navigator.geolocation) {
      this.renderError('此瀏覽器不支援地理定位');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const data = await this.fetchWeather(pos.coords.latitude, pos.coords.longitude);
        if (data) {
          sessionStorage.setItem(this._cache_key, JSON.stringify({ ts: Date.now(), data }));
          this.render(data);
        }
      },
      async () => {
        // 備用：IP 定位
        const data = await this.fetchWeatherByIP();
        if (data) {
          sessionStorage.setItem(this._cache_key, JSON.stringify({ ts: Date.now(), data }));
          this.render(data);
        } else {
          this.renderError('無法取得位置，請允許瀏覽器存取位置');
        }
      }
    );
  }

  async fetchWeather(lat, lon) {
    try {
      const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${CONFIG.OPENWEATHER_API_KEY}&units=${CONFIG.WEATHER_UNITS}&lang=${CONFIG.WEATHER_LANG}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const d = await res.json();
      return this._normalize(d);
    } catch (e) {
      this.renderError('天氣載入失敗：' + e.message);
      return null;
    }
  }

  async fetchWeatherByIP() {
    try {
      const geo = await fetch('https://ipapi.co/json/');
      const g = await geo.json();
      return this.fetchWeather(g.latitude, g.longitude);
    } catch { return null; }
  }

  _normalize(d) {
    return {
      city: d.name,
      country: d.sys?.country,
      temp: Math.round(d.main.temp),
      feelsLike: Math.round(d.main.feels_like),
      tempMin: Math.round(d.main.temp_min),
      tempMax: Math.round(d.main.temp_max),
      humidity: d.main.humidity,
      windSpeed: d.wind?.speed ?? 0,
      description: d.weather[0]?.description ?? '',
      icon: d.weather[0]?.icon ?? '01d',
    };
  }

  render(data) {
    const el = document.getElementById('weather-body');
    if (!el) return;
    el.innerHTML = `
      <div class="weather-main">
        <img class="weather-icon" src="https://openweathermap.org/img/wn/${data.icon}@2x.png" alt="${data.description}" />
        <div>
          <div class="weather-temp">${data.temp}<span class="weather-temp__unit">°C</span></div>
          <div class="weather-desc">${data.description}</div>
          <div class="weather-location">${data.city}${data.country ? ', ' + data.country : ''}</div>
        </div>
      </div>
      <div class="weather-details">
        <div class="weather-detail">
          <div class="weather-detail__label">體感溫度</div>
          <div class="weather-detail__value">${data.feelsLike}°C</div>
        </div>
        <div class="weather-detail">
          <div class="weather-detail__label">濕度</div>
          <div class="weather-detail__value">${data.humidity}%</div>
        </div>
        <div class="weather-detail">
          <div class="weather-detail__label">最高 / 最低</div>
          <div class="weather-detail__value">${data.tempMax}° / ${data.tempMin}°</div>
        </div>
        <div class="weather-detail">
          <div class="weather-detail__label">風速</div>
          <div class="weather-detail__value">${data.windSpeed} m/s</div>
        </div>
      </div>
    `;
  }

  renderError(msg) {
    const el = document.getElementById('weather-body');
    if (el) el.innerHTML = `<div class="weather-error">⚠️ ${msg}</div>`;
  }

  refresh() {
    sessionStorage.removeItem(this._cache_key);
    const el = document.getElementById('weather-body');
    if (el) el.innerHTML = '<div class="weather-loading"><div class="spinner"></div><p>重新載入中…</p></div>';
    this.init();
  }
}

/* =====================================================
   6. UIRenderer — 所有 DOM 操作
   ===================================================== */
class UIRenderer {
  constructor(todoManager, gamificationEngine, stateManager) {
    this.todos = todoManager;
    this.gamify = gamificationEngine;
    this.state = stateManager;
  }

  /* ----- Top bar / header ----- */
  renderHeader() {
    const now = new Date();
    const dateStr = now.toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
    document.getElementById('topbar-date').textContent = dateStr;

    const hr = now.getHours();
    let greeting = '早安 ☀️';
    if (hr >= 12 && hr < 18) greeting = '午安 🌤';
    else if (hr >= 18) greeting = '晚安 🌙';
    document.getElementById('topbar-greeting').textContent = greeting + '，今日加油！';
  }

  renderGamification() {
    const xp = this.state.getXP();
    const streak = this.state.getStreak();
    const prog = this.gamify.getLevelProgress(xp);
    const prevLvl = parseInt(document.getElementById('level-num').textContent);

    document.getElementById('xp-total').textContent = xp.toLocaleString();
    document.getElementById('level-num').textContent = prog.level;
    document.getElementById('streak-count').textContent = streak.current;

    // XP bar
    document.getElementById('xp-bar-fill').style.width = prog.pct + '%';
    document.getElementById('xp-bar-text').textContent =
      prog.next ? `${prog.current} / ${prog.next} XP` : 'MAX LEVEL';

    // Level up animation
    if (prog.level > prevLvl && prevLvl > 0) {
      this.showLevelUp(prog.level);
    }
  }

  renderProgress(allTodos) {
    const total = allTodos.length;
    const done = allTodos.filter(t => t.completed).length;
    const pct = total > 0 ? Math.round(done / total * 100) : 0;
    document.getElementById('progress-fill').style.width = pct + '%';
    document.getElementById('progress-fraction').textContent = `${done} / ${total}`;
  }

  renderNews(dailyData) {
    const el = document.getElementById('news-body');
    const meta = document.getElementById('news-updated');
    if (!el) return;

    const feeds = dailyData?.rss_news ?? [];
    if (!feeds.length) {
      el.innerHTML = '<div class="empty-state">尚無新聞，請設定 RSS_FEED_URLS Secret</div>';
      return;
    }

    if (dailyData?.meta?.generated_at) {
      const t = new Date(dailyData.meta.generated_at).toLocaleString('zh-TW', { hour: '2-digit', minute: '2-digit' });
      meta.textContent = '更新於 ' + t;
    }

    el.innerHTML = feeds.map(feed => `
      <div class="news-feed-group">
        <div class="news-feed-name">${this._esc(feed.feed_name)}</div>
        <div class="news-items">
          ${(feed.items || []).map(item => `
            <div class="news-item">
              <div class="news-item__dot"></div>
              <div class="news-item__content">
                <div class="news-item__title">
                  <a href="${this._esc(item.link)}" target="_blank" rel="noopener">${this._esc(item.title)}</a>
                </div>
                ${item.published ? `<div class="news-item__meta">${this._relTime(item.published)}</div>` : ''}
                ${item.summary ? `<div class="news-item__summary">${this._esc(item.summary)}</div>` : ''}
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `).join('');
  }

  renderTodos(allTodos) {
    const active = this.todos.getActiveTodos(allTodos);
    const completed = this.todos.getCompletedTodos(allTodos);

    const listEl = document.getElementById('todo-list');
    const emptyEl = document.getElementById('todo-empty');
    const compList = document.getElementById('completed-list');
    const compEmpty = document.getElementById('completed-empty');
    const compCount = document.getElementById('completed-count');

    if (!listEl) return;

    // Active
    if (active.length === 0) {
      listEl.innerHTML = '';
      if (emptyEl) emptyEl.style.display = '';
    } else {
      if (emptyEl) emptyEl.style.display = 'none';
      listEl.innerHTML = active.map(t => this._todoItemHTML(t, false)).join('');
    }

    // Completed
    compCount.textContent = completed.length;
    if (completed.length === 0) {
      compList.innerHTML = '';
      if (compEmpty) compEmpty.style.display = '';
    } else {
      if (compEmpty) compEmpty.style.display = 'none';
      compList.innerHTML = completed.map(t => this._todoItemHTML(t, true)).join('');
    }
  }

  _todoItemHTML(todo, isCompleted) {
    const priorityClass = (todo.priority || 'Medium').toLowerCase();
    const overdue = !isCompleted && todo.dueDate && todo.dueDate < new Date().toLocaleDateString('sv-SE');
    return `
      <div class="todo-item todo-item--${priorityClass}${isCompleted ? ' todo-item--completed' : ''}" data-id="${todo.id}">
        <div class="todo-item__checkbox${isCompleted ? ' todo-item__checkbox--checked' : ''}"
             role="checkbox" aria-checked="${isCompleted}"
             data-action="toggle" data-id="${todo.id}"></div>
        <div class="todo-item__body">
          <div class="todo-item__name">${this._esc(todo.name)}</div>
          <div class="todo-item__meta">
            ${todo.dueDate ? `<span class="todo-item__due${overdue ? ' todo-item__due--overdue' : ''}">${overdue ? '⚠️ 逾期 ' : ''}${todo.dueDate}</span>` : ''}
            <span class="badge badge--${priorityClass}">${this._priorityLabel(todo.priority)}</span>
            <span class="badge badge--${todo.source}">${this._sourceLabel(todo.source)}</span>
            <span class="badge badge--points">+${todo.points}pt</span>
          </div>
        </div>
        <div class="todo-item__actions">
          ${todo.source === 'manual' ? `<button class="btn-delete" data-action="delete" data-id="${todo.id}" title="刪除">✕</button>` : ''}
        </div>
      </div>
    `;
  }

  renderContentItems(contentItems) {
    const listEl = document.getElementById('content-list');
    const emptyEl = document.getElementById('content-empty');
    if (!listEl) return;

    if (contentItems.length === 0) {
      listEl.innerHTML = '';
      if (emptyEl) emptyEl.style.display = '';
      return;
    }
    if (emptyEl) emptyEl.style.display = 'none';

    listEl.innerHTML = contentItems.map(c => `
      <div class="content-item${c.status === '已發布' ? ' content-item--done' : ''}" data-cid="${c.id}">
        <div class="content-item__body">
          <div class="content-item__topic">${this._esc(c.topic)}</div>
          <div class="content-item__meta">
            ${c.plannedDate ? `<span class="content-item__date">📅 ${c.plannedDate}</span>` : ''}
            <span class="platform-badge">${this._esc(c.platform || '')}</span>
            <span class="content-status content-status--${this._contentStatusClass(c.status)}">${this._esc(c.status || '')}</span>
          </div>
        </div>
        <div class="todo-item__actions">
          ${c.status !== '已發布' ? `<button class="btn-icon" data-action="content-done" data-cid="${c.id}" title="標為已發布">✓</button>` : ''}
          ${c.source === 'manual' ? `<button class="btn-delete" data-action="content-delete" data-cid="${c.id}" title="刪除">✕</button>` : ''}
        </div>
      </div>
    `).join('');
  }

  renderAchievements() {
    const earned = new Set(this.state.getAchievements());
    const el = document.getElementById('achievements-grid');
    if (!el) return;
    el.innerHTML = this.gamify.ACHIEVEMENTS.map(a => `
      <div class="achievement-badge${earned.has(a.id) ? '' : ' achievement-badge--locked'}" title="${this._esc(a.desc)}">
        <span class="achievement-badge__icon">${a.icon}</span>
        <span class="achievement-badge__name">${a.name}</span>
      </div>
    `).join('');
  }

  showToast(msg, type = '') {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'toast toast--visible' + (type ? ' toast--' + type : '');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { el.classList.remove('toast--visible'); }, 2800);
  }

  showLevelUp(level) {
    document.getElementById('levelup-text').textContent = 'Lv ' + level;
    const overlay = document.getElementById('levelup-overlay');
    overlay.style.display = 'flex';
  }

  updateGCalButton(connected) {
    const btn = document.getElementById('gcal-btn');
    const text = document.getElementById('gcal-btn-text');
    if (!btn || !text) return;
    if (connected) {
      text.textContent = '📅 日曆已連結';
      btn.classList.add('btn-secondary--active');
    } else {
      text.textContent = '📅 連結 Google 日曆';
      btn.classList.remove('btn-secondary--active');
    }
  }

  /* ----- Helpers ----- */
  _esc(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  _priorityLabel(p) { return p === 'High' ? '高' : p === 'Low' ? '低' : '中'; }
  _sourceLabel(s) { return s === 'notion' ? 'Notion' : s === 'gcal' ? '日曆' : '手動'; }
  _contentStatusClass(s) {
    const map = { '構思中': 'thinking', '準備中': 'planned', '拍攝中': 'progress', '剪輯中': 'progress', '已發布': 'published', 'Planned': 'planned', 'In Progress': 'progress', 'Filmed': 'filmed', 'Published': 'published' };
    return map[s] || 'planned';
  }
  _relTime(iso) {
    const diff = (Date.now() - new Date(iso)) / 3600000;
    if (diff < 1) return Math.round(diff * 60) + ' 分鐘前';
    if (diff < 24) return Math.round(diff) + ' 小時前';
    return Math.round(diff / 24) + ' 天前';
  }
}

/* =====================================================
   7. GistSyncManager — 跨裝置自動同步（GitHub Gist）
   ===================================================== */
class GistSyncManager {
  constructor(stateManager) {
    this.state   = stateManager;
    this.FILE    = 'daily-dashboard-state.json';
    this.PAT_KEY    = 'ddash_gist_pat';
    this.GIST_KEY   = 'ddash_gist_id';
    this.SYNCED_KEY = 'ddash_gist_synced_at';
    this._pat    = localStorage.getItem(this.PAT_KEY) || '';
    this._gistId = localStorage.getItem(this.GIST_KEY) || '';
    this._pushTimer = null;
  }

  isConfigured() { return !!this._pat; }

  _headers() {
    return { Authorization: `token ${this._pat}`, 'Content-Type': 'application/json' };
  }

  _snapshot() {
    return {
      manual_todos:      this.state.getManualTodos(),
      completions:       this.state.getCompletions(),
      xp:                this.state.getXP(),
      streak:            this.state.getStreak(),
      achievements:      this.state.getAchievements(),
      content_additions: this.state.getContentAdditions(),
      synced_at:         new Date().toISOString(),
    };
  }

  _applySnapshot(data, app) {
    if (data.manual_todos)           this.state.saveManualTodos(data.manual_todos);
    if (data.completions)            this.state.saveCompletions(data.completions);
    if (typeof data.xp === 'number') this.state.saveXP(data.xp);
    if (data.streak)                 this.state.saveStreak(data.streak);
    if (data.achievements)           this.state.saveAchievements(data.achievements);
    if (data.content_additions)      this.state.saveContentAdditions(data.content_additions);
    app._refreshTodos();
    app._refreshContent();
    app.renderer.renderGamification();
    app.renderer.renderAchievements();
  }

  async connect(pat) {
    // 驗證 token
    try {
      const res = await fetch('https://api.github.com/user', {
        headers: { Authorization: `token ${pat}` }
      });
      if (!res.ok) return false;
      this._pat = pat;
      localStorage.setItem(this.PAT_KEY, pat);
      return true;
    } catch { return false; }
  }

  disconnect() {
    this._pat    = '';
    this._gistId = '';
    localStorage.removeItem(this.PAT_KEY);
    localStorage.removeItem(this.GIST_KEY);
    localStorage.removeItem(this.SYNCED_KEY);
  }

  async push() {
    if (!this._pat) return;
    const body = {
      description: 'daily-dashboard-state',
      public:      false,
      files:       { [this.FILE]: { content: JSON.stringify(this._snapshot(), null, 2) } },
    };
    try {
      let res;
      if (this._gistId) {
        res = await fetch(`https://api.github.com/gists/${this._gistId}`, {
          method: 'PATCH', headers: this._headers(), body: JSON.stringify(body),
        });
      } else {
        res = await fetch('https://api.github.com/gists', {
          method: 'POST', headers: this._headers(), body: JSON.stringify(body),
        });
        if (res.ok) {
          const g = await res.json();
          this._gistId = g.id;
          localStorage.setItem(this.GIST_KEY, g.id);
        }
      }
      if (res.ok) {
        const now = new Date().toISOString();
        localStorage.setItem(this.SYNCED_KEY, now);
      }
    } catch(e) { console.warn('Gist push error:', e); }
  }

  // 自動推送（防抖，2 秒後才推）
  schedulePush() {
    clearTimeout(this._pushTimer);
    this._pushTimer = setTimeout(() => this.push(), 2000);
  }

  async pull(app) {
    if (!this._pat) return false;
    try {
      // 先找到 Gist ID（若未快取）
      if (!this._gistId) {
        const res  = await fetch('https://api.github.com/gists?per_page=50', { headers: this._headers() });
        const list = await res.json();
        const found = list.find(g => g.description === 'daily-dashboard-state');
        if (!found) return false;
        this._gistId = found.id;
        localStorage.setItem(this.GIST_KEY, found.id);
      }
      const res  = await fetch(`https://api.github.com/gists/${this._gistId}`, { headers: this._headers() });
      const gist = await res.json();
      const raw  = gist.files?.[this.FILE]?.content;
      if (!raw) return false;
      const data = JSON.parse(raw);
      this._applySnapshot(data, app);
      if (data.synced_at) localStorage.setItem(this.SYNCED_KEY, data.synced_at);
      return true;
    } catch(e) { console.warn('Gist pull error:', e); return false; }
  }

  refreshModal() {
    const configured = this.isConfigured();
    document.getElementById('sync-setup-panel').style.display     = configured ? 'none' : '';
    document.getElementById('sync-connected-panel').style.display = configured ? ''     : 'none';
    if (configured) {
      const t = localStorage.getItem(this.SYNCED_KEY);
      document.getElementById('sync-last-time').textContent =
        t ? '上次同步：' + new Date(t).toLocaleString('zh-TW') : '尚未同步';
      document.getElementById('sync-hint2').textContent = '';
    } else {
      document.getElementById('sync-pat-input').value = '';
      document.getElementById('sync-hint').textContent = '';
    }
  }
}

/* =====================================================
   8. DashboardApp — 協調者
   ===================================================== */
class DashboardApp {
  constructor() {
    this.stateManager = new StateManager();
    this.gamify       = new GamificationEngine(this.stateManager);
    this.todoManager  = new TodoManager(this.stateManager, this.gamify);
    this.calClient    = new CalendarClient(this.stateManager);
    this.weather      = new WeatherWidget();
    this.renderer     = new UIRenderer(this.todoManager, this.gamify, this.stateManager);
    this.gistSync     = new GistSyncManager(this.stateManager);
    this._gcalEvents  = [];
    this._allTodos    = [];
  }

  async init() {
    // 渲染靜態 header
    this.renderer.renderHeader();

    // 載入 daily.json
    const dailyData = await this.todoManager.loadDailyData();

    // Gist 自動拉取（若已設定）
    if (this.gistSync.isConfigured()) {
      await this.gistSync.pull(this);
    }

    // 初始化 Google Calendar（不觸發 OAuth，僅恢復 token）
    this.calClient.init();
    this.renderer.updateGCalButton(this.calClient.isConnected());

    // 若已連結，載入行程
    if (this.calClient.isConnected()) {
      this._gcalEvents = await this.calClient.fetchTodayEvents();
    }

    // 渲染所有區塊
    this._refreshTodos();
    this.renderer.renderNews(dailyData);
    this.renderer.renderAchievements();
    this.renderer.renderGamification();

    // 天氣（非同步，不阻塞）
    this.weather.init();

    // 事件監聽
    this._attachListeners();
  }

  _refreshTodos() {
    this._allTodos = this.todoManager.mergeAllTodos(this._gcalEvents);
    this.renderer.renderTodos(this._allTodos);
    this.renderer.renderProgress(this._allTodos);
    this.renderer.renderAchievements();
    this.renderer.renderGamification();

    // 檢查成就
    const stats = this._buildStats();
    const newAchs = this.gamify.checkAchievements(stats);
    for (const a of newAchs) {
      setTimeout(() => this.renderer.showToast(`🏆 解鎖成就：${a.name}！`, 'success'), 500);
    }
    // 自動同步到 Gist
    this.gistSync.schedulePush();
  }

  _refreshContent() {
    const items = this.todoManager.mergeContentItems();
    this.renderer.renderContentItems(items);
    this.gistSync.schedulePush();
  }

  _buildStats() {
    const done = this._allTodos.filter(t => t.completed);
    const total = this._allTodos.length;
    const now = new Date();
    const noon = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);
    const beforeNoon = done.filter(t => t.completedAt && new Date(t.completedAt) < noon).length;
    const manualContent = this.stateManager.getContentAdditions();
    const notionContent = this.todoManager.getDailyData()?.notion_content ?? [];
    const allContent = [...notionContent, ...manualContent];
    const videosDone = allContent.filter(c => (c.status === '已發布' || c.status === 'Published')).length;
    return {
      totalCompleted: done.length,
      totalActive: total,
      completedBeforeNoon: beforeNoon,
      streak: this.stateManager.getStreak(),
      dailyPct: total > 0 ? Math.round(done.length / total * 100) : 0,
      videosDone,
    };
  }

  _attachListeners() {
    // 新增代辦
    document.getElementById('add-todo-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = document.getElementById('todo-input').value.trim();
      const deadline = document.getElementById('todo-deadline').value;
      const priority = document.getElementById('todo-priority').value;
      if (!name) return;
      this.todoManager.addManualTodo(name, deadline, priority);
      document.getElementById('todo-input').value = '';
      document.getElementById('todo-deadline').value = '';
      this._refreshTodos();
      this.renderer.showToast('代辦已新增！', 'success');
    });

    // 新增影片題材
    document.getElementById('add-content-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const topic = document.getElementById('content-topic-input').value.trim();
      const date = document.getElementById('content-date-input').value;
      const platform = document.getElementById('content-platform-input').value;
      if (!topic) return;
      this.todoManager.addContentItem(topic, date, platform);
      document.getElementById('content-topic-input').value = '';
      document.getElementById('content-date-input').value = '';
      this._refreshContent();
      this.renderer.showToast('題材已新增！', 'success');
    });

    // 代辦清單委派事件（勾選 / 刪除）
    document.addEventListener('click', (e) => {
      const action = e.target.dataset.action;
      const id = e.target.dataset.id;
      const cid = e.target.dataset.cid;

      if (action === 'toggle' && id) {
        const todo = this._allTodos.find(t => t.id === id);
        if (!todo) return;
        if (todo.completed) {
          this.todoManager.uncompleteTodo(todo);
          this._refreshTodos();
          this.renderer.showToast('代辦已取消完成');
        } else {
          const pts = this.todoManager.completeTodo(todo);
          this._refreshTodos();
          this.renderer.showToast(`完成！獲得 +${pts} XP ⭐`, 'points');
        }
      }

      if (action === 'delete' && id) {
        this.todoManager.removeManualTodo(id);
        this._refreshTodos();
        this.renderer.showToast('代辦已刪除');
      }

      if (action === 'content-done' && cid) {
        this.todoManager.markContentDone(cid);
        this._refreshContent();
        this.renderer.showToast('已標為發布！🎉', 'success');
        this.renderer.renderGamification();
        const stats = this._buildStats();
        const newAchs = this.gamify.checkAchievements(stats);
        for (const a of newAchs) {
          setTimeout(() => this.renderer.showToast(`🏆 成就解鎖：${a.name}！`, 'success'), 600);
        }
      }

      if (action === 'content-delete' && cid) {
        this.todoManager.removeContentItem(cid);
        this._refreshContent();
        this.renderer.showToast('題材已刪除');
      }
    });

    // Google 日曆按鈕
    document.getElementById('gcal-btn')?.addEventListener('click', async () => {
      if (!CONFIG.GOOGLE_CLIENT_ID) {
        this.renderer.showToast('請先點 ⚙️ 設定 Google Client ID', 'error');
        return;
      }
      if (this.calClient.isConnected()) {
        this.calClient.disconnect();
        this._gcalEvents = [];
        this.renderer.updateGCalButton(false);
        this._refreshTodos();
        this.renderer.showToast('已中斷 Google 日曆連結');
        return;
      }
      try {
        await this.calClient.authorize();
        this._gcalEvents = await this.calClient.fetchTodayEvents();
        this.renderer.updateGCalButton(true);
        this._refreshTodos();
        this.renderer.showToast(`已同步 ${this._gcalEvents.length} 個行程 📅`, 'success');
      } catch (e) {
        this.renderer.showToast('日曆授權失敗', 'error');
        console.error(e);
      }
    });

    // 天氣重新整理
    document.getElementById('weather-refresh')?.addEventListener('click', () => {
      this.weather.refresh();
    });

    // 完成區展開/收合
    const completedToggle = document.getElementById('completed-toggle');
    completedToggle?.addEventListener('click', () => {
      const list = document.getElementById('completed-list');
      const chevron = document.getElementById('completed-chevron');
      const hidden = list.style.display === 'none';
      list.style.display = hidden ? '' : 'none';
      chevron.classList.toggle('completed-chevron--up', hidden);
    });
    completedToggle?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') completedToggle.click();
    });

    // 升等關閉
    document.getElementById('levelup-close')?.addEventListener('click', () => {
      document.getElementById('levelup-overlay').style.display = 'none';
    });
    document.getElementById('levelup-overlay')?.addEventListener('click', (e) => {
      if (e.target.id === 'levelup-overlay') {
        document.getElementById('levelup-overlay').style.display = 'none';
      }
    });

    // 同步 modal 開啟
    document.getElementById('sync-open-btn')?.addEventListener('click', () => {
      this.gistSync.refreshModal();
      document.getElementById('sync-overlay').style.display = 'flex';
    });
    const closeSync = () => { document.getElementById('sync-overlay').style.display = 'none'; };
    document.getElementById('sync-close-btn')?.addEventListener('click', closeSync);
    document.getElementById('sync-close-btn2')?.addEventListener('click', closeSync);
    document.getElementById('sync-overlay')?.addEventListener('click', (e) => {
      if (e.target.id === 'sync-overlay') closeSync();
    });

    // Gist 連結
    document.getElementById('sync-connect-btn')?.addEventListener('click', async () => {
      const pat = document.getElementById('sync-pat-input').value.trim();
      if (!pat) return;
      document.getElementById('sync-hint').textContent = '連結中…';
      const ok = await this.gistSync.connect(pat);
      if (ok) {
        await this.gistSync.pull(this);
        this.gistSync.refreshModal();
        this.renderer.showToast('Gist 同步已啟用 ✅', 'success');
      } else {
        document.getElementById('sync-hint').textContent = '❌ Token 無效，請確認已勾選 gist 權限';
      }
    });

    // 立即推送
    document.getElementById('sync-now-btn')?.addEventListener('click', async () => {
      document.getElementById('sync-hint2').textContent = '同步中…';
      await this.gistSync.push();
      document.getElementById('sync-hint2').textContent = '✅ 已同步至 Gist';
      this.gistSync.refreshModal();
    });

    // 從雲端拉取
    document.getElementById('sync-pull-btn')?.addEventListener('click', async () => {
      document.getElementById('sync-hint2').textContent = '拉取中…';
      const ok = await this.gistSync.pull(this);
      if (ok) {
        closeSync();
        this.renderer.showToast('已從 Gist 還原資料 ✅', 'success');
      } else {
        document.getElementById('sync-hint2').textContent = '❌ 拉取失敗';
      }
    });

    // 中斷連結
    document.getElementById('sync-disconnect-btn')?.addEventListener('click', () => {
      this.gistSync.disconnect();
      this.gistSync.refreshModal();
      this.renderer.showToast('已中斷 Gist 同步');
    });

    // ⚙️ 設定 Modal
    const openSettings = () => {
      document.getElementById('settings-owm-input').value  = localStorage.getItem('ddash_owm_key') || '';
      document.getElementById('settings-gcal-input').value = localStorage.getItem('ddash_gcal_client_id') || '';
      document.getElementById('settings-hint').textContent = '';
      document.getElementById('settings-overlay').style.display = 'flex';
    };
    const closeSettings = () => { document.getElementById('settings-overlay').style.display = 'none'; };

    document.getElementById('settings-btn')?.addEventListener('click', openSettings);
    document.getElementById('settings-close-btn')?.addEventListener('click', closeSettings);
    document.getElementById('settings-overlay')?.addEventListener('click', (e) => {
      if (e.target.id === 'settings-overlay') closeSettings();
    });
    document.getElementById('settings-save-btn')?.addEventListener('click', () => {
      const owm  = document.getElementById('settings-owm-input').value.trim();
      const gcal = document.getElementById('settings-gcal-input').value.trim();
      if (owm)  localStorage.setItem('ddash_owm_key', owm);
      if (gcal) localStorage.setItem('ddash_gcal_client_id', gcal);
      closeSettings();
      this.renderer.showToast('設定已儲存，重新整理後生效 ✅', 'success');
      // 清除天氣快取並立即重試
      if (owm) this.weather.refresh();
    });

    // 若尚未設定 API Key，首次載入提示
    if (!CONFIG.OPENWEATHER_API_KEY && !CONFIG.GOOGLE_CLIENT_ID) {
      setTimeout(() => {
        this.renderer.showToast('首次使用請點 ⚙️ 填入 API 金鑰', 'error');
      }, 1000);
    }
  }
}

/* =====================================================
   啟動
   ===================================================== */
document.addEventListener('DOMContentLoaded', async () => {
  // 初始化影片題材區塊（獨立於 app 啟動）
  const app = new DashboardApp();
  await app.init();
  app._refreshContent();

  // 公開 app 供 debug 使用
  window.__dashApp = app;
});
