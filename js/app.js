/* ====================================================
   每日任務板 — app.js  v2
   架構：StateManager → GamificationEngine → TodoManager
         → CalendarClient → WeatherWidget → UIRenderer
         → GistSyncManager → DashboardApp (協調者)
   ==================================================== */

'use strict';

/* ---------- 設定（由 localStorage 讀取，不硬寫在程式碼中） ---------- */
const CONFIG = {
  get OPENWEATHER_API_KEY() { return localStorage.getItem('ddash_owm_key') || ''; },
  get GOOGLE_CLIENT_ID()    { return localStorage.getItem('ddash_gcal_client_id') || ''; },
  WEATHER_LANG:  'zh_tw',
  WEATHER_UNITS: 'metric',
};

/* ---------- 每日勵志語 ---------- */
const DAILY_QUOTES = [
  '行動是治癒恐懼的最佳良藥。',
  '每一天都是新的開始，把握今天！',
  '堅持是成功的唯一方法。',
  '你比你想像的更強大。',
  '小進步，每天進步，就是巨大的進步。',
  '成功不是偶然，而是每天努力的累積。',
  '不要等到明天，現在就開始吧！',
  '困難只是暫時的，放棄才是永遠的。',
  '每一步，無論大小，都讓你更靠近目標。',
  '夢想不會逃跑，逃跑的永遠是自己。',
  '今天的努力，是明天成功的基礎。',
  '把每件事都做到極致，好運自然來。',
  '相信過程，結果自然水到渠成。',
  '不是所有事情都順利，但每件事都是成長。',
  '聚焦當下，讓今天的自己比昨天更好。',
  '勇氣不是沒有恐懼，而是儘管恐懼仍然前進。',
  '最好的投資，就是投資自己。',
  '凡事從小事做起，積少成多。',
  '你的努力，時間都看得見。',
  '今天種下的種子，明天就是參天大樹。',
];

/* =====================================================
   1. StateManager — localStorage 讀寫
   ===================================================== */
class StateManager {
  constructor() {
    this.KEYS = {
      MANUAL_TODOS:      'ddash_manual_todos',
      COMPLETIONS:       'ddash_completions',
      XP:                'ddash_xp',
      STREAK:            'ddash_streak',
      ACHIEVEMENTS:      'ddash_achievements',
      GCAL_TOKEN:        'ddash_gcal_token',
      CONTENT_ADDITIONS: 'ddash_content_additions',
      CONTENT_OVERRIDES: 'ddash_notion_content_status_overrides',
      CONTENT_NOTES:     'ddash_content_notes',
      WEATHER_CITY:      'ddash_weather_city',
      TODO_SORT:         'ddash_todo_sort',
      PERFECT_DAYS:      'ddash_perfect_days',
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

  getManualTodos()       { return this._read(this.KEYS.MANUAL_TODOS, []); }
  saveManualTodos(v)     { this._write(this.KEYS.MANUAL_TODOS, v); }
  getCompletions()       { return this._read(this.KEYS.COMPLETIONS, {}); }
  saveCompletions(v)     { this._write(this.KEYS.COMPLETIONS, v); }
  getXP()                { return this._read(this.KEYS.XP, 0); }
  saveXP(xp)             { this._write(this.KEYS.XP, xp); }
  getStreak()            { return this._read(this.KEYS.STREAK, { current: 0, longest: 0, lastActiveDate: null }); }
  saveStreak(v)          { this._write(this.KEYS.STREAK, v); }
  getAchievements()      { return this._read(this.KEYS.ACHIEVEMENTS, []); }
  saveAchievements(v)    { this._write(this.KEYS.ACHIEVEMENTS, v); }
  getGCalToken()         { return this._read(this.KEYS.GCAL_TOKEN, null); }
  saveGCalToken(v)       { this._write(this.KEYS.GCAL_TOKEN, v); }
  getContentAdditions()  { return this._read(this.KEYS.CONTENT_ADDITIONS, []); }
  saveContentAdditions(v){ this._write(this.KEYS.CONTENT_ADDITIONS, v); }
  getContentOverrides()  { return this._read(this.KEYS.CONTENT_OVERRIDES, {}); }
  saveContentOverrides(v){ this._write(this.KEYS.CONTENT_OVERRIDES, v); }
  getContentNotes()      { return this._read(this.KEYS.CONTENT_NOTES, {}); }
  saveContentNote(id, note) {
    const notes = this.getContentNotes();
    if (note) notes[id] = note; else delete notes[id];
    this._write(this.KEYS.CONTENT_NOTES, notes);
  }
  getWeatherCity()       { return this._read(this.KEYS.WEATHER_CITY, ''); }
  saveWeatherCity(v)     { this._write(this.KEYS.WEATHER_CITY, v); }
  getTodoSort()          { return this._read(this.KEYS.TODO_SORT, 'priority'); }
  saveTodoSort(v)        { this._write(this.KEYS.TODO_SORT, v); }
  getPerfectDays()       { return this._read(this.KEYS.PERFECT_DAYS, 0); }
  savePerfectDays(v)     { this._write(this.KEYS.PERFECT_DAYS, v); }
}

/* =====================================================
   2. GamificationEngine — 積分、等級、成就、連續天數
   ===================================================== */
class GamificationEngine {
  constructor(stateManager) {
    this.state = stateManager;
    this.LEVEL_THRESHOLDS = [0, 100, 300, 600, 1000, 1500, 2100, 2800, 3600, 4500];
    this.PRIORITY_POINTS  = { High: 20, Medium: 15, Low: 10 };
    this.STREAK_BONUS     = 5;

    this.ACHIEVEMENTS = [
      /* Getting started */
      { id: 'first_todo',        icon: '🌱', name: '第一步',     desc: '完成第一個代辦',          check: s => s.totalCompleted >= 1 },
      /* Time-based */
      { id: 'early_bird',        icon: '🐦', name: '早起鳥',     desc: '中午前完成任一代辦',        check: s => s.completedBeforeNoon >= 1 },
      { id: 'early_bird_9',      icon: '🌅', name: '晨光特攻',   desc: '早上九點前完成代辦',        check: s => s.completedBeforeMorning >= 1 },
      { id: 'night_owl',         icon: '🌙', name: '夜貓子',     desc: '晚上十點後完成代辦',        check: s => s.completedAfterTenPm >= 1 },
      { id: 'midnight_warrior',  icon: '⚡', name: '凌晨戰士',   desc: '凌晨完成代辦',            check: s => s.completedAfterMidnight >= 1 },
      /* Streak */
      { id: 'streak_3',          icon: '🔥', name: '三日連勝',   desc: '連續三天有完成代辦',        check: s => s.streak.current >= 3 },
      { id: 'streak_7',          icon: '🔥', name: '週連勝',     desc: '連續七天有完成代辦',        check: s => s.streak.current >= 7 },
      { id: 'streak_14',         icon: '💪', name: '雙週挑戰',   desc: '連續十四天有完成代辦',       check: s => s.streak.current >= 14 },
      { id: 'streak_30',         icon: '⚡', name: '無法阻擋',   desc: '連續三十天有完成代辦',       check: s => s.streak.current >= 30 },
      { id: 'streak_60',         icon: '👑', name: '月光傳說',   desc: '連續六十天有完成代辦',       check: s => s.streak.current >= 60 },
      { id: 'streak_100',        icon: '🏆', name: '年度傳奇',   desc: '連續一百天有完成代辦',       check: s => s.streak.current >= 100 },
      /* Productivity */
      { id: 'todo_5',            icon: '📝', name: '勤勞蜜蜂',   desc: '累計完成五個代辦',          check: s => s.totalCompleted >= 5 },
      { id: 'todo_10',           icon: '🎯', name: '精準射手',   desc: '累計完成十個代辦',          check: s => s.totalCompleted >= 10 },
      { id: 'todo_25',           icon: '💼', name: '工作狂',     desc: '累計完成二十五個代辦',       check: s => s.totalCompleted >= 25 },
      { id: 'todo_50',           icon: '🚀', name: '超級效率',   desc: '累計完成五十個代辦',        check: s => s.totalCompleted >= 50 },
      { id: 'todo_100',          icon: '💯', name: '百步穿楊',   desc: '累計完成一百個代辦',        check: s => s.totalCompleted >= 100 },
      /* Priority warriors */
      { id: 'high_5',            icon: '⚔️', name: '高手過招',   desc: '完成五個高優先度代辦',       check: s => s.highPriorityDone >= 5 },
      { id: 'high_10',           icon: '🎖️', name: '精英特種',   desc: '完成十個高優先度代辦',       check: s => s.highPriorityDone >= 10 },
      /* Perfect days */
      { id: 'perfect_day',       icon: '💯', name: '完美一天',   desc: '當日代辦全部完成',          check: s => s.dailyPct >= 100 && s.totalActive > 0 },
      { id: 'perfect_3',         icon: '🌟', name: '完美三天',   desc: '累計三次完美一天',          check: s => s.perfectDayCount >= 3 },
      { id: 'perfect_7',         icon: '✨', name: '完美週',     desc: '累計七次完美一天',          check: s => s.perfectDayCount >= 7 },
      /* Content creator */
      { id: 'video_1',           icon: '📹', name: '初登場',     desc: '影片題材首次完成',          check: s => s.videosDone >= 1 },
      { id: 'video_5',           icon: '🎬', name: '內容創作者', desc: '影片題材累計完成五支',       check: s => s.videosDone >= 5 },
      { id: 'video_10',          icon: '📺', name: '熟練創作者', desc: '影片題材累計完成十支',       check: s => s.videosDone >= 10 },
      { id: 'video_20',          icon: '🏆', name: '頻道主力',   desc: '影片題材累計完成二十支',      check: s => s.videosDone >= 20 },
      { id: 'video_50',          icon: '👑', name: '創作傳說',   desc: '影片題材累計完成五十支',      check: s => s.videosDone >= 50 },
      { id: 'platforms_3',       icon: '📱', name: '多平台主播', desc: '三個平台各有發布',          check: s => s.contentPlatforms >= 3 },
      /* Level milestones */
      { id: 'level_3',           icon: '⬆️', name: '小試身手',   desc: '達到等級三',              check: s => s.level >= 3 },
      { id: 'level_5',           icon: '🔝', name: '漸入佳境',   desc: '達到等級五',              check: s => s.level >= 5 },
      { id: 'level_7',           icon: '🌈', name: '高手境界',   desc: '達到等級七',              check: s => s.level >= 7 },
      { id: 'level_10',          icon: '👑', name: '傳說等級',   desc: '達到等級十',              check: s => s.level >= 10 },
      /* XP milestones */
      { id: 'xp_500',            icon: '🌸', name: '計劃大師',   desc: '累計獲得五百 XP',          check: s => s.xp >= 500 },
      { id: 'xp_2000',           icon: '💎', name: 'XP 收藏家',  desc: '累計獲得兩千 XP',          check: s => s.xp >= 2000 },
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
    const level   = this.getLevel(xp);
    const current = this.LEVEL_THRESHOLDS[level - 1];
    const next    = this.LEVEL_THRESHOLDS[level] ?? null;
    if (next === null) return { level, current: xp, next: null, pct: 100 };
    const pct = Math.min(100, Math.round((xp - current) / (next - current) * 100));
    return { level, current: xp - current, next: next - current, pct };
  }

  awardPoints(todo) {
    const base   = this.PRIORITY_POINTS[todo.priority] ?? 15;
    const streak = this.state.getStreak();
    const bonus  = streak.current > 0 ? this.STREAK_BONUS : 0;
    const total  = base + bonus;
    this.state.saveXP(this.state.getXP() + total);
    return total;
  }

  deductPoints(todo) {
    const base = this.PRIORITY_POINTS[todo.priority] ?? 15;
    this.state.saveXP(Math.max(0, this.state.getXP() - base));
  }

  updateStreak() {
    const today = this._todayStr();
    const streak = this.state.getStreak();
    if (streak.lastActiveDate === today) return;
    const yesterday = this._offsetDay(-1);
    streak.current  = streak.lastActiveDate === yesterday ? streak.current + 1 : 1;
    streak.longest  = Math.max(streak.longest, streak.current);
    streak.lastActiveDate = today;
    this.state.saveStreak(streak);
  }

  checkAchievements(statsSnapshot) {
    const earned  = new Set(this.state.getAchievements());
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

  _todayStr()    { return new Date().toLocaleDateString('sv-SE'); }
  _offsetDay(n)  { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString('sv-SE'); }
}

/* =====================================================
   3. TodoManager — 合併代辦來源、CRUD
   ===================================================== */
class TodoManager {
  constructor(stateManager, gamificationEngine) {
    this.state  = stateManager;
    this.gamify = gamificationEngine;
    this._dailyData = null;
    this.CONTENT_STATUSES = ['構思中', '準備中', '拍攝中', '剪輯中', '已發布'];
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

    for (const t of notionTodos) {
      all.push({
        id: 'notion_' + t.id, source: 'notion',
        name: t.name, dueDate: t.due_date || null,
        priority: t.priority || 'Medium', category: t.category || '',
        points: t.points || 15, notes: t.notes || '',
        completed: !!completions['notion_' + t.id],
        completedAt: completions['notion_' + t.id]?.completedAt || null,
      });
    }
    for (const ev of gcalEvents) {
      all.push({
        id: 'gcal_' + ev.id, source: 'gcal',
        name: ev.name, dueDate: ev.dueDate || null,
        priority: 'Medium', category: '行程', points: 15, notes: ev.notes || '',
        completed: !!completions['gcal_' + ev.id],
        completedAt: completions['gcal_' + ev.id]?.completedAt || null,
      });
    }
    for (const t of manualTodos) {
      all.push({ ...t, completed: !!completions[t.id], completedAt: completions[t.id]?.completedAt || null });
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
    this.state.saveManualTodos(this.state.getManualTodos().filter(t => t.id !== id));
    const completions = this.state.getCompletions();
    delete completions[id];
    this.state.saveCompletions(completions);
  }

  completeTodo(todo) {
    const completions = this.state.getCompletions();
    if (completions[todo.id]) return 0;
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

  getActiveTodos(allTodos)    { return allTodos.filter(t => !t.completed); }
  getCompletedTodos(allTodos) { return allTodos.filter(t => t.completed); }

  sortTodos(todos, mode) {
    const PRIORITY_ORDER = { High: 0, Medium: 1, Low: 2 };
    const copy = [...todos];
    if (mode === 'priority') return copy.sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 1) - (PRIORITY_ORDER[b.priority] ?? 1));
    if (mode === 'due')      return copy.sort((a, b) => (a.dueDate || '9999') < (b.dueDate || '9999') ? -1 : 1);
    return copy;
  }

  /* Content / Video */
  mergeContentItems() {
    const notionContent = this._dailyData?.notion_content ?? [];
    const manualContent = this.state.getContentAdditions();
    const overrides     = this.state.getContentOverrides();
    const all = [];
    for (const c of notionContent) {
      const id = 'notion_c_' + c.id;
      all.push({ id, source: 'notion', topic: c.topic, status: overrides[id] || c.status, plannedDate: c.planned_date, platform: c.platform, tags: c.tags || [], notes: c.notes || '' });
    }
    for (const c of manualContent) {
      all.push({ ...c, status: overrides[c.id] || c.status });
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
    this.state.saveContentAdditions(this.state.getContentAdditions().filter(c => c.id !== id));
    const overrides = this.state.getContentOverrides();
    delete overrides[id];
    this.state.saveContentOverrides(overrides);
  }

  setContentStatus(id, newStatus) {
    if (!this.CONTENT_STATUSES.includes(newStatus)) return;
    const overrides = this.state.getContentOverrides();
    overrides[id] = newStatus;
    this.state.saveContentOverrides(overrides);
    if (id.startsWith('manual_c_')) {
      this.state.saveContentAdditions(
        this.state.getContentAdditions().map(c => c.id === id ? { ...c, status: newStatus } : c)
      );
    }
  }

  cycleContentStatus(id) {
    const all  = this.mergeContentItems();
    const item = all.find(c => c.id === id);
    if (!item) return;
    const overrides = this.state.getContentOverrides();
    const idx  = this.CONTENT_STATUSES.indexOf(item.status);
    const next = this.CONTENT_STATUSES[(idx + 1) % this.CONTENT_STATUSES.length];
    overrides[id] = next;
    this.state.saveContentOverrides(overrides);
    if (id.startsWith('manual_c_')) {
      this.state.saveContentAdditions(this.state.getContentAdditions().map(c => c.id === id ? { ...c, status: next } : c));
    }
  }

  markContentDone(id) {
    const overrides = this.state.getContentOverrides();
    overrides[id] = '已發布';
    this.state.saveContentOverrides(overrides);
    if (id.startsWith('manual_c_')) {
      this.state.saveContentAdditions(this.state.getContentAdditions().map(c => c.id === id ? { ...c, status: '已發布' } : c));
    }
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

  isReady()     { return typeof google !== 'undefined' && typeof google.accounts !== 'undefined'; }
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
    const today  = new Date();
    const timeMin = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
    const timeMax = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).toISOString();
    const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true&orderBy=startTime`;
    try {
      const res  = await fetch(url, { headers: { Authorization: 'Bearer ' + this._token } });
      if (!res.ok) throw new Error('Calendar API ' + res.status);
      const data = await res.json();
      return (data.items || []).map(ev => ({
        id: ev.id, name: ev.summary || '（無標題）',
        dueDate: (ev.start?.dateTime || ev.start?.date || '').slice(0, 10),
        notes: ev.description || '',
      }));
    } catch (e) { console.warn('GCal fetch error:', e); return []; }
  }

  disconnect() {
    this._connected = false; this._token = null;
    this.state.saveGCalToken(null);
    if (typeof google !== 'undefined') google.accounts.oauth2.revoke(this._token, () => {});
  }
}

/* =====================================================
   5. WeatherWidget — 地理定位 + OpenWeatherMap
   ===================================================== */
class WeatherWidget {
  constructor(stateManager) {
    this._cache_key = 'ddash_weather_cache';
    this.state = stateManager;
  }

  async init() {
    try {
      const cached = JSON.parse(sessionStorage.getItem(this._cache_key) || 'null');
      if (cached && (Date.now() - cached.ts) < 30 * 60 * 1000) { this.render(cached.data); return; }
    } catch {}

    if (!CONFIG.OPENWEATHER_API_KEY) {
      this.renderError('請點右上角 ⚙️ 設定 OpenWeatherMap API Key');
      return;
    }

    // 優先使用手動設定城市
    const savedCity = this.state.getWeatherCity();
    if (savedCity) {
      const data = await this.fetchWeatherByCity(savedCity);
      if (data) { this._cache(data); this.render(data); return; }
    }

    if (!navigator.geolocation) {
      const data = await this.fetchWeatherByIP();
      if (data) { this._cache(data); this.render(data); }
      else this.renderError('無法取得位置');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async pos => {
        const data = await this.fetchWeather(pos.coords.latitude, pos.coords.longitude);
        if (data) { this._cache(data); this.render(data); }
      },
      async () => {
        const data = await this.fetchWeatherByIP();
        if (data) { this._cache(data); this.render(data); }
        else this.renderError('無法取得位置，請允許定位或手動設定城市');
      }
    );
  }

  _cache(data) { sessionStorage.setItem(this._cache_key, JSON.stringify({ ts: Date.now(), data })); }

  async fetchWeather(lat, lon) {
    try {
      const res = await fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${CONFIG.OPENWEATHER_API_KEY}&units=${CONFIG.WEATHER_UNITS}&lang=${CONFIG.WEATHER_LANG}`);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return this._normalize(await res.json());
    } catch (e) { this.renderError('天氣載入失敗：' + e.message); return null; }
  }

  async fetchWeatherByCity(city) {
    // 若未指定國碼，先試 TW（台灣），避免誤抓中國同名城市
    const queries = city.includes(',') ? [city] : [city + ',TW', city];
    for (const q of queries) {
      try {
        const res = await fetch(`https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(q)}&appid=${CONFIG.OPENWEATHER_API_KEY}&units=${CONFIG.WEATHER_UNITS}&lang=${CONFIG.WEATHER_LANG}`);
        if (res.ok) return this._normalize(await res.json());
      } catch {}
    }
    this.renderError('找不到城市，請確認名稱（如 Taoyuan,TW）');
    return null;
  }

  async fetchWeatherByIP() {
    try {
      const geo = await fetch('https://ipapi.co/json/');
      const g   = await geo.json();
      return this.fetchWeather(g.latitude, g.longitude);
    } catch { return null; }
  }

  _normalize(d) {
    return {
      city: d.name, country: d.sys?.country,
      temp: Math.round(d.main.temp), feelsLike: Math.round(d.main.feels_like),
      tempMin: Math.round(d.main.temp_min), tempMax: Math.round(d.main.temp_max),
      humidity: d.main.humidity, windSpeed: d.wind?.speed ?? 0,
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
          <div class="weather-city-control">
            <button class="btn-text" id="weather-city-edit">✏️ 變更城市</button>
          </div>
          <div class="weather-city-input" id="weather-city-input" style="display:none">
            <input type="text" id="weather-city-text" placeholder="如 Taoyuan 或 Taipei,TW" value="${this.state.getWeatherCity() || ''}" />
            <button class="btn-primary" id="weather-city-save">確定</button>
            <button class="btn-secondary" id="weather-city-cancel">✕</button>
          </div>
        </div>
      </div>
      <div class="weather-details">
        <div class="weather-detail"><div class="weather-detail__label">體感溫度</div><div class="weather-detail__value">${data.feelsLike}°C</div></div>
        <div class="weather-detail"><div class="weather-detail__label">濕度</div><div class="weather-detail__value">${data.humidity}%</div></div>
        <div class="weather-detail"><div class="weather-detail__label">最高/最低</div><div class="weather-detail__value">${data.tempMax}°/${data.tempMin}°</div></div>
        <div class="weather-detail"><div class="weather-detail__label">風速</div><div class="weather-detail__value">${data.windSpeed} m/s</div></div>
      </div>
    `;
    this._attachCityListeners();
  }

  _attachCityListeners() {
    document.getElementById('weather-city-edit')?.addEventListener('click', () => {
      document.getElementById('weather-city-input').style.display = '';
    });
    document.getElementById('weather-city-cancel')?.addEventListener('click', () => {
      document.getElementById('weather-city-input').style.display = 'none';
    });
    document.getElementById('weather-city-save')?.addEventListener('click', () => {
      const city = document.getElementById('weather-city-text').value.trim();
      if (!city) return;
      this.state.saveWeatherCity(city);
      this.refresh();
    });
  }

  renderError(msg) {
    const el = document.getElementById('weather-body');
    if (el) el.innerHTML = `<div class="weather-error">⚠️ ${msg}</div>`;
  }

  refresh() {
    sessionStorage.removeItem(this._cache_key);
    const el = document.getElementById('weather-body');
    if (el) el.innerHTML = '<div class="weather-loading"><div class="skeleton-block skeleton-block--lg"></div><div class="skeleton-block skeleton-block--sm"></div></div>';
    this.init();
  }
}

/* =====================================================
   6. UIRenderer — 所有 DOM 操作
   ===================================================== */
class UIRenderer {
  constructor(todoManager, gamificationEngine, stateManager) {
    this.todos  = todoManager;
    this.gamify = gamificationEngine;
    this.state  = stateManager;
  }

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
    const xp     = this.state.getXP();
    const streak = this.state.getStreak();
    const prog   = this.gamify.getLevelProgress(xp);
    const prevLvl= parseInt(document.getElementById('level-num').textContent) || 0;

    this._animateCounter(document.getElementById('xp-total'), xp);
    document.getElementById('level-num').textContent    = prog.level;
    document.getElementById('streak-count').textContent = streak.current;
    document.getElementById('xp-bar-fill').style.width  = prog.pct + '%';
    document.getElementById('xp-bar-text').textContent  =
      prog.next ? `${prog.current} / ${prog.next} XP` : 'MAX LEVEL';

    if (prog.level > prevLvl && prevLvl > 0) this.showLevelUp(prog.level);
  }

  _animateCounter(el, target) {
    if (!el) return;
    const start    = parseInt(el.textContent.replace(/,/g, '')) || 0;
    if (start === target) { el.textContent = target.toLocaleString(); return; }
    const duration = 600;
    const startTime = performance.now();
    const tick = (now) => {
      const t    = Math.min(1, (now - startTime) / duration);
      const ease = t < 0.5 ? 2*t*t : -1+(4-2*t)*t;
      el.textContent = Math.round(start + (target - start) * ease).toLocaleString();
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  renderProgress(allTodos) {
    const total = allTodos.length;
    const done  = allTodos.filter(t => t.completed).length;
    const pct   = total > 0 ? Math.round(done / total * 100) : 0;
    document.getElementById('progress-fill').style.width = pct + '%';
    document.getElementById('progress-fraction').textContent = `${done} / ${total}`;
  }

  renderNews(dailyData) {
    const el   = document.getElementById('news-body');
    const meta = document.getElementById('news-updated');
    if (!el) return;

    const feeds = dailyData?.rss_news ?? [];
    if (!feeds.length) {
      el.innerHTML = '<div class="empty-state">尚無新聞，請設定 RSS_FEED_URLS Secret</div>';
      return;
    }

    if (dailyData?.meta?.generated_at && meta) {
      const t = new Date(dailyData.meta.generated_at).toLocaleString('zh-TW', { hour: '2-digit', minute: '2-digit' });
      meta.textContent = '更新於 ' + t;
    }

    const slidesHTML = feeds.map(feed => `
      <div class="news-carousel__slide">
        <div class="news-carousel__feed-name">${this._esc(feed.feed_name)}</div>
        <ul class="news-carousel__items">
          ${(feed.items || []).slice(0, 5).map(item => `
            <li class="news-carousel__item">
              <a href="${this._esc(item.link)}" target="_blank" rel="noopener">${this._esc(item.title)}</a>
              ${item.published ? `<span class="news-carousel__meta">${this._relTime(item.published)}</span>` : ''}
            </li>
          `).join('')}
        </ul>
      </div>
    `).join('');

    const dotsHTML = feeds.map((_, i) =>
      `<div class="news-carousel__dot${i === 0 ? ' news-carousel__dot--active' : ''}" data-idx="${i}"></div>`
    ).join('');

    el.innerHTML = `
      <div class="news-carousel">
        <button class="news-carousel__arrow news-carousel__arrow--prev" id="news-prev" aria-label="上一個">&#8249;</button>
        <div class="news-carousel__track" id="news-carousel-track">${slidesHTML}</div>
        <button class="news-carousel__arrow news-carousel__arrow--next" id="news-next" aria-label="下一個">&#8250;</button>
      </div>
      <div class="news-carousel__dots" id="news-carousel-dots">${dotsHTML}</div>
    `;
    this._initNewsCarousel();
  }

  _initNewsCarousel() {
    const track = document.getElementById('news-carousel-track');
    const dots  = [...document.querySelectorAll('.news-carousel__dot')];
    if (!track || track.children.length === 0) return;

    const origCount = track.children.length;
    if (origCount > 1) {
      // 首尾各插入一個 clone，實現無縫循環
      track.insertBefore(track.children[origCount - 1].cloneNode(true), track.children[0]);
      track.appendChild(track.children[1].cloneNode(true)); // children[1] = real first (after prepend)
      // 跳到真正的第一張（index 1）
      track.style.scrollBehavior = 'auto';
      track.scrollLeft = track.offsetWidth;
      track.style.scrollBehavior = '';
    }

    const realCount  = origCount;
    const getVisIdx  = () => Math.round(track.scrollLeft / (track.offsetWidth || 1));
    const getRealIdx = () => Math.max(0, Math.min(realCount - 1, getVisIdx() - 1));

    const updateDots = () => {
      const r = getRealIdx();
      dots.forEach((d, i) => d.classList.toggle('news-carousel__dot--active', i === r));
    };

    const goTo = (visIdx) => {
      track.scrollTo({ left: visIdx * track.offsetWidth, behavior: 'smooth' });
    };

    // 滾動後偵測是否到 clone，靜默跳回真實位置
    let jumping = false, scrollTimer;
    track.addEventListener('scroll', () => {
      if (jumping) return;
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        const vi = getVisIdx();
        if (vi === 0) {
          jumping = true;
          track.style.scrollBehavior = 'auto';
          track.scrollLeft = realCount * track.offsetWidth;
          track.style.scrollBehavior = '';
          requestAnimationFrame(() => { jumping = false; updateDots(); });
        } else if (vi === realCount + 1) {
          jumping = true;
          track.style.scrollBehavior = 'auto';
          track.scrollLeft = track.offsetWidth;
          track.style.scrollBehavior = '';
          requestAnimationFrame(() => { jumping = false; updateDots(); });
        } else {
          updateDots();
        }
      }, 120);
    }, { passive: true });

    document.getElementById('news-prev')?.addEventListener('click', () => goTo(getVisIdx() - 1));
    document.getElementById('news-next')?.addEventListener('click', () => goTo(getVisIdx() + 1));
    dots.forEach((d, i) => d.addEventListener('click', () => goTo(i + 1)));

    // 無自動輪播，僅手動操作
  }

  renderTodos(allTodos) {
    const sortMode  = this.state.getTodoSort();
    const active    = this.todos.sortTodos(this.todos.getActiveTodos(allTodos), sortMode);
    const completed = this.todos.getCompletedTodos(allTodos);

    const listEl    = document.getElementById('todo-list');
    const emptyEl   = document.getElementById('todo-empty');
    const compList  = document.getElementById('completed-list');
    const compEmpty = document.getElementById('completed-empty');
    const compCount = document.getElementById('completed-count');
    if (!listEl) return;

    const todayStr    = new Date().toLocaleDateString('sv-SE');
    const overdueCount = active.filter(t => t.dueDate && t.dueDate < todayStr).length;

    const titleEl = document.querySelector('#todos-card .card__title');
    if (titleEl) {
      titleEl.innerHTML = `📋 今日代辦${overdueCount > 0 ? ` <span class="badge badge--high overdue-count">⚠️ ${overdueCount} 逾期</span>` : ''}`;
    }

    if (active.length === 0) {
      listEl.innerHTML = '';
      if (emptyEl) emptyEl.style.display = '';
    } else {
      if (emptyEl) emptyEl.style.display = 'none';
      listEl.innerHTML = active.map(t => this._todoItemHTML(t, false)).join('');
    }

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
    const todayStr = new Date().toLocaleDateString('sv-SE');
    const overdue   = !isCompleted && todo.dueDate && todo.dueDate < todayStr;
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

  renderContentItems(contentItems, filterPlatform = 'all') {
    const kanbanEl   = document.getElementById('content-kanban');
    const progressEl = document.getElementById('content-progress');
    if (!kanbanEl) return;

    const filtered  = filterPlatform === 'all' ? contentItems : contentItems.filter(c => c.platform === filterPlatform);
    const published = filtered.filter(c => c.status === '已發布' || c.status === 'Published').length;
    if (progressEl) progressEl.textContent = `📊 ${published} / ${filtered.length} 已發布`;

    const STATUSES = ['構思中', '準備中', '拍攝中', '剪輯中', '已發布'];
    const STATUS_CLASS = {
      '構思中': 'thinking', '準備中': 'planned', '拍攝中': 'progress',
      '剪輯中': 'filmed', '已發布': 'published',
    };

    kanbanEl.innerHTML = STATUSES.map(status => {
      const items = filtered.filter(c => c.status === status || (status === '已發布' && c.status === 'Published'));
      return `
        <div class="kanban-col" data-status="${status}">
          <div class="kanban-col__header">
            <span class="kanban-col__title">${status}</span>
            <span class="kanban-col__count">${items.length}</span>
          </div>
          <div class="kanban-col__items">
            ${items.length === 0 ? '<div class="kanban-col__empty">空</div>' : ''}
            ${items.map(c => `
              <div class="kanban-item" data-cid="${c.id}" draggable="true">
                <div class="kanban-item__topic kanban-item__topic--link"
                     data-action="open-detail" data-cid="${c.id}">${this._esc(c.topic)}</div>
                <div class="kanban-item__meta">
                  ${c.plannedDate ? `<span class="kanban-item__date">📅 ${c.plannedDate}</span>` : ''}
                  <span class="platform-badge">${this._esc(c.platform || '')}</span>
                </div>
                <div class="kanban-item__actions">
                  <button class="content-status content-status--${STATUS_CLASS[c.status] || 'thinking'}"
                          data-action="cycle-status" data-cid="${c.id}">${c.status} ▸</button>
                  ${c.source === 'manual' ? `<button class="btn-delete" data-action="content-delete" data-cid="${c.id}" title="刪除">✕</button>` : ''}
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }).join('');
  }

  openContentDetail(item, note) {
    const modal = document.getElementById('content-detail-modal');
    if (!modal) return;
    document.getElementById('cd-title').value    = item.topic || '';
    document.getElementById('cd-platform').value = item.platform || '';
    document.getElementById('cd-date').value     = item.plannedDate || '';
    document.getElementById('cd-status').textContent = item.status || '構思中';
    document.getElementById('cd-notes').value    = note || '';
    document.getElementById('cd-save').dataset.cid = item.id;
    modal.style.display = 'flex';
    setTimeout(() => document.getElementById('cd-notes')?.focus(), 100);
  }

  renderAchievements() {
    const earned = new Set(this.state.getAchievements());
    const el = document.getElementById('achievements-grid');
    if (!el) return;
    // 顯示前 8 個（先顯示已解鎖的）
    const sorted = [...this.gamify.ACHIEVEMENTS].sort((a, b) => (earned.has(b.id) ? 1 : 0) - (earned.has(a.id) ? 1 : 0));
    el.innerHTML = sorted.slice(0, 8).map(a => this._achBadgeHTML(a, earned)).join('');
  }

  _achBadgeHTML(a, earned) {
    return `<div class="achievement-badge${earned.has(a.id) ? '' : ' achievement-badge--locked'}" title="${this._esc(a.desc)}">
      <span class="achievement-badge__icon">${a.icon}</span>
      <span class="achievement-badge__name">${a.name}</span>
    </div>`;
  }

  showAchievementsModal() {
    const earned = new Set(this.state.getAchievements());
    const sorted = [...this.gamify.ACHIEVEMENTS].sort((a, b) => (earned.has(b.id) ? 1 : 0) - (earned.has(a.id) ? 1 : 0));
    const earnedCount = [...earned].length;
    const modal = document.getElementById('achievements-modal');
    const grid  = document.getElementById('achievements-modal-grid');
    const count = document.getElementById('achievements-modal-count');
    if (!modal || !grid) return;
    if (count) count.textContent = `${earnedCount} / ${this.gamify.ACHIEVEMENTS.length} 已解鎖`;
    grid.innerHTML = sorted.map(a => this._achBadgeHTML(a, earned)).join('');
    modal.style.display = 'flex';
  }

  /* Achievement animations */
  showAchievementBanner(ach) {
    document.querySelector('.achievement-banner')?.remove();
    const banner = document.createElement('div');
    banner.className = 'achievement-banner';
    banner.innerHTML = `
      <span class="achievement-banner__icon">${ach.icon}</span>
      <div>
        <div style="opacity:0.75;font-size:0.45rem;margin-bottom:4px;">🏆 成就解鎖！</div>
        <strong>${ach.name}</strong>
        <div style="opacity:0.75;font-size:0.45rem;margin-top:4px;">${ach.desc}</div>
      </div>
    `;
    document.body.appendChild(banner);
    requestAnimationFrame(() => requestAnimationFrame(() => banner.classList.add('achievement-banner--in')));
    setTimeout(() => { banner.classList.remove('achievement-banner--in'); banner.classList.add('achievement-banner--out'); }, 3200);
    setTimeout(() => banner.remove(), 3700);
    if (navigator.vibrate) navigator.vibrate(200);
  }

  triggerScreenFlash() {
    const el = document.createElement('div');
    el.className = 'screen-flash';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 450);
  }

  spawnConfetti(originEl) {
    const rect   = originEl?.getBoundingClientRect() ?? { top: window.innerHeight * 0.4, left: window.innerWidth / 2, width: 0 };
    const colors = ['#5B8DEF','#F5C842','#6DC86B','#F0A8C6','#FF6B6B','#A78BFA','#FFCF40'];
    const cx = rect.left + rect.width / 2;
    const cy = rect.top;
    for (let i = 0; i < 32; i++) {
      const p = document.createElement('div');
      p.className = 'confetti-particle';
      const speed  = 80 + Math.random() * 160;
      const dirX   = (Math.random() - 0.5) * 2;
      const dirY   = -(0.6 + Math.random() * 0.4);
      p.style.cssText = `
        left:${cx}px; top:${cy}px;
        background:${colors[i % colors.length]};
        --dx:${dirX * speed}px;
        --dy:${dirY * speed}px;
        --rot:${Math.random() * 720}deg;
        animation-delay:${Math.random() * 0.15}s;
        width:${6 + Math.random() * 6}px; height:${6 + Math.random() * 6}px;
      `;
      document.body.appendChild(p);
      setTimeout(() => p.remove(), 2200);
    }
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
    document.getElementById('levelup-overlay').style.display = 'flex';
  }

  updateGCalButton(connected) {
    const btn  = document.getElementById('gcal-btn');
    const text = document.getElementById('gcal-btn-text');
    if (!btn || !text) return;
    if (connected) { text.textContent = '📅 日曆已連結'; btn.classList.add('btn-secondary--active'); }
    else           { text.textContent = '📅 連結 Google 日曆'; btn.classList.remove('btn-secondary--active'); }
  }

  _esc(str)            { return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  _priorityLabel(p)    { return p === 'High' ? '高' : p === 'Low' ? '低' : '中'; }
  _sourceLabel(s)      { return s === 'notion' ? 'Notion' : s === 'gcal' ? '日曆' : '手動'; }
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
    this.state      = stateManager;
    this.FILE       = 'daily-dashboard-state.json';
    this.PAT_KEY    = 'ddash_gist_pat';
    this.GIST_KEY   = 'ddash_gist_id';
    this.SYNCED_KEY = 'ddash_gist_synced_at';
    this._pat       = localStorage.getItem(this.PAT_KEY) || '';
    this._gistId    = localStorage.getItem(this.GIST_KEY) || '';
    this._pushTimer = null;
  }

  isConfigured() { return !!this._pat; }
  _headers()     { return { Authorization: `token ${this._pat}`, 'Content-Type': 'application/json' }; }

  _snapshot() {
    return {
      manual_todos:      this.state.getManualTodos(),
      completions:       this.state.getCompletions(),
      xp:                this.state.getXP(),
      streak:            this.state.getStreak(),
      achievements:      this.state.getAchievements(),
      content_additions: this.state.getContentAdditions(),
      content_overrides: this.state.getContentOverrides(),
      synced_at:         new Date().toISOString(),
    };
  }

  _applySnapshot(data, app) {
    if (data.manual_todos)      this.state.saveManualTodos(data.manual_todos);
    if (data.completions)       this.state.saveCompletions(data.completions);
    if (typeof data.xp === 'number') this.state.saveXP(data.xp);
    if (data.streak)            this.state.saveStreak(data.streak);
    if (data.achievements)      this.state.saveAchievements(data.achievements);
    if (data.content_additions) this.state.saveContentAdditions(data.content_additions);
    if (data.content_overrides) this.state.saveContentOverrides(data.content_overrides);
    app._refreshTodos();
    app._refreshContent();
    app.renderer.renderGamification();
    app.renderer.renderAchievements();
  }

  refreshStatusBadge() {
    const el = document.getElementById('sync-status-text');
    if (!el) return;
    const t = localStorage.getItem(this.SYNCED_KEY);
    if (!t) { el.textContent = '未同步'; return; }
    const diff = Math.round((Date.now() - new Date(t)) / 60000);
    el.textContent = diff < 1 ? '剛剛同步' : `${diff} 分鐘前`;
  }

  async connect(pat) {
    try {
      const res = await fetch('https://api.github.com/user', { headers: { Authorization: `token ${pat}` } });
      if (!res.ok) return false;
      this._pat = pat;
      localStorage.setItem(this.PAT_KEY, pat);
      return true;
    } catch { return false; }
  }

  disconnect() {
    this._pat = ''; this._gistId = '';
    localStorage.removeItem(this.PAT_KEY);
    localStorage.removeItem(this.GIST_KEY);
    localStorage.removeItem(this.SYNCED_KEY);
  }

  async push() {
    if (!this._pat) return;
    const body = {
      description: 'daily-dashboard-state', public: false,
      files: { [this.FILE]: { content: JSON.stringify(this._snapshot(), null, 2) } },
    };
    try {
      let res;
      if (this._gistId) {
        res = await fetch(`https://api.github.com/gists/${this._gistId}`, { method: 'PATCH', headers: this._headers(), body: JSON.stringify(body) });
      } else {
        res = await fetch('https://api.github.com/gists', { method: 'POST', headers: this._headers(), body: JSON.stringify(body) });
        if (res.ok) { const g = await res.json(); this._gistId = g.id; localStorage.setItem(this.GIST_KEY, g.id); }
      }
      if (res.ok) { localStorage.setItem(this.SYNCED_KEY, new Date().toISOString()); this.refreshStatusBadge(); }
    } catch(e) { console.warn('Gist push error:', e); }
  }

  schedulePush() { clearTimeout(this._pushTimer); this._pushTimer = setTimeout(() => this.push(), 2000); }

  async pull(app) {
    if (!this._pat) return false;
    try {
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
      if (data.synced_at) { localStorage.setItem(this.SYNCED_KEY, data.synced_at); this.refreshStatusBadge(); }
      return true;
    } catch(e) { console.warn('Gist pull error:', e); return false; }
  }

  refreshModal() {
    const configured = this.isConfigured();
    document.getElementById('sync-setup-panel').style.display     = configured ? 'none' : '';
    document.getElementById('sync-connected-panel').style.display = configured ? '' : 'none';
    if (configured) {
      const t = localStorage.getItem(this.SYNCED_KEY);
      document.getElementById('sync-last-time').textContent = t ? '上次同步：' + new Date(t).toLocaleString('zh-TW') : '尚未同步';
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
    this.stateManager   = new StateManager();
    this.gamify         = new GamificationEngine(this.stateManager);
    this.todoManager    = new TodoManager(this.stateManager, this.gamify);
    this.calClient      = new CalendarClient(this.stateManager);
    this.weather        = new WeatherWidget(this.stateManager);
    this.renderer       = new UIRenderer(this.todoManager, this.gamify, this.stateManager);
    this.gistSync       = new GistSyncManager(this.stateManager);
    this._gcalEvents    = [];
    this._allTodos      = [];
    this._contentFilter = 'all';
  }

  async init() {
    this.renderer.renderHeader();
    this._renderDailyQuote();

    const dailyData = await this.todoManager.loadDailyData();
    if (this.gistSync.isConfigured()) await this.gistSync.pull(this);
    this.gistSync.refreshStatusBadge();

    // GCal：嘗試同步恢復（等 GIS 載入最多 5 秒）
    this._autoConnectGCal();

    this._refreshTodos();
    this.renderer.renderNews(dailyData);
    this.renderer.renderAchievements();
    this.renderer.renderGamification();
    this.weather.init();

    this._attachListeners();
    this._injectDecorativeElements();
  }

  async _autoConnectGCal() {
    // 等待 GIS 載入（最多 5 秒）
    for (let i = 0; i < 25; i++) {
      if (this.calClient.isReady()) break;
      await new Promise(r => setTimeout(r, 200));
    }
    this.calClient.init();
    this.renderer.updateGCalButton(this.calClient.isConnected());
    if (this.calClient.isConnected()) {
      this._gcalEvents = await this.calClient.fetchTodayEvents();
      this._refreshTodos();
    }
  }

  _renderDailyQuote() {
    const el = document.getElementById('daily-quote');
    if (!el) return;
    const now = new Date();
    const idx = (now.getDate() + now.getMonth() * 31) % DAILY_QUOTES.length;
    el.textContent = '💬 ' + DAILY_QUOTES[idx];
  }

  _refreshTodos() {
    this._allTodos = this.todoManager.mergeAllTodos(this._gcalEvents);
    this.renderer.renderTodos(this._allTodos);
    this.renderer.renderProgress(this._allTodos);
    this.renderer.renderAchievements();
    this.renderer.renderGamification();

    // 完美一天追蹤
    const done  = this._allTodos.filter(t => t.completed).length;
    const total = this._allTodos.length;
    if (total > 0 && done === total) {
      const today      = new Date().toLocaleDateString('sv-SE');
      const lastPerfect = localStorage.getItem('ddash_last_perfect_day');
      if (lastPerfect !== today) {
        localStorage.setItem('ddash_last_perfect_day', today);
        this.stateManager.savePerfectDays(this.stateManager.getPerfectDays() + 1);
      }
    }

    const stats   = this._buildStats();
    const newAchs = this.gamify.checkAchievements(stats);
    for (const a of newAchs) {
      setTimeout(() => {
        this.renderer.showAchievementBanner(a);
        this.renderer.triggerScreenFlash();
        this.renderer.spawnConfetti(document.getElementById('achievements-grid'));
      }, 500);
    }
    this.gistSync.schedulePush();
  }

  _refreshContent() {
    const items = this.todoManager.mergeContentItems();
    this.renderer.renderContentItems(items, this._contentFilter);
    this.gistSync.schedulePush();
  }

  _buildStats() {
    const done  = this._allTodos.filter(t => t.completed);
    const total = this._allTodos.length;
    const noon  = new Date(); noon.setHours(12, 0, 0, 0);
    const morn  = new Date(); morn.setHours(9, 0, 0, 0);
    const tenpm = new Date(); tenpm.setHours(22, 0, 0, 0);
    const midn  = new Date(); midn.setHours(4, 0, 0, 0);

    const notionContent = this.todoManager.getDailyData()?.notion_content ?? [];
    const manualContent = this.stateManager.getContentAdditions();
    const overrides     = this.stateManager.getContentOverrides();
    const allContent    = [
      ...notionContent.map(c => { const id = 'notion_c_' + c.id; return { ...c, status: overrides[id] || c.status }; }),
      ...manualContent.map(c => ({ ...c, status: overrides[c.id] || c.status })),
    ];
    const videosDone       = allContent.filter(c => c.status === '已發布' || c.status === 'Published').length;
    const contentPlatforms = new Set(allContent.filter(c => c.status === '已發布' || c.status === 'Published').map(c => c.platform)).size;
    const xp    = this.stateManager.getXP();
    const level = this.gamify.getLevel(xp);

    return {
      totalCompleted:         done.length,
      totalActive:            total,
      completedBeforeNoon:    done.filter(t => t.completedAt && new Date(t.completedAt) < noon).length,
      completedBeforeMorning: done.filter(t => t.completedAt && new Date(t.completedAt) < morn).length,
      completedAfterTenPm:    done.filter(t => t.completedAt && new Date(t.completedAt) >= tenpm).length,
      completedAfterMidnight: done.filter(t => t.completedAt && new Date(t.completedAt) < midn).length,
      highPriorityDone:       done.filter(t => t.priority === 'High').length,
      streak:                 this.stateManager.getStreak(),
      dailyPct:               total > 0 ? Math.round(done.length / total * 100) : 0,
      perfectDayCount:        this.stateManager.getPerfectDays(),
      videosDone,
      contentPlatforms,
      xp,
      level,
    };
  }

  _attachListeners() {
    // 新增代辦
    document.getElementById('add-todo-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const name     = document.getElementById('todo-input').value.trim();
      const deadline = document.getElementById('todo-deadline').value;
      const priority = document.getElementById('todo-priority').value;
      if (!name) return;
      this.todoManager.addManualTodo(name, deadline, priority);
      document.getElementById('todo-input').value    = '';
      document.getElementById('todo-deadline').value = '';
      this._refreshTodos();
      this.renderer.showToast('代辦已新增！', 'success');
    });

    // 新增影片題材
    document.getElementById('add-content-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const topic    = document.getElementById('content-topic-input').value.trim();
      const date     = document.getElementById('content-date-input').value;
      const platform = document.getElementById('content-platform-input').value;
      if (!topic) return;
      this.todoManager.addContentItem(topic, date, platform);
      document.getElementById('content-topic-input').value = '';
      document.getElementById('content-date-input').value  = '';
      this._refreshContent();
      this.renderer.showToast('題材已新增！', 'success');
    });

    // 代辦/內容委派事件
    document.addEventListener('click', (e) => {
      const action = e.target.dataset.action;
      const id     = e.target.dataset.id;
      const cid    = e.target.dataset.cid;

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

      if (action === 'cycle-status' && cid) {
        this.todoManager.cycleContentStatus(cid);
        this._refreshContent();
        const stats   = this._buildStats();
        const newAchs = this.gamify.checkAchievements(stats);
        for (const a of newAchs) {
          setTimeout(() => {
            this.renderer.showAchievementBanner(a);
            this.renderer.triggerScreenFlash();
            this.renderer.spawnConfetti(document.getElementById('achievements-grid'));
          }, 500);
        }
        this.renderer.renderGamification();
        this.renderer.renderAchievements();
      }

      if (action === 'content-delete' && cid) {
        this.todoManager.removeContentItem(cid);
        this._refreshContent();
        this.renderer.showToast('題材已刪除');
      }

      if (action === 'open-detail' && cid) {
        const items = this.todoManager.mergeContentItems();
        const item  = items.find(c => c.id === cid);
        if (item) {
          const note = this.stateManager.getContentNotes()[cid] || '';
          this.renderer.openContentDetail(item, note);
        }
      }
    });

    // 影片詳細視窗儲存/關閉
    const closeDetail = () => { document.getElementById('content-detail-modal').style.display = 'none'; };
    document.getElementById('content-detail-modal')?.addEventListener('click', (e) => {
      if (e.target.id === 'content-detail-modal') closeDetail();
    });
    document.getElementById('cd-close')?.addEventListener('click', closeDetail);
    document.getElementById('cd-save')?.addEventListener('click', () => {
      const cid      = document.getElementById('cd-save').dataset.cid;
      const newTopic = document.getElementById('cd-title').value.trim();
      const newDate  = document.getElementById('cd-date').value;
      const note     = document.getElementById('cd-notes').value;
      if (!cid) return;
      // 儲存筆記
      this.stateManager.saveContentNote(cid, note);
      // 若是手動新增，更新 topic & date
      if (cid.startsWith('manual_c_')) {
        this.stateManager.saveContentAdditions(
          this.stateManager.getContentAdditions().map(c =>
            c.id === cid ? { ...c, topic: newTopic || c.topic, plannedDate: newDate || c.plannedDate } : c
          )
        );
      }
      this._refreshContent();
      this.gistSync.schedulePush();
      closeDetail();
      this.renderer.showToast('已儲存 ✅', 'success');
    });

    // Platform filter
    document.getElementById('content-filters')?.addEventListener('click', (e) => {
      const btn = e.target.closest('.content-filter');
      if (!btn) return;
      document.querySelectorAll('.content-filter').forEach(b => b.classList.remove('content-filter--active'));
      btn.classList.add('content-filter--active');
      this._contentFilter = btn.dataset.platform;
      this._refreshContent();
    });

    // Google 日曆
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
    document.getElementById('weather-refresh')?.addEventListener('click', () => this.weather.refresh());

    // Todo 排序
    const sortEl = document.getElementById('todo-sort');
    if (sortEl) {
      sortEl.value = this.stateManager.getTodoSort();
      sortEl.addEventListener('change', (e) => {
        this.stateManager.saveTodoSort(e.target.value);
        this._refreshTodos();
      });
    }

    // 清除已完成
    document.getElementById('clear-completed-btn')?.addEventListener('click', () => {
      const completed   = this.todoManager.getCompletedTodos(this._allTodos);
      const completions = this.stateManager.getCompletions();
      completed.filter(t => t.source === 'manual').forEach(t => this.todoManager.removeManualTodo(t.id));
      completed.forEach(t => { delete completions[t.id]; });
      this.stateManager.saveCompletions(completions);
      this._refreshTodos();
      this.renderer.showToast('已清除全部完成項目');
    });

    // 完成區展開/收合
    const completedToggle = document.getElementById('completed-toggle');
    completedToggle?.addEventListener('click', () => {
      const list    = document.getElementById('completed-list');
      const chevron = document.getElementById('completed-chevron');
      const hidden  = list.style.display === 'none';
      list.style.display = hidden ? '' : 'none';
      chevron.classList.toggle('completed-chevron--up', hidden);
    });
    completedToggle?.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') completedToggle.click(); });

    // 升等
    document.getElementById('levelup-close')?.addEventListener('click', () => { document.getElementById('levelup-overlay').style.display = 'none'; });
    document.getElementById('levelup-overlay')?.addEventListener('click', (e) => {
      if (e.target.id === 'levelup-overlay') document.getElementById('levelup-overlay').style.display = 'none';
    });

    // 成就查看全部 Modal
    document.getElementById('achievements-toggle')?.addEventListener('click', () => {
      this.renderer.showAchievementsModal();
    });
    const closeAchModal = () => { document.getElementById('achievements-modal').style.display = 'none'; };
    document.getElementById('achievements-modal-close')?.addEventListener('click', closeAchModal);
    document.getElementById('achievements-modal')?.addEventListener('click', (e) => { if (e.target.id === 'achievements-modal') closeAchModal(); });

    // ⚙️ 設定 Modal（整合 Gist 自動同步設定）
    const openSettings  = () => {
      document.getElementById('settings-owm-input').value  = localStorage.getItem('ddash_owm_key') || '';
      document.getElementById('settings-gcal-input').value = localStorage.getItem('ddash_gcal_client_id') || '';
      document.getElementById('settings-hint').textContent = '';
      this._refreshGistSettingsPanel();
      document.getElementById('settings-overlay').style.display = 'flex';
    };
    const closeSettings = () => { document.getElementById('settings-overlay').style.display = 'none'; };
    document.getElementById('settings-btn')?.addEventListener('click', openSettings);
    document.getElementById('settings-close-btn')?.addEventListener('click', closeSettings);
    document.getElementById('settings-overlay')?.addEventListener('click', (e) => { if (e.target.id === 'settings-overlay') closeSettings(); });
    document.getElementById('settings-save-btn')?.addEventListener('click', () => {
      const owm  = document.getElementById('settings-owm-input').value.trim();
      const gcal = document.getElementById('settings-gcal-input').value.trim();
      if (owm)  localStorage.setItem('ddash_owm_key', owm);
      if (gcal) localStorage.setItem('ddash_gcal_client_id', gcal);
      closeSettings();
      this.renderer.showToast('設定已儲存 ✅', 'success');
      if (owm) this.weather.refresh();
      if (gcal) this._autoConnectGCal();
    });

    // Gist 自動同步（整合在 settings 內）
    document.getElementById('gist-connect-btn')?.addEventListener('click', async () => {
      const pat = document.getElementById('gist-pat-input').value.trim();
      if (!pat) return;
      document.getElementById('gist-hint').textContent = '連結中…';
      const ok = await this.gistSync.connect(pat);
      if (ok) {
        await this.gistSync.pull(this);
        this._refreshGistSettingsPanel();
        this.renderer.showToast('跨裝置自動同步已啟用 ✅', 'success');
      } else {
        document.getElementById('gist-hint').textContent = '❌ Token 無效，請確認已勾選 gist 權限';
      }
    });
    document.getElementById('gist-disconnect-btn')?.addEventListener('click', () => {
      this.gistSync.disconnect();
      this._refreshGistSettingsPanel();
      this.renderer.showToast('已停用自動同步');
    });

    // 行動版底部導覽
    document.querySelectorAll('.mobile-nav__item').forEach(btn => {
      btn.addEventListener('click', () => {
        const el = document.getElementById(btn.dataset.target);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });

    // 吉祥物點擊揮手
    document.addEventListener('click', (e) => {
      if (e.target.closest('.pixel-mascot')) {
        const m = document.querySelector('.pixel-mascot');
        if (m) {
          m.classList.remove('pixel-mascot--wave');
          void m.offsetWidth;
          m.classList.add('pixel-mascot--wave');
          setTimeout(() => m.classList.remove('pixel-mascot--wave'), 700);
          this.renderer.showToast('嗨！繼續加油 🤖', 'success');
        }
      }
    });

    // 鍵盤快捷鍵
    document.addEventListener('keydown', (e) => {
      if (['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) {
        if (e.key === 'Escape') e.target.blur();
        return;
      }
      if (e.key === 'n') { e.preventDefault(); document.getElementById('todo-input')?.focus(); }
      if (e.key === 'Escape') {
        document.getElementById('sync-overlay').style.display     = 'none';
        document.getElementById('settings-overlay').style.display = 'none';
        document.getElementById('levelup-overlay').style.display  = 'none';
      }
    });

    this._initTodoSwipe();
    this._initPullToRefresh();
    this._initKanbanDrag();

    if (!CONFIG.OPENWEATHER_API_KEY && !CONFIG.GOOGLE_CLIENT_ID) {
      setTimeout(() => this.renderer.showToast('首次使用請點 ⚙️ 填入 API 金鑰', 'error'), 1200);
    }
  }

  _refreshGistSettingsPanel() {
    const configured = this.gistSync.isConfigured();
    const setupEl    = document.getElementById('gist-setup');
    const statusEl   = document.getElementById('gist-status');
    if (setupEl)  setupEl.style.display  = configured ? 'none' : '';
    if (statusEl) statusEl.style.display = configured ? '' : 'none';
    if (configured) {
      const t = localStorage.getItem('ddash_gist_synced_at');
      const timeEl = document.getElementById('gist-last-sync');
      if (timeEl) timeEl.textContent = t ? '上次同步：' + new Date(t).toLocaleString('zh-TW') : '尚未同步';
    }
    this.gistSync.refreshStatusBadge();
  }

  _initTodoSwipe() {
    // 已停用左右滑動手勢（改用按鈕操作）
  }

  _initKanbanDrag() {
    const kanban = document.getElementById('content-kanban');
    if (!kanban) return;

    // 阻止長壓觸發瀏覽器右鍵選單 / 文字選取框
    kanban.addEventListener('contextmenu', e => e.preventDefault());

    let dragCid = null;

    /* ── Desktop: HTML5 drag & drop ── */
    kanban.addEventListener('dragstart', e => {
      const item = e.target.closest('.kanban-item');
      if (!item) return;
      dragCid = item.dataset.cid;
      e.dataTransfer.effectAllowed = 'move';
      item.classList.add('kanban-item--dragging');
    });
    kanban.addEventListener('dragend', () => {
      dragCid = null;
      kanban.querySelectorAll('.kanban-item--dragging, .kanban-col--drag-over')
        .forEach(el => el.classList.remove('kanban-item--dragging', 'kanban-col--drag-over'));
    });
    kanban.addEventListener('dragover', e => {
      e.preventDefault();
      const col = e.target.closest('.kanban-col');
      kanban.querySelectorAll('.kanban-col--drag-over').forEach(el => el.classList.remove('kanban-col--drag-over'));
      if (col) col.classList.add('kanban-col--drag-over');
    });
    kanban.addEventListener('drop', e => {
      e.preventDefault();
      const col = e.target.closest('.kanban-col');
      if (!col || !dragCid) return;
      const newStatus = col.dataset.status;
      if (newStatus) {
        this.todoManager.setContentStatus(dragCid, newStatus);
        this._refreshContent();
        this.gistSync.schedulePush();
      }
    });

    /* ── Mobile: long-press (350ms) to drag，短按不干擾橫向滾動 ── */
    let touchCid = null, touchGhost = null, touchSrc = null;
    let longPressTimer = null, dragActive = false;

    const cancelTouchDrag = () => {
      clearTimeout(longPressTimer); longPressTimer = null;
      if (touchGhost) { touchGhost.remove(); touchGhost = null; }
      if (touchSrc)   { touchSrc.style.visibility = ''; touchSrc = null; }
      kanban.querySelectorAll('.kanban-col--drag-over').forEach(el => el.classList.remove('kanban-col--drag-over'));
      touchCid = null; dragActive = false;
    };

    kanban.addEventListener('touchstart', e => {
      const item = e.target.closest('.kanban-item');
      if (!item) return;
      touchCid = item.dataset.cid;
      touchSrc = item;
      longPressTimer = setTimeout(() => {
        dragActive = true;
        const rect = item.getBoundingClientRect();
        touchGhost = item.cloneNode(true);
        Object.assign(touchGhost.style, {
          position: 'fixed', left: rect.left + 'px', top: rect.top + 'px',
          width: rect.width + 'px', opacity: '0.9', pointerEvents: 'none',
          zIndex: '9999', transform: 'scale(1.05)',
          boxShadow: '0 8px 24px rgba(0,0,0,0.25)', transition: 'none',
        });
        document.body.appendChild(touchGhost);
        item.style.visibility = 'hidden';
      }, 350);
    }, { passive: true });

    kanban.addEventListener('touchmove', e => {
      if (!dragActive || !touchGhost) return;
      e.preventDefault(); // 拖曳中接管滾動，阻止瀏覽器原生橫滑

      const t = e.touches[0];
      touchGhost.style.left = (t.clientX - touchGhost.offsetWidth / 2) + 'px';
      touchGhost.style.top  = (t.clientY - 30) + 'px';

      // 偵測目標欄位
      touchGhost.style.display = 'none';
      const under = document.elementFromPoint(t.clientX, t.clientY);
      touchGhost.style.display = '';
      const col = under?.closest('.kanban-col');
      kanban.querySelectorAll('.kanban-col--drag-over').forEach(el => el.classList.remove('kanban-col--drag-over'));
      if (col) col.classList.add('kanban-col--drag-over');

      // 邊緣自動滾動：手指靠近左右邊緣時滾動面板
      const rect = kanban.getBoundingClientRect();
      const edge = 72; // px，邊緣感應區
      const speed = 10; // px per event
      if (t.clientX < rect.left + edge) {
        kanban.scrollLeft -= speed;
      } else if (t.clientX > rect.right - edge) {
        kanban.scrollLeft += speed;
      }
    }, { passive: false });

    kanban.addEventListener('touchend', e => {
      clearTimeout(longPressTimer); longPressTimer = null;
      if (!dragActive) { touchCid = null; touchSrc = null; return; }
      const t = e.changedTouches[0];
      if (touchGhost) touchGhost.style.display = 'none';
      const under = document.elementFromPoint(t.clientX, t.clientY);
      const col   = under?.closest('.kanban-col');
      if (col?.dataset.status && touchCid) {
        this.todoManager.setContentStatus(touchCid, col.dataset.status);
        this._refreshContent();
        this.gistSync.schedulePush();
      }
      cancelTouchDrag();
    });

    kanban.addEventListener('touchcancel', cancelTouchDrag, { passive: true });
  }

  _initPullToRefresh() {
    let startY = 0, pulling = false;
    document.addEventListener('touchstart', e => { startY = e.touches[0].clientY; }, { passive: true });
    document.addEventListener('touchmove', e => {
      if (window.scrollY === 0 && e.touches[0].clientY - startY > 70) pulling = true;
    }, { passive: true });
    document.addEventListener('touchend', async () => {
      if (!pulling) return;
      pulling = false;
      this.renderer.showToast('重新整理中…');
      const dailyData = await this.todoManager.loadDailyData();
      this.renderer.renderNews(dailyData);
      this.weather.refresh();
      this._refreshTodos();
      setTimeout(() => this.renderer.showToast('已重新整理 ✅', 'success'), 800);
    });
  }

  _injectDecorativeElements() {
    // 裝飾元素已停用（避免畫面雜亂）
  }
}

/* =====================================================
   啟動
   ===================================================== */
document.addEventListener('DOMContentLoaded', async () => {
  const app = new DashboardApp();
  await app.init();
  app._refreshContent();
  window.__dashApp = app;
});
