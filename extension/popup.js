(() => {
  /**
   * 香港賽馬會玩法參考（本面板試算用）：
   * 連贏（Quinella）：須選中該場冠、亞軍馬匹，先後次序不拘；複式注數 C(n,2)；馬膽拖注數 = 配腳數。
   * 膽拖交互：支持「先選一匹作膽再按拖」與「先按拖再點膽/腳」兩種路徑；膽馬確定後按 F 為「膽拖全場」（膽 + 其餘全部馬號作配腳）。
   * 獨贏（Win）：猜冠軍（第一名）；複式獨贏為所選每匹馬各打一注，注數 = 所選馬匹數量。
   * 位置Q（Quinella Place）：須選中該場跑入前三的兩匹馬，先後次序不拘；注數與連贏相同（C(n,2) 或膽拖）。
   * Dutch 注額：獨贏/位置/連贏/位置Q 可選；關=平注，開=金額框為「本輪總投」並按 W / P / QIN / QPL 拆賬（缺賠率時平分）。
   * 一般標準注每注最低港幣 10 元（以馬會即日公佈為準）。
   */
  const HKJC = {
    MAX_RUNNERS: 14,
    MIN_HKD_PER_LINE: 10,
    /** 馬會投注金額須為整數十位（不接受個位，如 272 → 270） */
    STAKE_TEN_STEP: 10,
  };

  const categories = [
    { id: "race", label: "場次" },
    { id: "win", label: "獨贏" },
    { id: "pla", label: "位置" },
    { id: "qin", label: "連贏" },
    { id: "qpl", label: "位置Q" },
    { id: "history", label: "記錄" },
    { id: "fc", label: "二重" },
    { id: "tr", label: "三重" },
    { id: "tierce", label: "單 T" },
    { id: "qtt", label: "四連" },
    { id: "f4", label: "四重" },
    { id: "dbl", label: "孖寶" },
    { id: "922", label: "9.2.2" },
    { id: "range", label: "範圍" },
  ];

  /** 側欄暫不展示（玩法邏輯仍保留，恢復時從 Set 中移除 id 即可） */
  const HIDDEN_NAV_CATEGORY_IDS = new Set(["fc", "tr", "tierce", "qtt", "f4", "dbl", "922", "range"]);

  function visibleNavCategories() {
    return categories.filter((c) => !HIDDEN_NAV_CATEGORY_IDS.has(c.id));
  }

  const amounts = [10, 20, 50, 100, 200, 300, 500, 1000, 2000, 3000, 5000, 10000, 15000, 20000];
  const defaultAmount = 5000;

  let activeCategory = "qin";
  let selectedNums = new Set();
  let unitAmount = defaultAmount;
  /** 連贏專用：馬膽拖模式（「拖」開啓；可先選一膽馬再按「拖」，或先按「拖」再點膽與配腳） */
  let bankerMode = false;
  let bankerNum = null;
  /** 注單（演示版：僅儲存在 popup 記憶體中） */
  let slipItems = [];
  let actionFeedbackTimer = null;
  const notifyCardTimers = new Map();
  /** 場次選擇（演示版） */
  let venue = "沙田";
  let raceNo = 1;
  let maxRunnersForRace = HKJC.MAX_RUNNERS;

  // HKJC 數據服務（hkjc-horseRacing-api）
  const HKJC_DATA_BASE_DEFAULT = "http://18.162.150.191:3000";
  const HKJC_DATA_BASE_KEY = "hkjcDataBase";
  let hkjcDataBase = HKJC_DATA_BASE_DEFAULT;
  let hkjcMeeting = null;
  /** GET /api/hkjc/meetings（或數據服務 meetings）返回的全部會議 */
  let meetingsCatalog = [];

  /** 獨贏 / 連贏：開=金額框為總投並按賠率 Dutch 拆賬；關=平注（每注同額） */
  const DUTCH_STAKE_KEY = "hkjcDutchStakeAllocation";
  let dutchStakeMode = false;
  /** 連贏組合試算區塊：收起狀態（展開為預設） */
  const QIN_COMBO_INLINE_COLLAPSED_KEY = "qinComboInlineCollapsed";
  let qinComboInlineCollapsed = false;
  const HKJC_ODDS_USE_KEY = "hkjcOddsUseApi";
  const HKJC_ODDS_TEMPLATE_KEY = "hkjcOddsPathTemplate";
  let hkjcOddsUseApi = true;
  /** 與 Logic-Horse hkjc-horseRacing-api 一致：GET /api/horse-racing/odds/:raceNo?types=… */
  let hkjcOddsTemplate = "/api/horse-racing/odds/{raceNo}?types=WIN,PLA,QIN,QPL";
  /** @type {Map<string, { win: string; place: string }>} */
  let raceOddsMap = new Map();
  /** 連贏 QIN：鍵為「小-大」馬號，如 "1-2" */
  let qinOddsByPair = new Map();
  /** 位置 Q：鍵為「小-大」馬號 */
  let qplOddsByPair = new Map();
  let lastOddsFetchAt = null;
  let oddsLoadStatus = "尚未請求";

  const HKJC_ODDS_AUTO_KEY = "hkjcOddsAutoRefresh";
  const HKJC_ODDS_INTERVAL_KEY = "hkjcOddsAutoIntervalSec";
  let oddsAutoRefreshEnabled = false;
  /** 15 / 30 / 60 */
  let oddsAutoRefreshSec = 30;
  let oddsAutoTimer = null;

  const BET_AUTO_CONFIRM_KEY = "betAutoConfirmSlip";
  let betAutoConfirm = true;

  const $ = (sel, root = document) => root.querySelector(sel);

  const DEFAULT_API_BASE = "http://18.162.150.191:8080";
  const API_BASE_KEY = "apiBase";
  let apiBase = DEFAULT_API_BASE;
  const AUTH_STORAGE_KEY = "auth";
  let auth = { token: null, username: null };
  const REMEMBER_USERNAME_KEY = "rememberUsername";
  const REMEMBER_PASSWORD_KEY = "rememberPassword";
  const REMEMBER_ENABLED_KEY = "rememberCredsEnabled";
  let authInitDone = false;
  /** 同次打開 popup 內僅提示一次：raceId 為拼接值 */
  let raceIdFallbackHintShown = false;

  function $$(sel, root = document) {
    return [...root.querySelectorAll(sel)];
  }

  function storageGet(key) {
    return new Promise((resolve) => {
      try {
        if (!chrome?.storage?.local) {
          console.warn("[raceplugin] chrome.storage.local 不可用，無法持久化登入態");
          return resolve({});
        }
        chrome.storage.local.get([key], (res) => {
          const err = chrome.runtime?.lastError;
          if (err) {
            console.warn("[raceplugin] storage.get 失敗:", err.message);
            return resolve({});
          }
          resolve(res || {});
        });
      } catch {
        resolve({});
      }
    });
  }

  function storageSet(obj) {
    return new Promise((resolve) => {
      try {
        if (!chrome?.storage?.local) {
          console.warn("[raceplugin] chrome.storage.local 不可用，無法寫入登入態");
          return resolve();
        }
        chrome.storage.local.set(obj, () => {
          const err = chrome.runtime?.lastError;
          if (err) console.warn("[raceplugin] storage.set 失敗:", err.message);
          resolve();
        });
      } catch {
        resolve();
      }
    });
  }

  function storageRemove(key) {
    return new Promise((resolve) => {
      try {
        if (!chrome?.storage?.local) return resolve();
        chrome.storage.local.remove([key], () => {
          const err = chrome.runtime?.lastError;
          if (err) console.warn("[raceplugin] storage.remove 失敗:", err.message);
          resolve();
        });
      } catch {
        resolve();
      }
    });
  }

  /** 從 chrome.storage 讀回的 auth 可能是多種欄位名或 JSON 字串 */
  function normalizeAuthFromStorage(val) {
    if (val == null) return null;
    if (typeof val === "string") {
      const s = val.trim();
      if (!s) return null;
      if (s.startsWith("{")) {
        try {
          return normalizeAuthFromStorage(JSON.parse(s));
        } catch {
          return null;
        }
      }
      return { token: s, username: null };
    }
    if (typeof val !== "object") return null;
    const tokenRaw = [
      val.token,
      val.access_token,
      val.accessToken,
      val?.data?.token,
      val?.data?.access_token,
      val?.data?.accessToken,
      val?.data?.jwt,
    ].find((x) => typeof x === "string" && x.trim().length > 0);
    const token = tokenRaw ? tokenRaw.trim() : null;
    if (!token) return null;
    const username =
      (typeof val.username === "string" && val.username.trim()) ||
      (typeof val.userName === "string" && val.userName.trim()) ||
      (typeof val?.data?.username === "string" && val.data.username.trim()) ||
      null;
    return { token, username };
  }

  async function loadHkjcDataBase() {
    const b = await storageGet(HKJC_DATA_BASE_KEY);
    const stored = b?.[HKJC_DATA_BASE_KEY];
    if (stored && typeof stored === "string") hkjcDataBase = stored.replace(/\/+$/, "");
  }

  async function hkjcFetch(path) {
    await loadHkjcDataBase();
    const res = await fetch(`${hkjcDataBase}${path}`, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`HKJC_HTTP_${res.status}`);
    return res.json();
  }

  /** 馬會投注頁路徑：本地賽事 wp；海外／越洋 S1、S2… 為 cross_alup */
  const HKJC_BET_PATH_WP = "wp";
  const HKJC_BET_PATH_CROSS = "cross_alup";

  function isHkjcBetVenueCode(code) {
    const c = String(code ?? "").trim().toUpperCase();
    if (!c) return false;
    if (c === "HV" || c === "ST") return true;
    if (/^S\d+$/.test(c)) return true;
    return false;
  }

  function hkjcBetPathSegmentForVenue(venueCode) {
    const c = String(venueCode ?? "").trim().toUpperCase();
    if (c === "HV" || c === "ST") return HKJC_BET_PATH_WP;
    if (/^S\d+$/.test(c)) return HKJC_BET_PATH_CROSS;
    return "";
  }

  /**
   * 場次 Tab／頂欄：原樣展示接口欄位（不將 HV→跑馬地、S1→越洋 S1 等）。
   * 拼馬會 URL 仍用 resolveVenueCodeForHkjc，與展示分離。
   */
  function venueDisplayLabelFromMeeting(m) {
    if (!m) return "—";
    const fields = ["venueName", "venueDesc", "venue", "venueCode"];
    for (const key of fields) {
      const s = String(m[key] ?? "").trim();
      if (s) return s;
    }
    return "—";
  }

  /** @deprecated 請用 venueDisplayLabelFromMeeting；保留別名避免漏改 */
  function venueLabelForMeeting(m) {
    return venueDisplayLabelFromMeeting(m);
  }

  /** 馬會 bet URL：HV/ST（本地）或 S1/S2…（越洋）；兼容 venue、馬會「田」等 */
  function resolveVenueCodeForHkjc(m) {
    if (!m) return "";
    const code = String(m.venueCode ?? "").trim().toUpperCase();
    if (isHkjcBetVenueCode(code)) return code;
    const raw = String(m.venue ?? m.venueName ?? m.venueDesc ?? "").trim();
    if (!raw) return "";
    const u = raw.toUpperCase();
    if (isHkjcBetVenueCode(u)) return u;
    if (raw === "田" || u === "田") return "ST";
    if (/^S\d+$/i.test(raw)) return raw.toUpperCase();
    if (/沙田|SHA\s*TIN|SHATIN/i.test(raw)) return "ST";
    if (/跑馬地|跑马地|HAPPY\s*VALLEY|HAPPYVALLEY/i.test(raw)) return "HV";
    return "";
  }

  function meetingDateKey(m) {
    const fields = [m?.date, m?.raceDate, m?.meetingDate, m?.meeting_date];
    for (const raw of fields) {
      if (raw == null || raw === "") continue;
      if (typeof raw === "number" && Number.isFinite(raw) && raw > 1e11) {
        const d = new Date(raw);
        if (!Number.isNaN(d.getTime())) {
          const y = d.getUTCFullYear();
          const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
          const day = String(d.getUTCDate()).padStart(2, "0");
          return `${y}${mo}${day}`;
        }
      }
      const dk = String(raw).replace(/\D/g, "").slice(0, 8);
      if (dk.length === 8) return dk;
    }
    return "";
  }

  /** 馬會 bet.hkjc.com 網址用 YYYY-MM-DD */
  function meetingDateIsoForHkjc(m) {
    if (!m) return "";
    const fields = [m.date, m.raceDate, m.meetingDate, m.meeting_date];
    for (const raw of fields) {
      if (raw == null || raw === "") continue;
      if (typeof raw === "number" && Number.isFinite(raw)) {
        const ms = raw > 1e11 ? raw : raw * 1000;
        const d = new Date(ms);
        if (!Number.isNaN(d.getTime())) {
          const y = d.getUTCFullYear();
          const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
          const day = String(d.getUTCDate()).padStart(2, "0");
          return `${y}-${mo}-${day}`;
        }
      }
      const s = String(raw).trim();
      const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
      if (iso) {
        const y = iso[1];
        const mo = String(iso[2]).padStart(2, "0");
        const d = String(iso[3]).padStart(2, "0");
        return `${y}-${mo}-${d}`;
      }
      const dk = s.replace(/\D/g, "").slice(0, 8);
      if (dk.length === 8) return `${dk.slice(0, 4)}-${dk.slice(4, 6)}-${dk.slice(6, 8)}`;
    }
    return "";
  }

  function describeHkjcUrlBuildFailure(meeting, raceNumber) {
    if (!meeting) {
      return "尚未載入賽事，請到「場次」選擇賽馬日與馬場，或稍後重試";
    }
    if (!meetingDateIsoForHkjc(meeting)) {
      return "缺少賽馬日，請到「場次」重新選擇";
    }
    const vc = resolveVenueCodeForHkjc(meeting);
    if (!isHkjcBetVenueCode(vc)) {
      const hint = String(meeting.venueCode ?? meeting.venue ?? "").trim() || "—";
      return `目前馬場（${hint}）暫不支援同步至馬會，請改選沙田／跑馬地等場次`;
    }
    const r = Number(raceNumber);
    if (!Number.isFinite(r) || r < 1) {
      return "請在頂欄或「場次」選擇有效場次（第 N 場）";
    }
    return "請先選擇場次後再同步";
  }

  function parseHkjcRacePathFromUrl(url) {
    try {
      const parts = new URL(url).pathname.split("/").filter(Boolean);
      const ri = parts.indexOf("racing");
      if (ri < 0 || parts.length < ri + 5) return null;
      return {
        segment: parts[ri + 1],
        date: parts[ri + 2],
        venue: String(parts[ri + 3]).toUpperCase(),
        race: parts[ri + 4],
      };
    } catch {
      /* ignore */
    }
    return null;
  }

  function buildHkjcWpUrl(meeting, raceNumber) {
    const dateIso = meetingDateIsoForHkjc(meeting);
    const venueCode = resolveVenueCodeForHkjc(meeting);
    const pathSeg = hkjcBetPathSegmentForVenue(venueCode);
    const r = Number(raceNumber);
    if (!dateIso || !pathSeg || !isHkjcBetVenueCode(venueCode) || !Number.isFinite(r) || r < 1) return null;
    return `https://bet.hkjc.com/ch/racing/${pathSeg}/${dateIso}/${venueCode}/${r}`;
  }

  function meetingCatalogKey(m) {
    if (!m) return "";
    const id = String(m.id ?? m.meetingId ?? "").trim();
    if (id) return id;
    const d = meetingDateKey(m);
    const v = resolveVenueCodeForHkjc(m) || String(m.venue ?? "").trim().toUpperCase();
    return d && v ? `${d}_${v}` : d || v;
  }

  function formatDateKeyForUi(dk) {
    if (!dk || dk.length !== 8) return dk || "";
    return formatMeetingDateForUi(`${dk.slice(0, 4)}-${dk.slice(4, 6)}-${dk.slice(6, 8)}`);
  }

  function applyCatalogMeeting(m) {
    if (!m) return;
    hkjcMeeting = { ...m };
    const vc = resolveVenueCodeForHkjc(hkjcMeeting);
    if (vc) hkjcMeeting.venueCode = vc;
    venue = venueDisplayLabelFromMeeting(hkjcMeeting);
    const betMid = firstNonEmptyId(m.id, m.meetingId, m.meeting_id);
    if (betMid) hkjcMeeting.betMeetingIdForSlip = String(betMid).trim();
    const nos = (Array.isArray(m.races) ? m.races : [])
      .map((r) => raceNumberFromRecord(r))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (nos.length && !nos.includes(Number(raceNo))) raceNo = nos[0];
    applyRaceMetaFromMeeting();
  }

  async function refreshMeetingsCatalog() {
    meetingsCatalog = [];
    if (auth?.token) {
      try {
        const res = await apiFetch("/api/hkjc/meetings", { method: "GET" });
        if (res.ok) {
          const json = await res.json();
          const biz = json?.code;
          if (biz === undefined || biz === null || biz === "" || Number(biz) === 200 || Number(biz) === 0) {
            meetingsCatalog = extractBetMeetingsList(json);
          }
        }
      } catch {
        /* 下注 meetings 失敗時回退數據服務 */
      }
    }
    if (!meetingsCatalog.length) {
      try {
        const mtg = await hkjcFetch("/api/horse-racing/meetings");
        meetingsCatalog = Array.isArray(mtg?.data) ? mtg.data.filter(Boolean) : [];
      } catch {
        meetingsCatalog = [];
      }
    }
    meetingsCatalog = meetingsCatalog.map((m) => {
      if (!m || typeof m !== "object") return m;
      const vc = resolveVenueCodeForHkjc(m);
      return vc ? { ...m, venueCode: vc } : { ...m };
    });
    meetingsCatalog.sort((a, b) => {
      const da = meetingDateKey(a);
      const db = meetingDateKey(b);
      if (da !== db) return da.localeCompare(db);
      return venueDisplayLabelFromMeeting(a).localeCompare(venueDisplayLabelFromMeeting(b), "zh-HK");
    });
    return meetingsCatalog.length;
  }

  function switchToCatalogMeeting(m) {
    applyCatalogMeeting(m);
    selectedNums.clear();
    bankerNum = null;
    bankerMode = false;
    renderRacePanel();
    syncTopbarRace();
    renderNums();
    updateRuleHint();
    updateStatus();
    fetchRaceOddsFromApi();
  }

  /** 會議 `date` 欄位展示（API 常見 `YYYY-MM-DD` 或 ISO 字串） */
  function formatMeetingDateForUi(raw) {
    if (raw == null || raw === "") return "";
    const s = String(raw).trim();
    if (!s) return "";
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
    if (m) {
      const y = Number(m[1]);
      const mo = Number(m[2]);
      const d = Number(m[3]);
      if (Number.isFinite(y) && Number.isFinite(mo) && Number.isFinite(d)) {
        try {
          return new Date(Date.UTC(y, mo - 1, d)).toLocaleDateString("zh-HK", {
            year: "numeric",
            month: "long",
            day: "numeric",
            timeZone: "UTC",
          });
        } catch {
          return `${y}年${mo}月${d}日`;
        }
      }
    }
    const t = Date.parse(s);
    if (!Number.isNaN(t)) {
      return new Date(t).toLocaleDateString("zh-HK", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    }
    return s;
  }

  function applyRaceMetaFromMeeting() {
    const m = hkjcMeeting?.races?.find?.((r) => raceNumberFromRecord(r) === Number(raceNo));
    const sz = Number(m?.wageringFieldSize || 0);
    maxRunnersForRace = sz ? Math.min(Math.max(sz, 2), HKJC.MAX_RUNNERS) : HKJC.MAX_RUNNERS;
  }

  async function ensureMeetingLoaded() {
    const prevKey = hkjcMeeting ? meetingCatalogKey(hkjcMeeting) : "";
    try {
      const health = await fetch(`${hkjcDataBase}/health`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      if (!health) throw new Error("HKJC_HEALTH_FAIL");

      await refreshMeetingsCatalog();
      if (!meetingsCatalog.length) throw new Error("HKJC_NO_MEETING");

      const found = prevKey ? meetingsCatalog.find((m) => meetingCatalogKey(m) === prevKey) : null;
      applyCatalogMeeting(found || meetingsCatalog[0]);
      if (auth?.token) await syncRaceIdsFromBetMeetings();
      syncTopbarRace();
      fetchRaceOddsFromApi();
      return true;
    } catch {
      hkjcMeeting = null;
      meetingsCatalog = [];
      maxRunnersForRace = HKJC.MAX_RUNNERS;
      return false;
    }
  }

  function fmtOddsDisplay(v) {
    if (v == null || v === "") return "";
    const x = Number(v);
    if (Number.isFinite(x)) return x >= 100 ? String(Math.round(x)) : String(x);
    return String(v).trim();
  }

  function extractRunnersArray(json) {
    if (!json || typeof json !== "object") return [];
    const d = json.data;
    if (Array.isArray(json.runners)) return json.runners;
    if (Array.isArray(json.odds)) return json.odds;
    if (Array.isArray(d)) return d;
    if (Array.isArray(d?.runners)) return d.runners;
    if (Array.isArray(d?.odds)) return d.odds;
    if (Array.isArray(d?.horses)) return d.horses;
    return [];
  }

  function normalizePairKey(a, b) {
    const x = Number(a);
    const y = Number(b);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x <= 0 || y <= 0 || x === y) return null;
    return x < y ? `${x}-${y}` : `${y}-${x}`;
  }

  /** 從 combString 解析兩馬組合（如 "1-2"、"1,2"）；單馬返回 null */
  function tryParsePairKeyFromComb(combStr) {
    const raw = String(combStr ?? "").trim();
    if (!raw) return null;
    const parts = raw.split(/[-,\s\/|]+/).map((s) => s.trim()).filter(Boolean);
    const nums = [];
    for (const p of parts) {
      const n = Number.parseInt(String(p).replace(/[^\d]/g, ""), 10);
      if (Number.isFinite(n) && n > 0) nums.push(n);
    }
    if (nums.length < 2) return null;
    return normalizePairKey(nums[0], nums[1]);
  }

  /** 單馬編號（combString 僅為一個數字時） */
  function tryParseSingleHorseKeyFromComb(combStr) {
    if (tryParsePairKeyFromComb(combStr)) return null;
    const raw = String(combStr ?? "").replace(/\D/g, "");
    if (!raw) return null;
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n <= 0) return null;
    return String(n);
  }

  /**
   * 解析 hkjc-horseRacing-api 賠率回應：
   * - GET /api/horse-racing/odds/:raceNo — data[] 含 oddsType + oddsNodes（combString/oddsValue）
   * - README：types 含 WIN, PLA, QIN, QPL；QIN/QPL 為雙馬組合，不得寫入 PLA
   * - GET /api/horse-racing/races/:raceNo — data.runners（no + winOdds 等）
   */
  function ingestOddsPayload(json) {
    const runnerMap = new Map();
    const qinByPair = new Map();
    const qplByPair = new Map();
    if (!json || typeof json !== "object" || json.success === false) {
      return { runnerMap, qinByPair, qplByPair, runnerCount: 0, qinCount: 0, qplCount: 0 };
    }

    const mergeRunnerWinPlace = (noStr, typ, valStr) => {
      if (!noStr || !/^\d+$/.test(noStr)) return;
      const val = fmtOddsDisplay(valStr);
      if (!val) return;
      const prev = runnerMap.get(noStr) || { win: "", place: "" };
      const t = String(typ || "").toUpperCase();
      if (t === "WIN" || t === "W") runnerMap.set(noStr, { win: val, place: prev.place });
      else if (t === "PLA" || t === "PLACE") runnerMap.set(noStr, { win: prev.win, place: val });
    };

    const mergePairOdds = (typ, combStr, valStr) => {
      const t = String(typ || "").toUpperCase();
      if (t !== "QIN" && t !== "QPL") return;
      const val = fmtOddsDisplay(valStr);
      if (!val) return;
      const pk = tryParsePairKeyFromComb(combStr);
      if (!pk) return;
      if (t === "QIN") qinByPair.set(pk, val);
      else qplByPair.set(pk, val);
    };

    if (Array.isArray(json.data) && json.data.length) {
      const first = json.data[0];
      if (first && (first.oddsType != null || Array.isArray(first.oddsNodes) || Array.isArray(first.runners))) {
        for (const block of json.data) {
          const typ = block.oddsType;
          const typU = String(typ || "").toUpperCase();
          if (Array.isArray(block.oddsNodes)) {
            for (const node of block.oddsNodes) {
              const comb = node.combString ?? node.comb ?? "";
              const val = node.oddsValue ?? node.odds;
              if (typU === "QIN" || typU === "QPL") {
                mergePairOdds(typ, comb, val);
                continue;
              }
              const pairK = tryParsePairKeyFromComb(comb);
              if (pairK) {
                mergePairOdds(typ, comb, val);
                continue;
              }
              const single = tryParseSingleHorseKeyFromComb(comb);
              if (single) mergeRunnerWinPlace(single, typ, val);
            }
          }
          if (Array.isArray(block.runners)) {
            if (typU === "QIN" || typU === "QPL") {
              for (const row of block.runners) {
                const c = row.combString ?? row.comb ?? row.combo ?? "";
                mergePairOdds(typ, c, row.oddsValue ?? row.odds ?? row.qinOdds ?? row.qplOdds);
              }
            } else {
              for (const row of block.runners) {
                const norm = normalizeRunnerOdds(row);
                if (!norm.no || !/^\d+$/.test(norm.no)) continue;
                const prev = runnerMap.get(norm.no) || { win: "", place: "" };
                runnerMap.set(norm.no, {
                  win: norm.win || prev.win,
                  place: norm.place || prev.place,
                });
              }
            }
          }
        }
        const runnerCount = [...runnerMap.values()].filter((v) => v.win || v.place).length;
        return {
          runnerMap,
          qinByPair,
          qplByPair,
          runnerCount,
          qinCount: qinByPair.size,
          qplCount: qplByPair.size,
        };
      }
    }

    const runners = extractRunnersArray(json);
    if (!runners.length) {
      return { runnerMap, qinByPair, qplByPair, runnerCount: 0, qinCount: 0, qplCount: 0 };
    }
    for (const row of runners) {
      const norm = normalizeRunnerOdds(row);
      if (!norm.no || !/^\d+$/.test(norm.no)) continue;
      runnerMap.set(norm.no, { win: norm.win, place: norm.place });
    }
    const runnerCount = [...runnerMap.values()].filter((v) => v.win || v.place).length;
    return { runnerMap, qinByPair, qplByPair, runnerCount, qinCount: 0, qplCount: 0 };
  }

  function normalizeRunnerOdds(r) {
    const rawNo = r.no ?? r.runnerNo ?? r.horseNo ?? r.number ?? r.id ?? r.horse?.no;
    const no = rawNo != null ? String(rawNo).trim() : "";
    const win = fmtOddsDisplay(r.winOdds ?? r.win ?? r.W ?? r.oddsWin ?? r.winOdd);
    const place = fmtOddsDisplay(r.placeOdds ?? r.place ?? r.P ?? r.oddsPlace ?? r.placeOdd);
    return { no, win, place };
  }

  function syncOddsStatusLabel() {
    const el = $("#settings-odds-status");
    if (el) el.textContent = oddsLoadStatus;
    const src = $("#q-total");
    if (!src) return;
    if (hkjcOddsUseApi && (raceOddsMap.size > 0 || qinOddsByPair.size > 0 || qplOddsByPair.size > 0)) {
      const bits = [];
      if ([...raceOddsMap.values()].some((v) => v.win || v.place)) bits.push("W/P");
      if (qinOddsByPair.size) bits.push(`QIN×${qinOddsByPair.size}`);
      if (qplOddsByPair.size) bits.push(`QPL×${qplOddsByPair.size}`);
      src.textContent = bits.length ? `接口 · ${bits.join(" ")}` : "接口（已拉取）";
    } else if (!hkjcOddsUseApi) src.textContent = "未請求接口";
    else src.textContent = "市場（演示）";
  }

  async function fetchRaceOddsFromApi(opts = {}) {
    const silent = Boolean(opts.silent);
    raceOddsMap = new Map();
    qinOddsByPair = new Map();
    qplOddsByPair = new Map();
    if (!hkjcOddsUseApi) {
      oddsLoadStatus = "已在設定中關閉接口賠率";
      lastOddsFetchAt = null;
      syncOddsStatusLabel();
      renderNums();
      updateComboOddsTables();
      syncDutchOddsBanner();
      return;
    }
    await loadHkjcDataBase();
    const mid = hkjcMeeting?.id;

    const paths = [];
    /** README：可一次拉 WIN,PLA,QIN,QPL */
    paths.push(`/api/horse-racing/odds/${encodeURIComponent(String(raceNo))}?types=WIN,PLA,QIN,QPL`);
    /** 單場詳情（通常僅獨贏等，作備用） */
    paths.push(`/api/horse-racing/races/${encodeURIComponent(String(raceNo))}`);

    const tpl = (hkjcOddsTemplate || "").trim();
    if (tpl) {
      paths.push(
        tpl
          .replace(/\{meetingId\}/g, encodeURIComponent(String(mid || "")))
          .replace(/\{raceNo\}/g, encodeURIComponent(String(raceNo)))
          .replace(/\{venueCode\}/g, encodeURIComponent(String(hkjcMeeting?.venueCode || "")))
          .replace(/\{date\}/g, encodeURIComponent(String(hkjcMeeting?.date || "")))
      );
    }
    if (mid) {
      paths.push(
        `/api/horse-racing/odds?meetingId=${encodeURIComponent(String(mid))}&raceNo=${encodeURIComponent(String(raceNo))}`
      );
      paths.push(
        `/api/horse-racing/meetings/${encodeURIComponent(String(mid))}/races/${encodeURIComponent(String(raceNo))}/odds`
      );
    }

    const tried = new Set();
    for (const p of paths) {
      const pathOnly = p.startsWith("http") ? p : `${hkjcDataBase}${p.startsWith("/") ? p : `/${p}`}`;
      if (tried.has(pathOnly)) continue;
      tried.add(pathOnly);
      let res;
      try {
        res = await fetch(pathOnly, { headers: { Accept: "application/json" } });
      } catch {
        continue;
      }
      let json;
      try {
        json = await res.json();
      } catch {
        continue;
      }
      if (!res.ok || json?.success === false) continue;
      const ing = ingestOddsPayload(json);
      const has =
        ing.runnerCount > 0 ||
        ing.qinCount > 0 ||
        ing.qplCount > 0;
      if (has) {
        raceOddsMap = ing.runnerMap;
        qinOddsByPair = ing.qinByPair;
        qplOddsByPair = ing.qplByPair;
        lastOddsFetchAt = Date.now();
        const bits = [];
        if (ing.runnerCount) bits.push(`${ing.runnerCount} 匹 W/P`);
        if (ing.qinCount) bits.push(`QIN ${ing.qinCount} 組`);
        if (ing.qplCount) bits.push(`QPL ${ing.qplCount} 組`);
        oddsLoadStatus = `已載入 ${bits.join("，")} · ${new Date().toLocaleTimeString("zh-HK", { hour12: false })}`;
        syncOddsStatusLabel();
        renderNums();
        updateComboOddsTables();
        updateMarketMeta();
        syncDutchOddsBanner();
        return;
      }
    }
    oddsLoadStatus = "未解析到賠率（請核對接口路徑或回應欄位）";
    lastOddsFetchAt = null;
    syncOddsStatusLabel();
    renderNums();
    updateComboOddsTables();
    updateMarketMeta();
    syncDutchOddsBanner();
  }

  function syncQinComboInlineCollapseDom() {
    const wrap = $("#qin-combo-inline-wrap");
    const btn = $("#btn-qin-combo-toggle");
    const body = $("#qin-combo-inline-body");
    if (!wrap || !btn) return;
    wrap.classList.toggle("is-collapsed", qinComboInlineCollapsed);
    btn.setAttribute("aria-expanded", qinComboInlineCollapsed ? "false" : "true");
    btn.title = qinComboInlineCollapsed ? "展開連贏組合試算" : "收起連贏組合試算";
    if (body) body.hidden = qinComboInlineCollapsed;
  }

  async function loadHkjcPrefs() {
    const u = await storageGet(HKJC_ODDS_USE_KEY);
    if (u[HKJC_ODDS_USE_KEY] === false) hkjcOddsUseApi = false;
    const t = await storageGet(HKJC_ODDS_TEMPLATE_KEY);
    if (typeof t[HKJC_ODDS_TEMPLATE_KEY] === "string" && t[HKJC_ODDS_TEMPLATE_KEY].trim()) {
      hkjcOddsTemplate = t[HKJC_ODDS_TEMPLATE_KEY].trim();
    }
    const ac = await storageGet(BET_AUTO_CONFIRM_KEY);
    if (ac[BET_AUTO_CONFIRM_KEY] === false) betAutoConfirm = false;
    const ar = await storageGet(HKJC_ODDS_AUTO_KEY);
    oddsAutoRefreshEnabled = ar[HKJC_ODDS_AUTO_KEY] === true;
    const iv = await storageGet(HKJC_ODDS_INTERVAL_KEY);
    const sec = Number(iv[HKJC_ODDS_INTERVAL_KEY]);
    if (sec === 15 || sec === 30 || sec === 60) oddsAutoRefreshSec = sec;
    const qc = await storageGet(QIN_COMBO_INLINE_COLLAPSED_KEY);
    qinComboInlineCollapsed = qc[QIN_COMBO_INLINE_COLLAPSED_KEY] === true;
    syncQinComboInlineCollapseDom();
    const ds = await storageGet(DUTCH_STAKE_KEY);
    dutchStakeMode = ds[DUTCH_STAKE_KEY] === true;
    syncDutchToggleChrome();
    syncStakeRowChrome();
  }

  function stopOddsAutoRefresh() {
    if (oddsAutoTimer != null) {
      window.clearInterval(oddsAutoTimer);
      oddsAutoTimer = null;
    }
  }

  function restartOddsAutoRefresh() {
    stopOddsAutoRefresh();
    if (!oddsAutoRefreshEnabled || !hkjcOddsUseApi) return;
    const ms = Math.max(5000, (Number(oddsAutoRefreshSec) || 30) * 1000);
    oddsAutoTimer = window.setInterval(() => {
      if (document.hidden) return;
      void fetchRaceOddsFromApi({ silent: true });
    }, ms);
  }

  async function loadAuth() {
    // 避免競態：如果用戶剛完成登入（記憶體裡已有 token），不要被初始化讀取舊緩存覆蓋
    if (auth?.token) return;
    const res = await storageGet(AUTH_STORAGE_KEY);
    // await 期間用戶可能已登入成功，勿用舊存儲覆蓋記憶體中的 token
    if (auth?.token) return;
    const raw = res?.[AUTH_STORAGE_KEY];
    const normalized = normalizeAuthFromStorage(raw);
    if (normalized?.token) auth = normalized;
  }

  async function saveAuth() {
    await storageSet({ [AUTH_STORAGE_KEY]: auth });
  }

  async function clearAuth() {
    auth = { token: null, username: null };
    await storageRemove(AUTH_STORAGE_KEY);
  }

  function isAuthHttpStatus(status) {
    return status === 401 || status === 403;
  }

  /** 業務回應或正文中的認證/Token 失效特徵 */
  function isAuthFailurePayload(json, rawText) {
    const t = String(rawText || "").toLowerCase();
    if (t && /(token\s*(expired|invalid)|未登入|未授權|unauthorized|authentication\s*failed|認證失敗|登入已過期|登陸已過期|token\s*失效)/i.test(t)) {
      return true;
    }
    if (!json || typeof json !== "object") return false;
    const code = Number(json.code);
    if (Number.isFinite(code) && (code === 401 || code === 403)) return true;
    const msg = String(json.msg || json.message || json.error || "");
    return /(token|未登入|未授權|unauthorized|認證失敗|登入已過期|登陸已過期|失效|過期)/i.test(msg);
  }

  let sessionExpiredHandled = false;

  function resetSessionExpiredGuard() {
    sessionExpiredHandled = false;
  }

  async function logoutToLogin(message) {
    stopOddsAutoRefresh();
    await clearAuth();
    showView(false);
    await applyRememberedUsername();
    if (message) toast(message);
  }

  /** 認證失敗 / Token 失效：清會話並回到登入頁 */
  async function sessionExpired(message = "登入已過期，請重新登入") {
    if (sessionExpiredHandled) throw new Error("UNAUTHORIZED");
    sessionExpiredHandled = true;
    await logoutToLogin(message);
    throw new Error("UNAUTHORIZED");
  }

  function showView(isAuthed) {
    const boot = $("#view-boot");
    if (boot) boot.hidden = true;
    const login = $("#view-login");
    const app = $("#view-app");
    if (login) login.hidden = Boolean(isAuthed);
    if (app) app.hidden = !Boolean(isAuthed);
    // 雙保險：部分環境下 hidden 可能被樣式覆蓋
    if (login) login.style.display = isAuthed ? "none" : "flex";
    if (app) app.style.display = isAuthed ? "flex" : "none";
  }

  async function applyRememberedUsername() {
    const r = await storageGet(REMEMBER_USERNAME_KEY);
    const p = await storageGet(REMEMBER_PASSWORD_KEY);
    const e = await storageGet(REMEMBER_ENABLED_KEY);
    const remembered = r?.[REMEMBER_USERNAME_KEY];
    const rememberedPwd = p?.[REMEMBER_PASSWORD_KEY];
    const enabled = e?.[REMEMBER_ENABLED_KEY];
    const chk = $("#remember-username");
    if (chk) chk.checked = enabled !== false; // 預設 true
    if (enabled !== false && remembered && $("#login-username")) $("#login-username").value = String(remembered);
    if (enabled === false && $("#login-username")) $("#login-username").value = "";
    if (enabled !== false && rememberedPwd && $("#login-password")) $("#login-password").value = String(rememberedPwd);
    if (enabled === false && $("#login-password")) $("#login-password").value = "";
  }

  function findToken(obj) {
    if (!obj || typeof obj !== "object") return null;
    const candidates = [
      obj.token,
      obj.access_token,
      obj.accessToken,
      obj?.data?.token,
      obj?.data?.access_token,
      obj?.data?.accessToken,
      obj?.data?.jwt,
    ];
    return candidates.find((x) => typeof x === "string" && x.trim().length >= 8) ?? null;
  }

  async function apiFetch(path, opts = {}) {
    const skipAuthRedirect = Boolean(opts.skipAuthRedirect);
    const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
    if (auth?.token) headers.Authorization = auth.token.startsWith("Bearer ") ? auth.token : `Bearer ${auth.token}`;
    const res = await fetch(`${apiBase}${path}`, { ...opts, headers });
    if (!skipAuthRedirect && isAuthHttpStatus(res.status)) {
      const msg =
        res.status === 403
          ? "無權限或登入已失效，請重新登入"
          : "登入已過期或認證失敗，請重新登入";
      await sessionExpired(msg);
    }
    return res;
  }

  /** 打開 popup 時校驗 Token；僅 401/403 或明確認證失敗文案時退出登入 */
  async function ensureAuthOrShowLogin() {
    if (!auth?.token) return false;
    try {
      const res = await apiFetch("/api/hkjc/meetings", { method: "GET" });
      const raw = await res.text().catch(() => "");
      let json = {};
      try {
        if (raw.trim().startsWith("{") || raw.trim().startsWith("[")) json = JSON.parse(raw);
      } catch {
        json = {};
      }
      if (isAuthFailurePayload(json, raw)) {
        await sessionExpired(String(json.msg || json.message || "認證失敗，請重新登入"));
        return false;
      }
      return Boolean(auth?.token);
    } catch (e) {
      if (String(e?.message || "").includes("UNAUTHORIZED")) return false;
      return Boolean(auth?.token);
    }
  }

  /** 數據服務 races[] 裡與下注庫應對齊的主鍵（多欄位兼容） */
  function pickRaceIdFromRaceRecord(r) {
    if (!r || typeof r !== "object") return "";
    const keys = [
      "raceId",
      "race_id",
      "betRaceId",
      "bet_race_id",
      "externalRaceId",
      "external_race_id",
      "slipRaceId",
    ];
    for (const k of keys) {
      const v = r[k];
      if (v != null && String(v).trim()) return String(v).trim();
    }
    return "";
  }

  /** 場次在 races[] 中的序號：數據服務多為 no，下注服務 meetings 接口多為 raceNo */
  function raceNumberFromRecord(r) {
    if (!r || typeof r !== "object") return NaN;
    const n = Number(r.no ?? r.raceNo);
    return Number.isFinite(n) ? n : NaN;
  }

  function extractBetMeetingsList(json) {
    if (!json || typeof json !== "object") return [];
    const d = json.data;
    if (Array.isArray(d)) return d;
    if (d && typeof d === "object") {
      if (Array.isArray(d.races) && d.races.length) return [d];
      if (Array.isArray(d.meetings)) return d.meetings;
      if (Array.isArray(d.list)) return d.list;
      if (Array.isArray(d.records)) return d.records;
    }
    if (Array.isArray(json.meetings)) return json.meetings;
    return [];
  }

  function racesFromBetMeeting(m) {
    if (!m || typeof m !== "object") return [];
    if (Array.isArray(m.races)) return m.races;
    if (Array.isArray(m.raceList)) return m.raceList;
    return [];
  }

  /**
   * 下注服務：GET /api/hkjc/meetings（需登入），每場帶官方 raceId。
   * 合併到當前 hkjcMeeting.races[]，供 buildRaceIdForBetApi 使用（source=api）。
   */
  async function syncRaceIdsFromBetMeetings() {
    if (!auth?.token || !hkjcMeeting) return false;
    let meetings = meetingsCatalog;
    if (!meetings.length) {
      try {
        const res = await apiFetch("/api/hkjc/meetings", { method: "GET" });
        if (!res.ok) return false;
        const json = await res.json();
        const biz = json?.code;
        if (biz !== undefined && biz !== null && biz !== "") {
          const c = Number(biz);
          if (Number.isFinite(c) && c !== 200 && c !== 0) return false;
        }
        meetings = extractBetMeetingsList(json);
        if (meetings.length) meetingsCatalog = meetings;
      } catch {
        return false;
      }
    }
    if (!meetings.length) return false;

    const wantVenue = resolveVenueCodeForHkjc(hkjcMeeting);
    const wantDate = meetingDateKey(hkjcMeeting);
    const wantId = hkjcMeeting.id != null ? String(hkjcMeeting.id).trim() : "";

    let target =
      (wantId && meetings.find((m) => String(m?.id ?? m?.meetingId ?? "").trim() === wantId)) ||
      (wantVenue &&
        wantDate &&
        meetings.find((m) => {
          const mv = resolveVenueCodeForHkjc(m);
          const md = meetingDateKey(m);
          return mv === wantVenue && md === wantDate;
        })) ||
      meetings[0];

    /** 下注庫會議主鍵：與數據服務 MTG_* 可能不同，generate 應用此 id 查賠率 */
    const betMid = firstNonEmptyId(target?.id, target?.meetingId, target?.meeting_id);
    if (betMid) hkjcMeeting.betMeetingIdForSlip = String(betMid).trim();

    const betRaces = racesFromBetMeeting(target);
    /** raceNo -> { raceId, status }（meetings 裡 status 如 RESULT / DECLARED，供自動發送前提示） */
    const byNo = new Map();
    for (const br of betRaces) {
      const n = raceNumberFromRecord(br);
      const rid = pickRaceIdFromRaceRecord(br);
      if (!Number.isFinite(n) || n <= 0 || !rid) continue;
      const st = br.status != null ? String(br.status).trim() : "";
      byNo.set(n, { raceId: rid, status: st });
    }
    if (!byNo.size) return false;

    const list = hkjcMeeting.races;
    if (!Array.isArray(list)) return false;
    let merged = 0;
    for (const r of list) {
      const n = raceNumberFromRecord(r);
      if (!Number.isFinite(n)) continue;
      const entry = byNo.get(n);
      if (entry) {
        r.raceId = entry.raceId;
        if (entry.status) r.betRaceStatus = entry.status;
        else delete r.betRaceStatus;
        merged += 1;
      }
    }
    return merged > 0;
  }

  /** 當前頂欄場序在 meetings 合併後的狀態（RESULT=已賽果等） */
  function currentBetRaceStatus() {
    const r = hkjcMeeting?.races?.find?.((x) => raceNumberFromRecord(x) === Number(raceNo));
    const st = r?.betRaceStatus ?? r?.status;
    return st != null ? String(st).trim() : "";
  }

  /**
   * 與後端 BetSlipGenerateRequest.raceId 一致。
   * source=api：races[] 上已有 raceId（含由下注服務 GET /api/hkjc/meetings 合併）。
   * source=fallback：yyyyMMdd_venue_Rn（僅當接口未返回 raceId 時）。
   */
  function buildRaceIdForBetApi() {
    const r = hkjcMeeting?.races?.find?.((x) => raceNumberFromRecord(x) === Number(raceNo));
    const apiId = pickRaceIdFromRaceRecord(r);
    if (apiId) return { raceId: apiId, source: "api" };
    const compact = meetingDateKey(hkjcMeeting);
    const vc = resolveVenueCodeForHkjc(hkjcMeeting) || resolveVenueCodeForHkjc(r);
    const rn = Number(raceNo);
    if (compact.length === 8 && vc && Number.isFinite(rn) && rn > 0) {
      return { raceId: `${compact}_${vc}_R${rn}`, source: "fallback" };
    }
    return { raceId: "", source: "none" };
  }

  function groupSlipItemsForBetApi() {
    const win = slipItems.filter((it) => it.type === "獨贏");
    const pla = slipItems.filter((it) => it.type === "位置");
    const qin = slipItems.filter((it) => it.type === "連贏");
    const qpl = slipItems.filter((it) => it.type === "位置Q");
    const rest = slipItems.filter(
      (it) => it.type !== "獨贏" && it.type !== "位置" && it.type !== "連贏" && it.type !== "位置Q"
    );
    return { win, pla, qin, qpl, rest };
  }

  /** 登入成功或同步前：若瀏覽器尚無馬會分頁則自動打開（與 background openHkjcTabIfMissing 一致） */
  async function openHkjcBettingPageIfNeeded() {
    const url = buildHkjcWpUrl(hkjcMeeting, raceNo);
    if (!url || !chrome?.runtime?.sendMessage) return false;
    try {
      const res = await chrome.runtime.sendMessage({
        type: "OPEN_HKJC_TAB",
        payload: { url, activateTab: false },
      });
      return Boolean(res?.ok && res?.opened);
    } catch (e) {
      console.warn("[raceplugin] open HKJC tab:", e);
      return false;
    }
  }

  /** 默认开启；localStorage.setItem('raceplugin_sync_debug','0') 可关闭 */
  function isHkjcSyncDebugEnabled() {
    try {
      return localStorage.getItem("raceplugin_sync_debug") !== "0";
    } catch {
      return true;
    }
  }

  function buildHkjcSyncPayload() {
    const { win, pla, qin, qpl, rest } = groupSlipItemsForBetApi();
    const url = buildHkjcWpUrl(hkjcMeeting, raceNo);
    const venueCode = resolveVenueCodeForHkjc(hkjcMeeting);
    const mapItem = (it, type) => ({
      type,
      combo: String(it.combo).trim(),
      stakePerLine: stakeForHkjc(Number(it.stakePerLine) || 0),
    });
    const winItems = win.map((it) => mapItem(it, "獨贏"));
    const plaItems = pla.map((it) => mapItem(it, "位置"));
    const qinItems = qin.map((it) => mapItem(it, "連贏"));
    const qplItems = qpl.map((it) => mapItem(it, "位置Q"));
    /** 僅同步當前 Tab 對應玩法，避免第二次點同步時把其它玩法又寫進馬會 */
    let syncWin = winItems;
    let syncPla = plaItems;
    let syncQin = qinItems;
    let syncQpl = qplItems;
    let syncScope = "all";
    if (activeCategory === "win") {
      syncPla = [];
      syncQin = [];
      syncQpl = [];
      syncScope = "win";
    } else if (activeCategory === "pla") {
      syncWin = [];
      syncQin = [];
      syncQpl = [];
      syncScope = "pla";
    } else if (activeCategory === "qin") {
      syncWin = [];
      syncPla = [];
      syncQpl = [];
      syncScope = "qin";
    } else if (activeCategory === "qpl") {
      syncWin = [];
      syncPla = [];
      syncQin = [];
      syncScope = "qpl";
    }
    return {
      url,
      raceNo: Number(raceNo),
      venueCode,
      winItems: syncWin,
      plaItems: syncPla,
      qinItems: syncQin,
      qplItems: syncQpl,
      syncScope,
      unsupported: { rest: rest.length },
      /** 連贏/位置Q 膽拖：供 content 用「膽+腳」欄勾選 */
      bankerMode: Boolean(bankerMode && (activeCategory === "qin" || activeCategory === "qpl")),
      bankerNum: bankerMode && bankerNum ? Number(bankerNum) : null,
      /** Dutch 拆賬：content 對膽拖+複式跳過底部總投核對 */
      dutchStakeMode: dutchStakeAppliesOnScreen(),
      /** 半自動：模擬勾選 +「加入投注區」+ 填金額（與人手操作一致） */
      slipOnly: false,
      /** 走官網 5 步點擊（venue → raceno → wp/wpq → 勾選 → 計算機 → 添加） */
      preferDirectPanel: false,
      syncMode: "click",
      /** 同步時切換至馬會分頁，便於看見自動點擊 */
      activateHkjcTab: true,
      /** 同日以 DOM 點擊切換馬場／場次，避免整頁跳轉清空注項 */
      strictSamePage: true,
      allowDirectFallback: false,
      openHkjcIfMissing: true,
      /** 默认 true：马会页 Console 输出 [raceplugin-sync] 逐步日志 */
      syncDebug: isHkjcSyncDebugEnabled(),
    };
  }

  function formatHkjcPageMismatchMessage(res) {
    const rn = Number(res?.expectedRace ?? raceNo);
    const parts = [`馬會頁面須為第 ${rn} 場（與本工具頂欄一致）`];
    const domRn = res?.actualDomRace ?? res?.actual?.race;
    const domVenue = res?.actualDomVenue ?? res?.actual?.venue;
    const exp = res?.expected;
    const act = res?.actual;
    if (domRn != null && Number(domRn) !== rn) {
      parts.push(`目前為第 ${domRn} 場，請在馬會頁頂欄切換場次`);
    } else if (res?.actual?.race != null && Number(res.actual.race) !== rn) {
      parts.push(`目前為第 ${res.actual.race} 場`);
    }
    const expVenue = exp?.venue;
    const actVenue = domVenue || act?.venue;
    if (expVenue && actVenue && expVenue !== actVenue) {
      parts.push(`馬場不一致（本工具 ${expVenue}，馬會頁 ${actVenue}）`);
    }
    if (exp?.date && act?.date && exp.date !== act.date) {
      parts.push("賽馬日不一致，請打開正確賽馬日的馬會頁面");
    }
    return parts.join("；");
  }

  function hkjcSyncErrorText(code, res) {
    const c = String(code || "").trim();
    const map = {
      INVALID_URL: "無法開啟馬會頁面，請重新選擇場次",
      NO_TAB: "無法開啟馬會頁面，請稍後重試",
      TAB_LOAD_TIMEOUT: "馬會頁面載入逾時，請刷新馬會頁後重試",
      CONTENT_SCRIPT_UNAVAILABLE: "馬會頁面未就緒，請刷新馬會投注頁後重試",
      NO_WIN_ITEMS: "無法與馬會頁面通訊，請重新載入本擴充功能並刷新馬會頁",
      NO_SYNC_ITEMS: "沒有可同步的注項",
      NO_ITEMS: "沒有可同步的注項",
      INVALID_RACE_NO: "場次無效，請重新選擇場次",
      NO_BETSLIP_PANEL: "找不到馬會投注區，請打開馬會網站並登入",
      NO_BETLINE_TEMPLATE: "馬會投注區未載入完成，請刷新馬會頁後重試",
      EMPTY_RESPONSE: "馬會頁面無回應，請刷新後重試",
      NO_HKJC_TAB: "請先打開馬會投注網站",
      PAGE_MISMATCH: "馬會頁面與目前場次不一致",
      HKJC_BETTING_LOCKED: "馬會選馬框已鎖定（該場可能未開盤或已截止）；請刷新馬會頁、確認已登入，或手動點一匹马测试是否可勾选",
      HKJC_STAKE_FILL_FAILED: "注項已加入馬會投注區，但金額未能寫入（仍為 $10）；請刷新馬會頁後重試同步",
      HKJC_CALC_STAKE_FILL_FAILED: "投注計算機未能寫入每注金額；請刷新馬會頁後重試同步",
      HKJC_CALC_NOT_READY: "勾選後投注計算機未就緒（注數仍為空）；請刷新馬會頁後重試同步",
      HKJC_CALC_TOTAL_NOT_READY:
        "投注計算機「投注金額」總額未更新；每注金額填寫後請稍候再添加",
      HKJC_PREMATURE_SLIP_LINE: "勾選後馬會自動加了預設注單且無法清除；請手動刪除投注區該行後重試",
      HKJC_STAKE_TOTAL_MISMATCH:
        "行内金额已写入，但底部「總投注金額」未更新；请在投注区逐行点击金额框再点外部，核对后再发送",
    };
    if (c === "PAGE_MISMATCH" && res) return formatHkjcPageMismatchMessage(res);
    if (c === "NO_HKJC_TAB" && res?.expectedUrl) {
      return "請先打開馬會投注網站（與本工具同一賽馬日）";
    }
    if (map[c]) return map[c];
    if (c.startsWith("MISSING_WIN_CHECKBOX")) return `馬會頁面找不到獨贏勾選框（${c.split(":")[1] || ""}）`;
    if (c.startsWith("MISSING_PLA_CHECKBOX")) return `馬會頁面找不到位置勾選框（${c.split(":")[1] || ""}）`;
    if (c.startsWith("MISSING_QIN_CHECKBOX")) {
      return `馬會頁面找不到連贏勾選框（組合 ${c.split(":")[1] || ""}）；請確認已切換至「連贏/位置Q」`;
    }
    if (c.startsWith("MISSING_QPL_CHECKBOX")) {
      return `馬會頁面無法選中位置Q（組合 ${c.split(":")[1] || ""}）；請確認場次一致，左側「連贏/位置Q」且右側已選「位置Q」，再重試同步`;
    }
    if (c === "NO_BET_LINE_MATCH:qpl-banker") {
      return "位置Q膽拖未能加入投注區；請確認右側為「位置Q」、已選場次，並刷新馬會頁後重試";
    }
    if (c === "NO_BET_LINE_MATCH" || String(c).includes("NO_BET_LINE")) {
      return "已選馬但未能寫入投注區對應行；請確認右側為「位置Q」後再點同步，並核對金額";
    }
    if (c.startsWith("INVALID_QIN_COMBO")) return `連贏組合格式無效：${c.split(":")[1] || ""}`;
    if (c.startsWith("INVALID_QPL_COMBO")) return `位置Q組合格式無效：${c.split(":")[1] || ""}`;
    if (c.startsWith("HKJC_INSUFFICIENT_SELECTION")) {
      if (c.includes("qpl-banker")) {
        return "位置Q膽拖：請在馬會「位置Q」表勾選「膽」欄的膽馬與「腳」欄的配腳後再同步";
      }
      if (c.includes("qin-banker")) {
        return "連贏膽拖：請在馬會「連贏」表勾選「膽」欄的膽馬與「腳」欄的配腳後再同步";
      }
      if (c.includes("qpl-box")) {
        return "誤生成位置Q複式（應為一行膽拖如 4>5 + 6），請刪除複式行後重試";
      }
      if (c.includes("qin-instead-of-qpl")) {
        return "誤寫入連贏注項：請在馬會頁右側點選「位置Q」後再同步；並刪除投注區錯誤的連贏行";
      }
      if (c.includes("HKJC_BANKER_LINE_MISMATCH") || c.includes("qin-box")) {
        return "誤生成連贏複式（三匹皆+），請刪除該行後重試；膽拖須用馬會表的「膽」「腳」分欄勾選";
      }
      if (c.startsWith("MISSING_QIN_BANKER")) {
        return "找不到馬會「膽」欄勾選框；請確認在「連贏／位置Q」頁、已選第1場，並刷新馬會頁後再同步";
      }
      if (c.startsWith("MISSING_QIN_LEG")) {
        return "找不到馬會「腳」欄勾選框；請確認在「連贏／位置Q」頁後再同步";
      }
      if (c.includes(":qpl")) {
        return "位置Q 須在「膽+腳」或「腳」欄選滿兩匹；膽拖請勾「膽」欄膽馬與「腳」欄配腳，複式請在「腳」欄選兩匹";
      }
      if (c.includes(":qin")) {
        return "連贏須在「膽+腳」或「腳」欄選滿兩匹；膽拖請勾「膽」欄膽馬與「腳」欄配腳，複式請在「腳」欄選兩匹";
      }
      return "馬會頁面選馬未就緒，請刷新馬會頁面並確認場次後重試";
    }
    if (c === "MISSING_ADD_TO_SLIP") return "找不到「加入投注區」按鈕";
    if (c === "NO_STAKE_INPUT") return "找不到金額輸入框";
    if (c === "HKJC_QPL_SUBTYPE_NOT_READY" || c.includes("QPL_SUBTYPE_NOT_READY")) {
      return "未能自動切換至馬會「位置Q」；請先點選右側「位置Q」單選鈕，再按同步";
    }
    if (c === "HKJC_QIN_SUBTYPE_NOT_READY" || c.includes("QIN_SUBTYPE_NOT_READY")) {
      return "未能自動切換至馬會「連贏」；請先點選右側「連贏」單選鈕，再按同步";
    }
    if (c === "HKJC_BANKER_DUTCH_UNEQUAL" || c.includes("BANKER_DUTCH_UNEQUAL")) {
      return "Dutch 膽拖各組合金額不同，無法寫入一行膽拖；請重載擴充功能後再同步（將自動分兩行寫入）";
    }
    if (/receiving end does not exist|could not establish connection/i.test(c)) {
      return "無法連接馬會頁面，請重新載入本擴充功能並刷新馬會頁";
    }
    if (/back\/forward cache|message channel is closed/i.test(c)) {
      return "馬會頁面正在載入，請待頁面穩定後再按同步";
    }
    if (/^[A-Z][A-Z0-9_]+$/.test(c)) return "同步失敗，請刷新馬會頁後重試";
    return c || "同步失敗，請稍後重試";
  }

  /** P5：本次同步注項預期總投（十位，與馬會一致） */
  function sumSyncedItemsStake(syncScope) {
    return getSlipItemsForSyncScope(syncScope).reduce(
      (s, it) => s + stakeForHkjc(Number(it.stakePerLine) || 0),
      0
    );
  }

  async function postSyncVerifyHkjcStake(payload, syncRes) {
    if (syncRes?.skipGrandTotalVerify || syncRes?.stakeVerify?.skippedGrandTotal) {
      return (
        syncRes.stakeVerify ?? {
          ok: true,
          skippedGrandTotal: true,
          expectedDelta: syncRes.stakeVerify?.expectedDelta ?? 0,
          actualDelta: null,
        }
      );
    }
    if (syncRes?.stakeVerify && syncRes.stakeVerify.expectedDelta != null) {
      return syncRes.stakeVerify;
    }
    const expectedDelta = sumSyncedItemsStake(payload.syncScope);
    const slipTotalBefore = syncRes?.stakeVerify?.slipTotalBefore ?? null;
    if (!chrome?.runtime?.sendMessage || !payload?.url) {
      return syncRes?.stakeVerify ?? { ok: false, expectedDelta, actualDelta: null };
    }
    try {
      const vr = await chrome.runtime.sendMessage({
        type: "VERIFY_HKJC_STAKE",
        payload: {
          url: payload.url,
          expectedDelta,
          slipTotalBefore,
        },
      });
      if (vr && typeof vr.ok === "boolean") return vr;
    } catch {
      /* ignore */
    }
    return syncRes?.stakeVerify ?? buildStakeVerifyFallback(expectedDelta);
  }

  function buildStakeVerifyFallback(expectedDelta) {
    return { ok: false, expectedDelta, actualDelta: null, grandTotal: null, slipTotalBefore: null };
  }

  /** P5：同步後確認閘門——總額一致才可發送 */
  function showHkjcSendGate(verify, added, backendNote, syncScope, errCount = 0) {
    const note = backendNote ? String(backendNote).replace(/^[，。]+/, "").trim() : "";
    const noteSuffix = note ? `（${note}）` : "";
    const partialNote = errCount > 0 ? `${errCount} 項未寫入 · ` : "";
    if (verify?.ok && verify?.skippedGrandTotal) {
      showActionFeedback(
        `已寫入 ${added} 項 · Dutch 拆賬模式，請逐行核對金額後再按馬會「發送注項」${noteSuffix}`,
        "success",
        { persist: true }
      );
      return;
    }
    if (verify?.ok) {
      const grand =
        verify.grandTotal != null
          ? fmtMoney(verify.grandTotal)
          : verify.actualDelta != null
            ? fmtMoney(verify.actualDelta)
            : "";
      const grandPart = grand ? `馬會總投 ${grand} 已核對一致` : "金額已核對一致";
      showActionFeedback(
        `已寫入 ${added} 項 · ${grandPart}，可按馬會「發送注項」${noteSuffix}`,
        "success",
        { persist: true }
      );
      return;
    }
    const exp = fmtMoney(verify?.expectedDelta ?? sumSyncedItemsStake(syncScope));
    const lineOk =
      verify?.lineSumDelta != null &&
      verify?.expectedDelta != null &&
      verify.lineSumDelta === verify.expectedDelta;
    if (added > 0 && lineOk) {
      showActionFeedback(
        `已寫入 ${added} 項 · ${partialNote}行内金额已齐，但底部「總投注金額」未更新 · 请在投注区逐行点击金额框再点外部，核对后再发送${noteSuffix}`,
        "warn",
        { persist: true }
      );
      return;
    }
    if (added > 0 && errCount > 0 && verify?.lineSumDelta === verify?.expectedDelta) {
      showActionFeedback(
        `已寫入 ${added} 項 · ${errCount} 項未寫入（如选马框锁定）· 請核對投注區後再按馬會「發送注項」${noteSuffix}`,
        "warn",
        { persist: true }
      );
      return;
    }
    const act =
      verify?.actualDelta != null
        ? fmtMoney(verify.actualDelta)
        : verify?.grandTotal != null
          ? fmtMoney(verify.grandTotal)
          : "—";
    showActionFeedback(
      `已寫入 ${added} 項，但馬會總投增量 ${act} 與預期 ${exp} 不符 · 請勿發送注項，請刷新馬會頁後重試同步`,
      "error",
      { persist: true }
    );
  }

  /** 與 buildHkjcSyncPayload 的 syncScope 一致：本次寫入馬會的注項 */
  function getSlipItemsForSyncScope(syncScope) {
    const g = groupSlipItemsForBetApi();
    if (syncScope === "win") return [...g.win];
    if (syncScope === "pla") return [...g.pla];
    if (syncScope === "qin") return [...g.qin];
    if (syncScope === "qpl") return [...g.qpl];
    return [...g.win, ...g.pla, ...g.qin, ...g.qpl];
  }

  function slipItemsAfterHkjcSyncErrors(items, hkjcRes) {
    const errs = Array.isArray(hkjcRes?.errors) ? hkjcRes.errors : [];
    if (!errs.length) return [...items];
    return items.filter(
      (it) =>
        !errs.some((e) => e.type === it.type && String(e.combo ?? "").trim() === String(it.combo ?? "").trim())
    );
  }

  /**
   * 將注項提交至後端（原「自動發送」邏輯）；成功項會從本地注單移除。
   * @returns {{ submitted: number, summary: string }}
   */
  async function submitSlipToBackend(items) {
    const list = Array.isArray(items) ? items.filter(Boolean) : [];
    if (!list.length) return { submitted: 0, summary: "" };
    if (!auth?.token) {
      return { submitted: 0, summary: "未登入" };
    }

    const win = list.filter((it) => it.type === "獨贏");
    const pla = list.filter((it) => it.type === "位置");
    const qin = list.filter((it) => it.type === "連贏");
    const qpl = list.filter((it) => it.type === "位置Q");
    const rest = list.filter((it) => !["獨贏", "位置", "連贏", "位置Q"].includes(it.type));
    if (rest.length) {
      return { submitted: 0, summary: "含不支援的玩法" };
    }
    if (!win.length && !pla.length && !qin.length && !qpl.length) {
      return { submitted: 0, summary: "" };
    }

    await fetchRaceOddsFromApi();
    await syncRaceIdsFromBetMeetings();
    const built = buildRaceIdForBetApi();
    const raceId = built.raceId;
    if (!raceId) {
      return { submitted: 0, summary: "無法取得場次資料" };
    }
    if (built.source === "fallback" && !raceIdFallbackHintShown) {
      raceIdFallbackHintShown = true;
    }

    if (win.length) {
      const pre = validateWinOddsPreflight(win);
      if (!pre.ok) {
        /* 仍按後端庫內賠率發送 */
      }
    }

    const summaries = [];
    let submitted = 0;

    const sendPool = async (poolItems, poolType, label) => {
      if (!poolItems.length) return;
      const body = mergePoolGenerateBody(poolItems, poolType, raceId);
      if (!body) throw new Error(`${label}：無法合併注項`);
      const json = await postBetGenerate(body);
      const id = pickBetSlipId(json);
      let confirmed = false;
      let confirmFailed = false;
      let confirmError = "";
      if (betAutoConfirm) {
        if (id) {
          try {
            await putBetConfirm(id);
            confirmed = true;
            summaries.push(`${label} 已記錄並確認`);
          } catch (e) {
            confirmFailed = true;
            confirmError = String(e?.message || e);
            summaries.push(`${label} 已記錄，確認失敗`);
          }
        } else {
          summaries.push(`${label} 已記錄`);
        }
      } else if (id) {
        summaries.push(`${label} 已記錄`);
      } else {
        summaries.push(`${label} 已記錄`);
      }
      const ids = new Set(poolItems.map((it) => it.id));
      slipItems = slipItems.filter((it) => !ids.has(it.id));
      submitted += poolItems.length;
      renderSlip();
    };

    const sendPairItems = async (poolItems, poolType, typeLabel, prefixLabel) => {
      const failures = [];
      for (const it of poolItems) {
        const pair = parseQinellaCombo(it.combo);
        if (!pair) {
          failures.push(`${prefixLabel} ${it.combo}：組合無效`);
          continue;
        }
        const [a, b] = pair;
        const label = `${prefixLabel} ${a}-${b}`;
        const totalStake = Math.round(Number(it.totalStake) || 0);
        if (totalStake <= 0) {
          failures.push(`${label}：金額無效`);
          continue;
        }
        const body = {
          raceId,
          poolType,
          selectedHorses: [a, b],
          totalStake,
        };
        const mid = firstNonEmptyId(hkjcMeeting?.betMeetingIdForSlip, hkjcMeeting?.id);
        if (mid) body.meetingId = String(mid).trim();
        const rn = Number(raceNo);
        if (Number.isFinite(rn) && rn > 0) body.raceNo = rn;

        try {
          const json = await postBetGenerate(body);
          const id = pickBetSlipId(json);
          let confirmed = false;
          let confirmFailed = false;
          let confirmError = "";
          if (betAutoConfirm && id) {
            try {
              await putBetConfirm(id);
              confirmed = true;
              summaries.push(`${label} 已記錄並確認`);
            } catch (e) {
              confirmFailed = true;
              confirmError = String(e?.message || e);
              summaries.push(`${label} 已記錄，確認失敗`);
            }
          } else if (id) {
            summaries.push(`${label} 已記錄`);
          } else {
            summaries.push(`${label} 已記錄`);
          }
          slipItems = slipItems.filter((x) => x.id !== it.id);
          submitted += 1;
          renderSlip();
        } catch (e) {
          if (String(e?.message || "").includes("UNAUTHORIZED")) throw e;
          failures.push(`${label}：${String(e?.message || e).slice(0, 120)}`);
        }
      }
      if (failures.length) {
        summaries.push(`系統未記錄 ${failures.length} 項`);
      }
    };

    if (win.length) await sendPool(win, "WIN", "獨贏");
    if (pla.length) {
      const pre = validatePlaceOddsPreflight(pla);
      if (!pre.ok) {
        /* 仍發送 */
      }
      await sendPool(pla, "PLA", "位置");
    }
    if (qin.length) await sendPairItems(qin, "QIN", "連贏", "連贏");
    if (qpl.length) await sendPairItems(qpl, "QPL", "位置Q", "位置Q");

    const summary = summaries.length ? summaries.join("；") : "";
    return { submitted, summary };
  }

  /** 馬會同步成功後，將寫入成功的注項提交至系統 */
  async function submitBackendAfterHkjcSync(hkjcRes, syncScope) {
    const n = Number(hkjcRes?.added) || 0;
    if (n <= 0) return "";
    const targeted = getSlipItemsForSyncScope(syncScope);
    const toSubmit = slipItemsAfterHkjcSyncErrors(targeted, hkjcRes);
    if (!toSubmit.length) return "";
    if (!auth?.token) {
      return "。請先登入帳戶，以便在系統記錄注單";
    }
    try {
      const br = await submitSlipToBackend(toSubmit);
      if (br.submitted > 0) {
        return `，並已在系統記錄 ${br.submitted} 項`;
      }
      if (br.summary) {
        return "。部分注項未能記錄至系統，請在「記錄」查看或稍後重試";
      }
      return "";
    } catch (e) {
      if (String(e?.message || "").includes("UNAUTHORIZED")) {
        return "。請先登入帳戶，以便在系統記錄注單";
      }
      return "。系統記錄失敗，請稍後重試";
    }
  }

  async function syncToHkjcBettingSlip() {
    if (slipItems.length === 0) {
      toast("暫無注項可同步");
      return;
    }
    if (activeCategory === "qpl" && !slipItems.some((it) => it.type === "位置Q")) {
      toast("請先在「位置Q」分頁加入注項後再同步");
      return;
    }
    if (activeCategory === "qin" && !slipItems.some((it) => it.type === "連贏")) {
      toast("請先在「連贏」分頁加入注項後再同步");
      return;
    }
    const payload = buildHkjcSyncPayload();
    const syncCount =
      payload.winItems.length +
      payload.plaItems.length +
      payload.qinItems.length +
      payload.qplItems.length;
    if (syncCount === 0) {
      if (payload.syncScope === "win" && payload.unsupported.rest === 0) {
        const g = groupSlipItemsForBetApi();
        toast(
          g.pla.length + g.qin.length > 0
            ? "當前僅同步獨贏；其它玩法請先切換上方分頁"
            : "暫無獨贏注項可同步，請先加入獨贏"
        );
        return;
      }
      if (payload.syncScope === "pla" && payload.unsupported.rest === 0) {
        const g = groupSlipItemsForBetApi();
        toast(
          g.win.length + g.qin.length > 0
            ? "當前僅同步位置；其它玩法請先切換上方分頁"
            : "暫無位置注項可同步，請先加入位置"
        );
        return;
      }
      if (payload.syncScope === "qin" && payload.unsupported.rest === 0) {
        const g = groupSlipItemsForBetApi();
        toast(
          g.win.length + g.pla.length + g.qpl.length > 0
            ? "當前僅同步連贏；其它玩法請先切換上方分頁"
            : "暫無連贏注項可同步，請先加入連贏"
        );
        return;
      }
      if (payload.syncScope === "qpl" && payload.unsupported.rest === 0) {
        const g = groupSlipItemsForBetApi();
        toast(
          g.win.length + g.pla.length + g.qin.length > 0
            ? "當前僅同步位置Q；其它玩法請先切換上方分頁"
            : "暫無位置Q注項可同步，請先加入位置Q"
        );
        return;
      }
      if (payload.unsupported.rest > 0) {
        toast("「同步到馬會」僅支持獨贏、位置、連贏與位置Q；請移除其它玩法注項");
      } else {
        toast("暫無可同步的注項，請先加入獨贏、位置、連贏或位置Q");
      }
      return;
    }
    if (!payload.url) {
      const prevKey = hkjcMeeting ? meetingCatalogKey(hkjcMeeting) : "";
      const n = await refreshMeetingsCatalog();
      if (n > 0) {
        const found = prevKey ? meetingsCatalog.find((m) => meetingCatalogKey(m) === prevKey) : null;
        applyCatalogMeeting(found || meetingsCatalog[0]);
        const retry = buildHkjcSyncPayload();
        if (retry.url) Object.assign(payload, retry);
      }
    }
    if (!payload.url) {
      toast(describeHkjcUrlBuildFailure(hkjcMeeting, raceNo));
      return;
    }
    if (!chrome?.runtime?.sendMessage) {
      toast("無法連接擴充功能，請重新載入後再試");
      return;
    }

    const btn = $("#btn-sync-hkjc");
    const label = "同步到馬會";
    hideActionFeedback();
    if (btn) {
      btn.disabled = true;
      btn.textContent = "同步中…";
    }
    try {
      const res = await chrome.runtime.sendMessage({ type: "SYNC_TO_HKJC", payload });
      if (isHkjcSyncDebugEnabled()) {
        if (Array.isArray(res?.syncTrace) && res.syncTrace.length) {
          console.log("[raceplugin-sync] 同步轨迹（popup）:", res.syncTrace);
        } else {
          console.log("[raceplugin-sync] 无 syncTrace；请确认已 reload 扩展并在马会页 Console 查看");
        }
      }
      const addedN = Number(res?.added) || 0;
      const errList = Array.isArray(res?.errors) ? res.errors : [];
      if (!res?.ok) {
        if (res?.error === "PAGE_MISMATCH" || res?.error === "NO_HKJC_TAB") {
          toast(hkjcSyncErrorText(res.error, res));
          return;
        }
        if (addedN <= 0) {
          const firstErr = errList[0]?.error || res?.error;
          const extra = errList.length > 1 ? `（另有 ${errList.length - 1} 項失敗）` : "";
          toast(`馬會同步失敗：${hkjcSyncErrorText(firstErr, res)}${extra}`);
          return;
        }
        const failN = errList.length;
        showActionFeedback(
          `已寫入 ${addedN} 項，另有 ${failN} 項未成功 · 請核對馬會投注區後再試未寫入項`,
          "warn",
          { persist: true }
        );
      }
      const n = addedN;
      const errN = errList.length;
      if (n === 0 && syncCount > 0) {
        toast(
          errN > 0
            ? `馬會同步未完成（0/${syncCount} 項寫入），請看投注區或重試`
            : `馬會同步未寫入任何注項，請確認已登入且右側有投注區`
        );
        return;
      }
      const backendNote = await submitBackendAfterHkjcSync(res, payload.syncScope);
      const verify = await postSyncVerifyHkjcStake(payload, res);
      showHkjcSendGate(verify, n, backendNote, payload.syncScope, errN);
    } catch (e) {
      toast(`馬會同步失敗：${hkjcSyncErrorText(e?.message)}`);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = label;
      }
    }
  }

  function mergePoolGenerateBody(items, poolType, raceId) {
    const horses = [
      ...new Set(
        items
          .map((it) => Number(String(it.combo ?? "").replace(/\D/g, "")))
          .filter((n) => Number.isFinite(n) && n > 0)
      ),
    ].sort((a, b) => a - b);
    const totalStake = Math.round(items.reduce((s, it) => s + (Number(it.totalStake) || 0), 0));
    if (!horses.length || totalStake <= 0) return null;
    const body = { raceId, poolType, selectedHorses: horses, totalStake };

    /** 優先用 GET /api/hkjc/meetings 合併的會議 id，避免 MTG_* 與下注庫不一致導致查錯賠率 */
    const mid = firstNonEmptyId(hkjcMeeting?.betMeetingIdForSlip, hkjcMeeting?.id);
    if (mid) body.meetingId = String(mid).trim();
    const rn = Number(raceNo);
    if (Number.isFinite(rn) && rn > 0) body.raceNo = rn;

    /**
     * 預設不附帶 winOddsByHorse：與裸 POST /api/bet/generate 一致，由下注服務用庫內賠率計算。
     * 若附帶數據服務解析的 W，部分後端會逐匹校驗與庫內是否一致，小數不一致即報「馬號x的賠率無效」。
     */

    return body;
  }

  function parseQinellaCombo(combo) {
    const parts = String(combo ?? "")
      .trim()
      .split(/\D+/)
      .filter(Boolean)
      .map((x) => Number(x));
    if (parts.length !== 2) return null;
    const a = parts[0];
    const b = parts[1];
    if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0 || a === b) return null;
    return [a, b];
  }

  /** 在已拉到前端獨贏賠率時預檢，減少後端「馬號x的賠率無效」 */
  function validateWinOddsPreflight(winItems) {
    if (!hkjcOddsUseApi || raceOddsMap.size === 0) return { ok: true, missing: [] };
    const horses = [
      ...new Set(
        winItems
          .map((it) => Number(String(it.combo ?? "").replace(/\D/g, "")))
          .filter((n) => Number.isFinite(n) && n > 0)
      ),
    ];
    const missing = [];
    for (const h of horses) {
      const od = raceOddsMap.get(String(h));
      const w = od?.win;
      if (!w || !String(w).trim()) missing.push(h);
    }
    return missing.length ? { ok: false, missing } : { ok: true, missing: [] };
  }

  function validatePlaceOddsPreflight(plaItems) {
    if (!hkjcOddsUseApi || raceOddsMap.size === 0) return { ok: true, missing: [] };
    const horses = [
      ...new Set(
        plaItems
          .map((it) => Number(String(it.combo ?? "").replace(/\D/g, "")))
          .filter((n) => Number.isFinite(n) && n > 0)
      ),
    ];
    const missing = [];
    for (const h of horses) {
      const od = raceOddsMap.get(String(h));
      const p = od?.place;
      if (!p || !String(p).trim()) missing.push(h);
    }
    return missing.length ? { ok: false, missing } : { ok: true, missing: [] };
  }

  function firstNonEmptyId(...vals) {
    for (const v of vals) {
      if (v == null || v === "") continue;
      const s = String(v).trim();
      if (s) return s;
    }
    return null;
  }

  function parseMaybeJsonString(s) {
    if (typeof s !== "string") return null;
    const t = s.trim();
    if (!t.startsWith("{") && !t.startsWith("[")) return null;
    try {
      return JSON.parse(t);
    } catch {
      return null;
    }
  }

  /** 從單層對象取注單 ID（不遞歸） */
  function pickBetSlipIdFromFlatObject(obj) {
    if (!obj || typeof obj !== "object") return null;
    const fd = obj.formattedData;
    let id = firstNonEmptyId(
      obj.betSlipId,
      obj.betSlipID,
      obj.bet_slip_id,
      obj.slipId,
      obj.slip_id,
      obj.betSlipNo,
      obj.slip,
      fd?.betSlipId,
      fd?.betSlipID,
      fd?.slipId,
      fd?.id,
      fd?.slip
    );
    if (id) return id;
    if (obj.bets || obj.formattedData) {
      id = firstNonEmptyId(obj.id);
      if (id) return id;
    }
    if (Array.isArray(obj.bets)) {
      for (const b of obj.bets) {
        if (!b || typeof b !== "object") continue;
        id = firstNonEmptyId(
          b.betSlipId,
          b.betSlipID,
          b.bet_slip_id,
          b.slipId,
          b.id,
          b?.betSlip?.id,
          b?.slip?.id
        );
        if (id) return id;
      }
    }
    return null;
  }

  function scanForBetSlipIdDeep(obj, depth, seen) {
    if (obj == null || depth < 0) return null;
    if (typeof obj !== "object") return null;
    if (seen.has(obj)) return null;
    seen.add(obj);
    const id = pickBetSlipIdFromFlatObject(obj);
    if (id) return id;
    if (Array.isArray(obj)) {
      for (const item of obj) {
        const sub = scanForBetSlipIdDeep(item, depth - 1, seen);
        if (sub) return sub;
      }
      return null;
    }
    for (const k of Object.keys(obj)) {
      const sub = scanForBetSlipIdDeep(obj[k], depth - 1, seen);
      if (sub) return sub;
    }
    return null;
  }

  /** 兼容 { code, msg, data } 信封、data 為 JSON 字串、嵌套 result/payload 等 */
  function pickBetSlipId(json) {
    if (!json || typeof json !== "object") return null;

    // 與後端常見結構一致：{ code, msg, data: { betSlipId, formattedData, bets, ... } }
    const inner = json.data;
    if (inner && typeof inner === "object" && inner.betSlipId != null && inner.betSlipId !== "") {
      return String(inner.betSlipId);
    }

    const msgParsed = parseMaybeJsonString(json.msg);
    if (msgParsed) {
      const fromMsg = pickBetSlipIdFromFlatObject(msgParsed) || scanForBetSlipIdDeep(msgParsed, 8, new Set());
      if (fromMsg) return fromMsg;
    }

    const layers = [json];
    let cur = json;
    for (let i = 0; i < 4; i += 1) {
      const next = cur?.data ?? cur?.result ?? cur?.payload ?? cur?.body;
      if (next == null) break;
      if (typeof next === "string") {
        const p = parseMaybeJsonString(next);
        if (p && typeof p === "object") {
          layers.push(p);
          cur = p;
        } else break;
      } else if (typeof next === "object") {
        layers.push(next);
        cur = next;
      } else break;
    }

    for (const layer of layers) {
      const id = pickBetSlipIdFromFlatObject(layer);
      if (id) return id;
    }
    return scanForBetSlipIdDeep(json, 10, new Set());
  }

  /** 港幣顯示（與馬會常用 $ 符號一致） */
  function formatHkdHk(n) {
    const x = Number(n);
    if (!Number.isFinite(x)) return "—";
    return `$${x.toLocaleString("en-HK", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  }

  function poolCodeToHk(code) {
    const c = String(code || "").toUpperCase();
    if (c === "WIN") return "獨贏";
    if (c === "PLA" || c === "PLACE") return "位置";
    if (c === "QIN") return "連贏（前二不分次序）";
    if (c === "QPL") return "位置Q";
    return c || "—";
  }

  function formatHorseCellForReceipt(h) {
    if (Array.isArray(h)) return h.map((x) => `${Number(x)}號`).join("／");
    if (h == null || h === "") return "—";
    const n = Number(h);
    return Number.isFinite(n) ? `${n}號` : String(h);
  }

  /**
   * 獨贏生成注單（與插件「自動發送」一致）。
   * curl 示例（TOKEN 可用頂欄「Token」複製；winOddsByHorse 與插件自動發送一致，由數據服務賠率填入）：
   * curl -sS -X POST 'BASE/api/bet/generate' \
   *   -H 'Content-Type: application/json' \
   *   -H 'Authorization: Bearer TOKEN' \
   *   -d '{"raceId":"20260503_ST_R1","meetingId":"會議ID","raceNo":1,"poolType":"WIN","selectedHorses":[1,2,3],"totalStake":100}'
   */
  async function postBetGenerate(body) {
    const res = await apiFetch("/api/bet/generate", {
      method: "POST",
      body: JSON.stringify(body),
    });
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    const raw = await res.text().catch(() => "");
    let json = {};
    const tryParse = Boolean(raw && (ct.includes("application/json") || /^\s*[\[{]/.test(raw)));
    if (tryParse) {
      try {
        json = JSON.parse(raw);
      } catch {
        json = {};
      }
    }
    if (isAuthFailurePayload(json, raw)) {
      await sessionExpired(String(json.msg || json.message || "認證失敗，請重新登入"));
    }
    if (!res.ok) {
      const msg = json.message || json.msg || json.error || raw.trim().slice(0, 280) || `HTTP ${res.status}`;
      throw new Error(String(msg));
    }
    const bizCode = json.code;
    if (bizCode !== undefined && bizCode !== null && bizCode !== "") {
      const c = Number(bizCode);
      if (Number.isFinite(c) && c !== 200 && c !== 0) {
        throw new Error(String(json.msg || json.message || `業務 code=${bizCode}`));
      }
    }
    return json;
  }

  async function putBetConfirm(betSlipId) {
    const res = await apiFetch(`/api/bet/${encodeURIComponent(String(betSlipId))}/confirm`, {
      method: "PUT",
      body: "{}",
    });
    const t = await res.text().catch(() => "");
    let json = {};
    try {
      if (t.trim().startsWith("{")) json = JSON.parse(t);
    } catch {
      json = {};
    }
    if (isAuthFailurePayload(json, t)) {
      await sessionExpired(String(json.msg || json.message || "認證失敗，請重新登入"));
    }
    if (!res.ok) {
      throw new Error(t.trim().slice(0, 280) || `確認失敗 HTTP ${res.status}`);
    }
  }

  async function readBetApiJson(res) {
    const raw = await res.text().catch(() => "");
    let json = {};
    try {
      if (raw.trim()) json = JSON.parse(raw);
    } catch {
      json = {};
    }
    if (isAuthFailurePayload(json, raw)) {
      await sessionExpired(String(json.msg || json.message || "認證失敗，請重新登入"));
    }
    if (!res.ok) {
      throw new Error(String(json.msg || json.message || json.error || raw.trim().slice(0, 280) || `HTTP ${res.status}`));
    }
    const biz = Number(json.code);
    if (Number.isFinite(biz) && biz !== 200 && biz !== 0) {
      throw new Error(String(json.msg || json.message || `業務 code=${biz}`));
    }
    return json;
  }

  function parseBetDetailField(raw) {
    if (raw == null || raw === "") return [];
    if (Array.isArray(raw)) return raw;
    if (typeof raw === "string") {
      try {
        const v = JSON.parse(raw);
        return Array.isArray(v) ? v : [];
      } catch {
        return [];
      }
    }
    return [];
  }

  function formatRaceIdShort(raceId) {
    const m = /^(\d{4})(\d{2})(\d{2})_([^_]+)_R(\d+)$/i.exec(String(raceId || "").trim());
    if (m) return `${m[1]}-${m[2]}-${m[3]} ${m[4]} 第${m[5]}場`;
    return String(raceId || "—");
  }

  function betSlipStatusLabel(row) {
    const st = Number(row?.status);
    if (st === 1) return { text: "已確認", cls: "history-item__status--ok" };
    if (st === 0) return { text: "待確認", cls: "history-item__status--pending" };
    return { text: `狀態 ${row?.status ?? "—"}`, cls: "" };
  }

  function historySelectionSummary(row) {
    const bets = parseBetDetailField(row?.betDetail);
    if (!bets.length) return "—";
    if (bets.length === 1) {
      const k = bets[0]?.selectionKey;
      return k ? String(k) : "1 組";
    }
    const keys = bets
      .map((b) => b?.selectionKey)
      .filter(Boolean)
      .slice(0, 3);
    const tail = bets.length > 3 ? "…" : "";
    return keys.length ? `${keys.join("、")}${tail}（${bets.length} 組）` : `${bets.length} 組`;
  }

  let historyLoadSeq = 0;
  let selectedHistorySlipId = null;

  function hideHistoryDetail() {
    const detail = $("#history-detail");
    const empty = $("#history-detail-empty");
    if (detail) detail.hidden = true;
    if (empty) empty.hidden = false;
    selectedHistorySlipId = null;
    $$(".history-item.is-active", $("#history-list")).forEach((el) => el.classList.remove("is-active"));
  }

  function showHistoryDetailEmptyHint() {
    hideHistoryDetail();
  }

  function renderBetHistoryDetail(record) {
    const wrap = $("#history-detail");
    if (!wrap || !record) return;
    const bets = parseBetDetailField(record.betDetail);
    const title = $("#history-detail-title");
    const badge = $("#history-detail-badge");
    const meta = $("#history-detail-meta");
    const tbody = $("#history-detail-tbody");
    const tfoot = $("#history-detail-tfoot");
    const table = $("#history-detail-table");
    const allocHead = $("#history-detail-alloc-head");
    const pre = $("#history-detail-pre");

    const slipId = record.betSlipId ?? record.id;
    if (title) title.textContent = `注單 #${slipId ?? "—"}`;

    const st = betSlipStatusLabel(record);
    if (badge) {
      const badgeTone = st.cls.includes("ok")
        ? "slip-receipt__badge--ok"
        : st.cls.includes("pending")
          ? "slip-receipt__badge--warn"
          : "slip-receipt__badge--info";
      badge.className = `history-detail__badge slip-receipt__badge ${badgeTone}`;
      badge.textContent = st.text;
    }

    if (meta) {
      meta.replaceChildren();
      const add = (dtText, ddText) => {
        const dte = document.createElement("dt");
        dte.textContent = dtText;
        const dde = document.createElement("dd");
        dde.textContent = ddText;
        meta.appendChild(dte);
        meta.appendChild(dde);
      };
      add("玩法", poolCodeToHk(record.poolType));
      add("場次", formatRaceIdShort(record.raceId));
      add("系統場次 ID", record.raceId || "—");
      add("總投注", formatHkdHk(record.totalStake));
      add("派彩", formatHkdHk(record.payout));
      add("創建時間", record.createTime || "—");
      if (record.settledAt) add("結算時間", record.settledAt);
    }

    const total = Number(record.totalStake) || bets.reduce((s, b) => s + (Number(b.stake) || 0), 0);
    if (tbody && tfoot && table && allocHead) {
      tbody.replaceChildren();
      tfoot.replaceChildren();
      if (bets.length) {
        table.hidden = false;
        allocHead.hidden = false;
        for (const b of bets) {
          const tr = document.createElement("tr");
          const td1 = document.createElement("td");
          const key = b.selectionKey || (Array.isArray(b.horseNos) ? b.horseNos.join(",") : "");
          td1.textContent = key ? `連贏 ${key}` : formatHorseCellForReceipt(b.horseNo);
          const td2 = document.createElement("td");
          td2.textContent = formatHkdHk(b.stake);
          const td3 = document.createElement("td");
          td3.textContent = b.odds != null ? String(b.odds) : "—";
          tr.appendChild(td1);
          tr.appendChild(td2);
          tr.appendChild(td3);
          tbody.appendChild(tr);
        }
        const trf = document.createElement("tr");
        const tdf1 = document.createElement("td");
        tdf1.textContent = "合計";
        const tdf2 = document.createElement("td");
        tdf2.textContent = formatHkdHk(total);
        const tdf3 = document.createElement("td");
        tdf3.textContent = "";
        trf.appendChild(tdf1);
        trf.appendChild(tdf2);
        trf.appendChild(tdf3);
        tfoot.appendChild(trf);
      } else {
        table.hidden = true;
        allocHead.hidden = true;
      }
    }

    if (pre) {
      try {
        pre.textContent = JSON.stringify(record, null, 2);
      } catch {
        pre.textContent = String(record);
      }
    }

    const empty = $("#history-detail-empty");
    if (empty) empty.hidden = true;
    wrap.hidden = false;
  }

  /** 預設詳情：接口 rows 通常已按時間倒序，否則按 createTime / betSlipId 取最新 */
  function pickDefaultHistoryRow(rows) {
    if (!Array.isArray(rows) || !rows.length) return null;
    const sorted = [...rows].sort((a, b) => {
      const ta = Date.parse(String(a?.createTime || "").replace(" ", "T")) || 0;
      const tb = Date.parse(String(b?.createTime || "").replace(" ", "T")) || 0;
      if (tb !== ta) return tb - ta;
      return Number(b?.betSlipId) - Number(a?.betSlipId);
    });
    return sorted[0];
  }

  async function openBetHistoryDetail(betSlipId, cachedRow) {
    const id = Number(betSlipId);
    if (!Number.isFinite(id) || id <= 0) return;
    selectedHistorySlipId = id;
    $$(".history-item", $("#history-list")).forEach((el) => {
      el.classList.toggle("is-active", Number(el.dataset.slipId) === id);
    });
    try {
      const res = await apiFetch(`/api/bet/${encodeURIComponent(String(id))}`, { method: "GET" });
      const json = await readBetApiJson(res);
      const data = json.data && typeof json.data === "object" ? json.data : json;
      renderBetHistoryDetail(data);
    } catch (e) {
      if (String(e?.message || "").includes("UNAUTHORIZED")) return;
      if (cachedRow) {
        renderBetHistoryDetail(cachedRow);
        toast("無法載入詳情，已顯示列表摘要");
      } else {
        toast("無法載入注單詳情，請稍後重試");
      }
    }
  }

  /**
   * 下注服務 history 為分頁：total=總條數，rows=當前頁（預設常僅 10 條）。
   * 使用若依常見參數 pageNum / pageSize 循環拉取直至齊全。
   */
  async function fetchBetHistoryAll() {
    const pageSize = 100;
    let pageNum = 1;
    const all = [];
    let total = 0;

    for (;;) {
      const res = await apiFetch(
        `/api/bet/history?pageNum=${encodeURIComponent(String(pageNum))}&pageSize=${encodeURIComponent(String(pageSize))}`,
        { method: "GET" }
      );
      const json = await readBetApiJson(res);
      if (json.total != null) total = Number(json.total) || 0;
      const rows = Array.isArray(json.rows) ? json.rows : [];
      if (!rows.length) break;

      const before = all.length;
      const seen = new Set(all.map((r) => r.betSlipId));
      for (const r of rows) {
        const id = r?.betSlipId;
        if (id == null || seen.has(id)) continue;
        seen.add(id);
        all.push(r);
      }
      if (all.length === before) break;

      if (rows.length < pageSize) break;
      if (total > 0 && all.length >= total) break;
      pageNum += 1;
      if (pageNum > 50) break;
    }

    return { rows: all, total: total || all.length };
  }

  function formatHistoryMetaText(shown, total) {
    const n = Number(shown) || 0;
    const t = Number(total);
    if (Number.isFinite(t) && t > 0 && n < t) {
      return `已顯示 ${n} 條，共 ${t} 條（接口分頁，未全部載入）`;
    }
    if (Number.isFinite(t) && t > 0) return `共 ${t} 條`;
    return `共 ${n} 條`;
  }

  function renderBetHistoryList(rows, total) {
    const list = $("#history-list");
    const empty = $("#history-empty");
    const meta = $("#history-meta");
    if (!list) return;
    list.replaceChildren();
    if (meta) {
      if (total != null || rows.length) {
        meta.textContent = formatHistoryMetaText(rows.length, total);
        meta.hidden = false;
      } else {
        meta.hidden = true;
      }
    }
    if (!rows.length) {
      if (empty) empty.hidden = false;
      hideHistoryDetail();
      return;
    }
    if (empty) empty.hidden = true;
    for (const row of rows) {
      const slipId = row.betSlipId;
      const li = document.createElement("li");
      li.className = "history-item";
      li.dataset.slipId = String(slipId ?? "");
      li.setAttribute("role", "listitem");
      const st = betSlipStatusLabel(row);
      li.innerHTML = `<div class="history-item__row"><span class="history-item__id">#${slipId}</span><span class="history-item__status ${st.cls}">${st.text}</span></div><div class="history-item__sub">${poolCodeToHk(row.poolType)} · ${formatRaceIdShort(row.raceId)} · ${formatHkdHk(row.totalStake)}</div><div class="history-item__sub history-item__combo">${historySelectionSummary(row)}</div><div class="history-item__time">${row.createTime || ""}</div>`;
      li.addEventListener("click", () => {
        const idNum = Number(slipId);
        if (Number.isFinite(idNum) && idNum > 0 && selectedHistorySlipId === idNum) {
          hideHistoryDetail();
          return;
        }
        void openBetHistoryDetail(slipId, row);
      });
      list.appendChild(li);
    }

    const keep =
      selectedHistorySlipId &&
      rows.find((r) => Number(r.betSlipId) === Number(selectedHistorySlipId));
    const openRow = keep || pickDefaultHistoryRow(rows);
    if (openRow?.betSlipId != null) {
      void openBetHistoryDetail(openRow.betSlipId, openRow);
    } else {
      hideHistoryDetail();
    }
  }

  async function loadBetHistoryPanel() {
    if (!auth?.token) {
      renderBetHistoryList([], 0);
      const empty = $("#history-empty");
      if (empty) {
        empty.textContent = "請先登入後查看注單記錄。";
        empty.hidden = false;
      }
      return;
    }
    const seq = ++historyLoadSeq;
    const list = $("#history-list");
    if (list) {
      list.replaceChildren();
      const li = document.createElement("li");
      li.className = "history-item history-item--loading";
      li.textContent = "載入中…";
      list.appendChild(li);
    }
    hideHistoryDetail();
    try {
      const { rows, total } = await fetchBetHistoryAll();
      if (seq !== historyLoadSeq) return;
      renderBetHistoryList(rows, total);
    } catch (e) {
      if (seq !== historyLoadSeq) return;
      if (String(e?.message || "").includes("UNAUTHORIZED")) return;
      renderBetHistoryList([], null);
      const empty = $("#history-empty");
      if (empty) {
        empty.textContent = String(e?.message || e).slice(0, 200);
        empty.hidden = false;
      }
    }
  }

  function sortedNumericSelections() {
    return [...selectedNums]
      .filter((x) => /^\d+$/.test(x))
      .map(Number)
      .sort((a, b) => a - b);
  }

  /** 馬號網格上方：已選摘要（連贏膽拖為 膽 > 配腳） */
  function renderSelectionSummary() {
    const wrap = $("#num-pick-summary");
    const main = $("#num-pick-summary-main");
    if (!wrap || !main) return;

    const nums = sortedNumericSelections();
    if (activeCategory === "race" || activeCategory === "history" || nums.length === 0) {
      wrap.hidden = true;
      main.innerHTML = "";
      return;
    }

    wrap.hidden = false;
    main.innerHTML = "";

    const mkChip = (text, cls) => {
      const s = document.createElement("span");
      s.className = `num-pick-summary__chip ${cls}`;
      s.textContent = text;
      return s;
    };

    if (isPairGridMode() && bankerMode && bankerNum) {
      const row = document.createElement("div");
      row.className = "num-pick-summary__row";
      row.setAttribute("role", "group");
      const bn = String(bankerNum);
      row.appendChild(mkChip(bn, "num-pick-summary__chip--banker"));
      const sep = document.createElement("span");
      sep.className = "num-pick-summary__sep";
      sep.textContent = ">";
      sep.setAttribute("aria-hidden", "true");
      row.appendChild(sep);
      const legsWrap = document.createElement("div");
      legsWrap.className = "num-pick-summary__legs";
      const legs = nums.filter((n) => String(n) !== bn);
      if (legs.length === 0) {
        const ph = document.createElement("span");
        ph.className = "num-pick-summary__placeholder";
        ph.textContent = "於下方點選配腳";
        legsWrap.appendChild(ph);
      } else {
        legs.forEach((n) => legsWrap.appendChild(mkChip(String(n), "num-pick-summary__chip--leg")));
      }
      row.appendChild(legsWrap);
      main.appendChild(row);
      return;
    }

    const row = document.createElement("div");
    row.className = "num-pick-summary__row";
    const lbl = document.createElement("span");
    lbl.className = "num-pick-summary__lbl";
    lbl.textContent = "已選";
    row.appendChild(lbl);
    let anyWinOddsIssue = false;
    nums.forEach((n) => {
      let cls = "num-pick-summary__chip--plain";
      if (activeCategory === "win" && dutchStakeAppliesOnScreen()) {
        const iss = winOddsIssueForHorse(n);
        if (iss) {
          cls = "num-pick-summary__chip--no-odds";
          anyWinOddsIssue = true;
        }
      }
      if (activeCategory === "pla" && dutchStakeAppliesOnScreen()) {
        const iss = placeOddsIssueForHorse(n);
        if (iss) {
          cls = "num-pick-summary__chip--no-odds";
          anyWinOddsIssue = true;
        }
      }
      row.appendChild(mkChip(String(n), cls));
    });
    if (anyWinOddsIssue) {
      const note = document.createElement("span");
      note.className = "num-pick-summary__dutch-note";
      note.textContent =
        activeCategory === "pla"
          ? "標紅馬號缺有效位置 P，無法按 Dutch 加入注項"
          : "標紅馬號缺有效獨贏 W，無法按 Dutch 加入注項";
      row.appendChild(note);
    }
    main.appendChild(row);
  }

  function clearPicksFromUser() {
    selectedNums.clear();
    bankerNum = null;
    bankerMode = false;
    renderNums();
    updateRuleHint();
    updateStatus();
    toast("已清空選號");
  }

  /** 香港連贏注數 */
  function qinellaBetLines() {
    if (bankerMode) {
      if (!bankerNum) return 0;
      const legs = [...selectedNums].filter((x) => x !== bankerNum && /^\d+$/.test(x));
      return legs.length;
    }
    const n = sortedNumericSelections().length;
    if (n < 2) return 0;
    return (n * (n - 1)) / 2;
  }

  function comboCountPairwise(nums) {
    const n = nums.length;
    if (n < 2) return 0;
    return (n * (n - 1)) / 2;
  }

  function nCk(n, k) {
    if (!Number.isFinite(n) || !Number.isFinite(k) || n < 0 || k < 0) return 0;
    if (k > n) return 0;
    if (k === 0 || k === n) return 1;
    const kk = Math.min(k, n - k);
    let res = 1;
    for (let i = 1; i <= kk; i += 1) {
      res = (res * (n - kk + i)) / i;
    }
    return Math.round(res);
  }

  function nPk(n, k) {
    if (!Number.isFinite(n) || !Number.isFinite(k) || n < 0 || k < 0) return 0;
    if (k > n) return 0;
    let res = 1;
    for (let i = 0; i < k; i += 1) res *= n - i;
    return res;
  }

  function combinations(arr, k) {
    const res = [];
    const a = [...arr];
    if (k <= 0) return [[]];
    if (a.length < k) return [];
    const pick = (start, cur) => {
      if (cur.length === k) {
        res.push([...cur]);
        return;
      }
      for (let i = start; i < a.length; i += 1) {
        cur.push(a[i]);
        pick(i + 1, cur);
        cur.pop();
      }
    };
    pick(0, []);
    return res;
  }

  function permutations(arr, k) {
    const res = [];
    const a = [...arr];
    if (k <= 0) return [[]];
    if (a.length < k) return [];
    const used = new Array(a.length).fill(false);
    const cur = [];
    const dfs = () => {
      if (cur.length === k) {
        res.push([...cur]);
        return;
      }
      for (let i = 0; i < a.length; i += 1) {
        if (used[i]) continue;
        used[i] = true;
        cur.push(a[i]);
        dfs();
        cur.pop();
        used[i] = false;
      }
    };
    dfs();
    return res;
  }

  function betLines() {
    const nums = sortedNumericSelections();
    switch (activeCategory) {
      case "qin":
      case "qpl":
        return qinellaBetLines();
      case "win":
      case "pla":
        return nums.length >= 1 ? nums.length : 0;
      case "fc":
        // 二重（Forecast）：順序有關，2 取 2 排列
        return nPk(nums.length, 2);
      case "tr":
        // 三重（Trio）：順序不拘，3 取 3 組合
        return nCk(nums.length, 3);
      case "tierce":
        // 單 T（Tierce）：順序有關，3 取 3 排列
        return nPk(nums.length, 3);
      case "qtt":
        // 四連（Quartet）：順序有關，4 取 4 排列
        return nPk(nums.length, 4);
      case "f4":
        // 四重（First 4）：順序不拘，4 取 4 組合
        return nCk(nums.length, 4);
      default:
        return comboCountPairwise(nums);
    }
  }

  function buildMeetingSessionCurHtml() {
    const cur = hkjcMeeting;
    const dateStr = formatMeetingDateForUi(cur?.date);
    const venueStr = venueDisplayLabelFromMeeting(cur) || venue;
    const parts = [dateStr, venueStr, `第 ${raceNo} 場`].filter(Boolean);
    if (!parts.length) return `當前：<strong>第 ${raceNo} 場</strong>`;
    return `當前：<strong>${parts.join(" · ")}</strong>`;
  }

  function buildRacePanelHintHtml() {
    return (
      `${buildMeetingSessionCurHtml()}。` +
      "先選<strong>賽馬日</strong>、<strong>馬場</strong>與<strong>場序</strong>（當日第幾場，非馬號）。" +
      "選好後請到「獨贏」「位置」「連贏」或「位置Q」用<strong>馬號</strong>選馬下注。"
    );
  }

  function syncAsideStakeWarn(perForHint, lines, inputVal) {
    const el = $("#rule-hint");
    if (!el) return;
    const apply =
      activeCategory === "qin" ||
      activeCategory === "qpl" ||
      activeCategory === "win" ||
      activeCategory === "pla";
    const stakeLowStd =
      apply && lines > 0 && inputVal > 0 && perForHint < HKJC.MIN_HKD_PER_LINE;
    let existing = el.querySelector(".rule-hint__warn");
    if (stakeLowStd) {
      const pool =
        activeCategory === "qin"
          ? "連贏"
          : activeCategory === "qpl"
            ? "位置Q"
            : activeCategory === "pla"
              ? "位置"
              : "獨贏";
      const warn = `當前每注約 $${Math.round(perForHint * 100) / 100}，標準${pool}注每注一般不低於 $${HKJC.MIN_HKD_PER_LINE}。`;
      if (!existing) {
        existing = document.createElement("p");
        existing.className = "rule-hint__warn aside-panel__warn";
        el.appendChild(existing);
      }
      existing.textContent = warn;
      el.hidden = false;
    } else {
      if (existing) existing.remove();
      if (apply && !el.textContent.trim() && !el.querySelector(".rule-hint__warn")) el.hidden = true;
    }
  }

  function updateRuleHint() {
    const el = $("#rule-hint");
    if (!el) return;
    if (
      activeCategory === "qin" ||
      activeCategory === "qpl" ||
      activeCategory === "win" ||
      activeCategory === "pla"
    ) {
      const warn = el.querySelector(".rule-hint__warn");
      el.textContent = "";
      if (warn) el.appendChild(warn);
      el.hidden = !warn;
      delete el.dataset.mode;
    } else if (activeCategory === "fc") {
      el.innerHTML =
        "<strong>二重（Forecast）</strong>：選中該場<strong>頭馬 + 二馬</strong>，<strong>需順序正確</strong>。" +
        "複式：從所選 <em>n</em> 匹馬中取 2 匹作排列，注數 = <em>n×(n−1)</em>。" +
        `馬號 1–${maxRunnersForRace} 對應出馬編號。標準注一般每注最低 <strong>$${HKJC.MIN_HKD_PER_LINE}</strong>。` +
        "<br /><span class=\"rule-hint__sub\">本面板僅供本地試算，不構成投注建議。</span>";
      el.hidden = false;
      delete el.dataset.mode;
    } else if (activeCategory === "tr") {
      el.innerHTML =
        "<strong>三重（Trio）</strong>：選中該場<strong>前三名</strong>的 3 匹馬，<strong>先後次序不拘</strong>。" +
        "複式：所選 <em>n</em> 匹馬組成所有三馬組合，注數 = <em>C(n,3)</em>。" +
        `馬號 1–${maxRunnersForRace} 對應出馬編號。標準注一般每注最低 <strong>$${HKJC.MIN_HKD_PER_LINE}</strong>。` +
        "<br /><span class=\"rule-hint__sub\">本面板僅供本地試算，不構成投注建議。</span>";
      el.hidden = false;
      delete el.dataset.mode;
    } else if (activeCategory === "tierce") {
      el.innerHTML =
        "<strong>單 T（Tierce）</strong>：選中該場<strong>一、二、三名</strong>馬匹，<strong>需順序正確</strong>。" +
        "複式：從所選 <em>n</em> 匹馬中取 3 匹作排列，注數 = <em>n×(n−1)×(n−2)</em>。" +
        `馬號 1–${maxRunnersForRace} 對應出馬編號。標準注一般每注最低 <strong>$${HKJC.MIN_HKD_PER_LINE}</strong>。` +
        "<br /><span class=\"rule-hint__sub\">本面板僅供本地試算，不構成投注建議。</span>";
      el.hidden = false;
      delete el.dataset.mode;
    } else if (activeCategory === "qtt") {
      el.innerHTML =
        "<strong>四連（Quartet）</strong>：選中該場<strong>一、二、三、四名</strong>馬匹，<strong>需順序正確</strong>。" +
        "複式：從所選 <em>n</em> 匹馬中取 4 匹作排列，注數 = <em>P(n,4)</em>。" +
        `馬號 1–${maxRunnersForRace} 對應出馬編號。標準注一般每注最低 <strong>$${HKJC.MIN_HKD_PER_LINE}</strong>。` +
        "<br /><span class=\"rule-hint__sub\">本面板僅供本地試算，不構成投注建議。</span>";
      el.hidden = false;
      delete el.dataset.mode;
    } else if (activeCategory === "f4") {
      el.innerHTML =
        "<strong>四重（First 4）</strong>：選中該場<strong>前四名</strong>的 4 匹馬，<strong>先後次序不拘</strong>。" +
        "複式：所選 <em>n</em> 匹馬組成所有四馬組合，注數 = <em>C(n,4)</em>。" +
        `馬號 1–${maxRunnersForRace} 對應出馬編號。標準注一般每注最低 <strong>$${HKJC.MIN_HKD_PER_LINE}</strong>。` +
        "<br /><span class=\"rule-hint__sub\">本面板僅供本地試算，不構成投注建議。</span>";
      el.hidden = false;
      delete el.dataset.mode;
    } else if (activeCategory === "dbl") {
      el.innerHTML =
        "<strong>孖寶（Double）</strong>：通常需跨<strong>兩場</strong>選擇指定名次（常見為獨贏）組合。" +
        "當前面板為單場選號模型，尚未實現跨場次兩關選擇，因此僅展示佔位。" +
        "<br /><span class=\"rule-hint__sub\">如需接入孖寶，請明確後端接口與兩場選擇 UI 規則。</span>";
      el.hidden = false;
      delete el.dataset.mode;
    } else if (activeCategory === "922") {
      el.innerHTML =
        "<strong>9.2.2</strong>：屬於特定彩池/組合玩法（通常涉及多場或特定規則）。" +
        "當前面板尚未實現該玩法的規則與組合生成，僅展示佔位。" +
        "<br /><span class=\"rule-hint__sub\">如需接入，請提供 HKJC 玩法定義與後端入參結構。</span>";
      el.hidden = false;
      delete el.dataset.mode;
    } else if (activeCategory === "range") {
      el.innerHTML =
        "<strong>範圍</strong>：這是選號輔助/篩選工具的佔位，不是 HKJC 標準彩池玩法。" +
        "當前未實現獨立規則與注單生成。";
      el.hidden = false;
      delete el.dataset.mode;
    } else if (activeCategory === "history") {
      el.textContent = "";
      el.hidden = true;
      delete el.dataset.mode;
    } else if (activeCategory === "race") {
      el.textContent = "";
      el.hidden = true;
      delete el.dataset.mode;
    } else {
      el.textContent = "";
      el.hidden = true;
    }
  }

  /** 依文案推斷提示類型（success / warn / error / info） */
  function classifyNotifyType(msg) {
    const s = String(msg || "");
    if (/失敗|無法|錯誤|不足|缺少|未就緒|不一致|無效|无效|尚未開|尚未實|误生成|未能/.test(s)) return "error";
    if (/已加入|已成功|登入成功|已刷新|已儲存|已清空|已刪除|已選擇|已複製|就緒/.test(s)) return "success";
    if (/請先|請在|注意|部分|四捨五入|將分兩行|暂|暫不|尚未|僅支持|拆賬需要/.test(s)) return "warn";
    return "info";
  }

  /** 與注單操作強相關 → 貼在按鈕上方；其餘 → 頂部輕提示 */
  function preferActionFeedback(msg, type) {
    const s = String(msg || "");
    if (type === "error" && /同步|馬會|加入|注單|Dutch 拆賬/.test(s)) return true;
    if (/已加入|同步|馬會|注單已|清空注單|加入馬會投注區/.test(s)) return true;
    return false;
  }

  function notifyVisibleMs(msg, type) {
    const n = String(msg || "").trim().length;
    if (type === "success") return Math.min(4200, Math.max(2400, 2200 + n * 35));
    if (type === "error") return Math.min(12000, Math.max(6000, 4500 + n * 45));
    if (type === "warn") return Math.min(9000, Math.max(4000, 3200 + n * 40));
    return Math.min(7000, Math.max(2800, 2600 + n * 40));
  }

  function hideActionFeedback() {
    const bar = $("#action-feedback");
    if (!bar) return;
    bar.hidden = true;
    bar.className = "action-feedback";
    const text = $("#action-feedback-text");
    if (text) text.textContent = "";
    if (actionFeedbackTimer) {
      window.clearTimeout(actionFeedbackTimer);
      actionFeedbackTimer = null;
    }
  }

  function showActionFeedback(msg, type, opts = {}) {
    const bar = $("#action-feedback");
    const text = $("#action-feedback-text");
    if (!bar || !text) return;
    hideActionFeedback();
    bar.className = `action-feedback action-feedback--${type}`;
    text.textContent = String(msg || "").trim();
    bar.hidden = false;
    const persist = opts.persist ?? type === "error";
    if (!persist) {
      actionFeedbackTimer = window.setTimeout(hideActionFeedback, notifyVisibleMs(msg, type));
    }
  }

  function dismissNotifyCard(card) {
    if (!card) return;
    const t = notifyCardTimers.get(card);
    if (t) {
      window.clearTimeout(t);
      notifyCardTimers.delete(card);
    }
    card.remove();
  }

  function pushNotifyCard(msg, type, opts = {}) {
    const stack = $("#notify-stack");
    if (!stack) return;
    const text = String(msg || "").trim();
    if (!text) return;

    while (stack.children.length >= 2) {
      dismissNotifyCard(stack.firstElementChild);
    }

    const card = document.createElement("div");
    card.className = `notify-card notify-card--${type}`;
    card.setAttribute("role", "status");

    const icon = document.createElement("span");
    icon.className = "notify-card__icon";
    icon.setAttribute("aria-hidden", "true");

    const body = document.createElement("span");
    body.className = "notify-card__text";
    body.textContent = text;

    const close = document.createElement("button");
    close.type = "button";
    close.className = "notify-card__close";
    close.setAttribute("aria-label", "關閉");
    close.textContent = "×";
    close.addEventListener("click", () => dismissNotifyCard(card));

    card.append(icon, body, close);
    stack.appendChild(card);

    const persist = opts.persist ?? type === "error";
    if (!persist) {
      const timer = window.setTimeout(() => dismissNotifyCard(card), notifyVisibleMs(text, type));
      notifyCardTimers.set(card, timer);
    }
  }

  /**
   * 統一提示：操作類貼按鈕區；其餘頂部卡片。可選 opts.type / opts.persist / opts.anchor('action'|'top')
   */
  function toast(msg, opts = {}) {
    const text = String(msg || "").trim();
    if (!text) return;
    const type = opts.type || classifyNotifyType(text);
    const anchor =
      opts.anchor || (preferActionFeedback(text, type) ? "action" : "top");
    if (anchor === "action") {
      showActionFeedback(text, type, opts);
    } else {
      pushNotifyCard(text, type, opts);
    }
  }

  function setLoginError(msg) {
    const el = $("#login-error");
    if (!el) return;
    el.textContent = msg;
    el.hidden = !msg;
  }

  function setLoginLoading(loading) {
    const btn = $("#btn-login");
    if (!btn) return;
    btn.disabled = loading;
    btn.textContent = loading ? "登入中…" : "登入";
  }

  async function handleLoginSubmit(e) {
    e.preventDefault();
    setLoginError("");
    const baseInput = String($("#login-base")?.value || "").trim();
    const username = String($("#login-username")?.value || "").trim();
    const password = String($("#login-password")?.value || "").trim();
    const remember = Boolean($("#remember-username")?.checked);
    if (baseInput) apiBase = baseInput.replace(/\/+$/, "");
    if (!username || !password) {
      setLoginError("請輸入用戶名和密碼");
      return;
    }
    setLoginLoading(true);
    try {
      const body = { username, password };
      await storageSet({ [API_BASE_KEY]: apiBase });
      const res = await apiFetch("/login", {
        method: "POST",
        body: JSON.stringify(body),
        skipAuthRedirect: true,
      });
      const ct = (res.headers.get("content-type") || "").toLowerCase();
      const rawText = await res.text().catch(() => "");
      const json = ct.includes("application/json")
        ? (() => {
            try {
              return JSON.parse(rawText || "{}");
            } catch {
              return {};
            }
          })()
        : {};
      const token = findToken(json);
      if (!res.ok) {
        const msg = json?.msg || json?.message || `登入失敗（HTTP ${res.status}）`;
        const snippet = String(rawText || "").trim().slice(0, 220);
        setLoginError(`${String(msg)}\n伺服器：${apiBase}\n回應：${snippet || "(空)"}`);
        return;
      }
      if (!token) {
        const snippet = String(rawText || "").trim().slice(0, 220);
        setLoginError(
          `登入成功但未解析到 token（請確認後端返回欄位，如 token / data.token）\n伺服器：${apiBase}\n回應：${snippet || "(空)"}`
        );
        return;
      }
      auth = { token, username };
      resetSessionExpiredGuard();
      await saveAuth();
      if (remember) {
        await storageSet({
          [REMEMBER_USERNAME_KEY]: username,
          [REMEMBER_PASSWORD_KEY]: password,
          [REMEMBER_ENABLED_KEY]: true,
        });
      } else {
        await storageRemove(REMEMBER_USERNAME_KEY);
        await storageRemove(REMEMBER_PASSWORD_KEY);
        await storageSet({ [REMEMBER_ENABLED_KEY]: false });
      }
      // 若用戶未選擇記住密碼，則清空輸入框
      if (!remember) $("#login-password").value = "";
      showView(true);
      authInitDone = true;
      restartOddsAutoRefresh();
      void ensureMeetingLoaded().then(async (ok) => {
        if (!ok) {
          toast("登入成功");
          return;
        }
        renderRacePanel();
        syncTopbarRace();
        renderNums();
        updateRuleHint();
        const openedHkjc = await openHkjcBettingPageIfNeeded();
        toast(openedHkjc ? "登入成功，已打開馬會投注頁" : "登入成功");
      });
    } catch (err) {
      if (String(err?.message || "").includes("UNAUTHORIZED")) return;
      setLoginError(`網絡或服務異常，請稍後重試\n伺服器：${apiBase}`);
    } finally {
      setLoginLoading(false);
    }
  }

  function syncTopbarRace() {
    const v = document.querySelector(".topbar__venue");
    const n = document.querySelector(".topbar__num");
    const wrap = $("#topbar-date-wrap");
    const dEl = $("#topbar-meeting-date");
    if (v) v.textContent = venue;
    if (n) n.textContent = String(raceNo);
    const d = formatMeetingDateForUi(hkjcMeeting?.date);
    if (wrap && dEl) {
      if (d) {
        dEl.textContent = d;
        wrap.hidden = false;
      } else {
        dEl.textContent = "";
        wrap.hidden = true;
      }
    }
    const raceBtn = $("#btn-top-race");
    if (raceBtn) {
      const st = currentBetRaceStatus();
      let title = "切換場次";
      if (st) title += ` · ${st}`;
      raceBtn.title = title;
    }
  }

  function setModeVisibility() {
    const racePanel = $("#race-panel");
    const showRace = activeCategory === "race";
    const showHistory = activeCategory === "history";
    if (racePanel) racePanel.hidden = !showRace;

    const setHidden = (sel, hidden) => {
      const el = typeof sel === "string" ? $(sel) : sel;
      if (el) el.hidden = Boolean(hidden);
    };

    setHidden("#history-panel", !showHistory);

    const hideBetting = showRace || showHistory;
    const ws = $("#workspace");
    if (ws) ws.classList.toggle("workspace--no-dock", hideBetting);
    setHidden("#workspace-dock", hideBetting);
    setHidden("#num-pick-summary", hideBetting);
    setHidden("#num-grid", hideBetting);
    setHidden(
      "#rule-hint",
      hideBetting ||
      activeCategory === "win" ||
      activeCategory === "pla" ||
      activeCategory === "qin" ||
      activeCategory === "qpl"
    );
    setHidden("#qin-combo-inline-wrap", hideBetting);
    setHidden(document.querySelector(".modifier-row"), hideBetting);
    setHidden("#stake-custom-row", hideBetting);
    setHidden("#amount-grid", hideBetting);
    setHidden(
      "#dutch-stake-row",
      hideBetting ||
      (activeCategory !== "win" &&
        activeCategory !== "pla" &&
        activeCategory !== "qin" &&
        activeCategory !== "qpl")
    );

    syncPoolModesChrome();
    syncStakeRowChrome();
  }

  /** 獨贏／連贏：隱藏易誤導 chip；右側僅注單記錄顯示詳情 */
  function syncPoolModesChrome() {
    const hideModifiers = activeCategory === "win" || activeCategory === "pla";
    const mod = $("#modifier-row");
    if (mod && activeCategory !== "race") mod.hidden = hideModifiers;

    const showPanels = activeCategory === "history";
    const panelsEl = document.querySelector(".panels");
    if (panelsEl) panelsEl.hidden = !showPanels;
    document.querySelector(".body")?.classList.toggle("body--panels-hidden", !showPanels);

    const historyAside = $("#aside-history-only");
    if (historyAside) historyAside.hidden = activeCategory !== "history";

    const qInline = $("#qin-combo-inline-wrap");
    if (qInline) qInline.hidden = !isPairGridMode();
  }

  function renderRacePanel() {
    const datesEl = $("#race-dates");
    const venuesEl = $("#race-venues");
    const racesEl = $("#race-races");
    if (!venuesEl || !racesEl) return;

    const catalog = meetingsCatalog.length ? meetingsCatalog : hkjcMeeting ? [hkjcMeeting] : [];
    const cur = hkjcMeeting || catalog[0] || null;
    const curDateKey = cur ? meetingDateKey(cur) : "";

    const dateKeys = [...new Set(catalog.map((m) => meetingDateKey(m)).filter(Boolean))].sort();
    const dr = $("#race-panel-date-row");
    if (datesEl && dr) {
      datesEl.innerHTML = "";
      if (dateKeys.length <= 1 && !dateKeys[0]) {
        dr.hidden = true;
      } else {
        dr.hidden = false;
        dateKeys.forEach((dk) => {
          const b = document.createElement("button");
          b.type = "button";
          b.className = "seg-btn" + (dk === curDateKey ? " is-on" : "");
          b.textContent = formatDateKeyForUi(dk);
          b.title = dk;
          b.addEventListener("click", () => {
            const onDay = catalog.filter((m) => meetingDateKey(m) === dk);
            if (!onDay.length) return;
            const keepVenue = onDay.find(
              (m) => meetingCatalogKey(m) === (cur ? meetingCatalogKey(cur) : "")
            );
            const prevKey = cur ? meetingCatalogKey(cur) : "";
            const pick =
              keepVenue && meetingDateKey(keepVenue) === dk
                ? keepVenue
                : onDay.find((m) => meetingCatalogKey(m) === prevKey) || onDay[0];
            switchToCatalogMeeting(pick);
            toast(`已選擇：${formatDateKeyForUi(dk)} · ${venueDisplayLabelFromMeeting(pick)}`);
          });
          datesEl.appendChild(b);
        });
      }
    }

    const meetingsOnDate = catalog.filter((m) => meetingDateKey(m) === curDateKey);
    venuesEl.innerHTML = "";
    if (!meetingsOnDate.length && cur) meetingsOnDate.push(cur);
    meetingsOnDate.forEach((m) => {
      const label = venueDisplayLabelFromMeeting(m);
      const b = document.createElement("button");
      b.type = "button";
      const on = cur && meetingCatalogKey(m) === meetingCatalogKey(cur);
      b.className = "seg-btn" + (on ? " is-on" : "");
      b.textContent = label;
      const st = String(m?.status ?? "").trim();
      b.title = st ? `${label} · ${st}` : label;
      b.addEventListener("click", () => {
        if (on) return;
        switchToCatalogMeeting(m);
        toast(`已選擇：${formatDateKeyForUi(meetingDateKey(m))} · ${label} · 第${raceNo}場`);
      });
      venuesEl.appendChild(b);
    });

    racesEl.innerHTML = "";
    const raceList = Array.isArray(cur?.races) ? [...cur.races] : [];
    raceList.sort((a, b) => raceNumberFromRecord(a) - raceNumberFromRecord(b));
    const renderRaceBtn = (no, titleExtra) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "seg-btn" + (no === raceNo ? " is-on" : "");
      b.textContent = String(no);
      b.title = titleExtra || `第${no}場`;
      b.setAttribute("aria-label", `第${no}場`);
      b.addEventListener("click", () => {
        if (no === raceNo) return;
        raceNo = no;
        selectedNums.clear();
        bankerNum = null;
        bankerMode = false;
        applyRaceMetaFromMeeting();
        updateRuleHint();
        renderRacePanel();
        syncTopbarRace();
        renderNums();
        updateStatus();
        fetchRaceOddsFromApi();
        toast(`已選擇：${venue} · 第${raceNo}場`);
      });
      racesEl.appendChild(b);
    };

    if (raceList.length) {
      raceList.forEach((r) => {
        const no = raceNumberFromRecord(r);
        if (!Number.isFinite(no) || no <= 0) return;
        const st = String(r?.status ?? r?.betRaceStatus ?? "").trim();
        renderRaceBtn(no, st ? `第${no}場 · ${st}` : `第${no}場`);
      });
    } else {
      const totalRace = Number(cur?.totalNumberOfRace || 0) || 12;
      for (let i = 1; i <= totalRace; i += 1) renderRaceBtn(i);
    }

    const hint = $("#race-panel-hint");
    if (hint) hint.innerHTML = buildRacePanelHintHtml();
  }

  function fmtMoney(n) {
    return `$${Number(n).toLocaleString("zh-HK")}`;
  }

  /** 四捨五入至整數十位（馬會不接受個位金額） */
  function roundToNearestTen(amount) {
    const x = Number(amount);
    if (!Number.isFinite(x)) return 0;
    return Math.round(x / HKJC.STAKE_TEN_STEP) * HKJC.STAKE_TEN_STEP;
  }

  /** 與馬會同步一致：十位四捨五入，最低 $10 */
  function stakeForHkjc(amount) {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.max(HKJC.MIN_HKD_PER_LINE, roundToNearestTen(n));
  }

  /**
   * Dutch 本輪總投：讀取後按十位四捨五入，可回寫輸入框並提示。
   * @returns {{ raw: number, rounded: number, adjustedTotal: boolean }}
   */
  function readDutchTotalStake(opts = {}) {
    const raw = Math.max(0, Math.round(readStakePerLine()));
    const rounded = Math.max(HKJC.MIN_HKD_PER_LINE, roundToNearestTen(raw));
    const adjustedTotal = raw !== rounded;
    if (opts.updateInput && adjustedTotal) {
      unitAmount = rounded;
      const inp = $("#stake-custom");
      if (inp && document.activeElement !== inp) inp.value = String(rounded);
    }
    if (opts.toastIfAdjusted && adjustedTotal && raw > 0) {
      toast(`馬會不接受個位金額：${fmtMoney(raw)} 已四捨五入為 ${fmtMoney(rounded)}`);
    }
    return { raw, rounded, adjustedTotal };
  }

  /**
   * Dutch 拆賬後各注亦須為十位，並使合計等於已四捨五入的總投。
   */
  function finalizeDutchStakes(stakes, targetTotalRounded) {
    const n = stakes.length;
    if (!n) return { stakes: [], total: 0, adjustedLines: false };
    const minTotal = n * HKJC.MIN_HKD_PER_LINE;
    let T = Math.max(minTotal, roundToNearestTen(targetTotalRounded));

    let out = stakes.map((s) => Math.max(HKJC.MIN_HKD_PER_LINE, roundToNearestTen(s)));
    let sum = out.reduce((a, b) => a + b, 0);
    let guard = 0;
    while (sum !== T && guard < n * 400) {
      const diff = T - sum;
      const step = diff > 0 ? HKJC.STAKE_TEN_STEP : -HKJC.STAKE_TEN_STEP;
      const idx = guard % n;
      const next = out[idx] + step;
      if (next >= HKJC.MIN_HKD_PER_LINE) {
        out[idx] = next;
        sum += step;
      }
      guard += 1;
    }
    const adjustedLines = out.some((s, i) => s !== stakes[i]);
    return { stakes: out, total: sum, adjustedLines };
  }

  function computeDutchStakesFromOdds(quotients, totalRaw) {
    const raw = Math.max(0, Math.round(Number(totalRaw) || 0));
    const rounded = Math.max(HKJC.MIN_HKD_PER_LINE, roundToNearestTen(raw));
    const rawStakes = distributeDutchIntegerStakes(quotients, rounded);
    const fin = finalizeDutchStakes(rawStakes, rounded);
    return {
      stakes: fin.stakes,
      total: fin.total,
      rawTotal: raw,
      roundedTotal: rounded,
      adjustedTotal: raw !== rounded,
      adjustedLines: fin.adjustedLines,
    };
  }

  /** 每注金額：手輸框優先；空或無效時用下方快捷金額檔位 */
  function readStakePerLine() {
    const inp = $("#stake-custom");
    if (inp) {
      const raw = String(inp.value ?? "").trim();
      if (raw !== "") {
        const n = Math.round(Number(raw));
        if (Number.isFinite(n) && n > 0) return n;
      }
    }
    const u = Math.round(Number(unitAmount) || 0);
    return Math.max(0, u);
  }

  function syncStakeCustomInputFromUnitAmount() {
    const inp = $("#stake-custom");
    if (!inp) return;
    if (document.activeElement === inp) return;
    inp.value = String(unitAmount);
  }

  function dutchStakeAppliesOnScreen() {
    return (
      dutchStakeMode &&
      (activeCategory === "win" ||
        activeCategory === "pla" ||
        activeCategory === "qin" ||
        activeCategory === "qpl")
    );
  }

  function isPairGridMode() {
    return activeCategory === "qin" || activeCategory === "qpl";
  }

  async function applyDutchStakeMode(on) {
    const next = Boolean(on);
    if (dutchStakeMode === next) return;
    dutchStakeMode = next;
    syncDutchToggleChrome();
    await storageSet({ [DUTCH_STAKE_KEY]: dutchStakeMode });
    syncStakeRowChrome();
    updateRuleHint();
    updateStatus();
    updateComboOddsTables();
  }

  function syncDutchToggleChrome() {
    const wrap = $("#dutch-stake-control");
    const flatBtn = $("#btn-dutch-flat");
    const dutchBtn = $("#btn-dutch-on");
    const on = dutchStakeMode;

    if (wrap) wrap.dataset.mode = on ? "dutch" : "flat";

    if (flatBtn) {
      flatBtn.classList.toggle("is-active", !on);
      flatBtn.setAttribute("aria-pressed", !on ? "true" : "false");
    }
    if (dutchBtn) {
      dutchBtn.classList.toggle("is-active", on);
      dutchBtn.setAttribute("aria-pressed", on ? "true" : "false");
    }
  }

  function syncStakeRowChrome() {
    const row = $("#dutch-stake-row");
    if (row) {
      row.hidden =
        activeCategory === "race" ||
        (activeCategory !== "win" &&
          activeCategory !== "pla" &&
          activeCategory !== "qin" &&
          activeCategory !== "qpl");
    }
    const lbl = $("#stake-custom-label");
    if (lbl) {
      lbl.textContent = dutchStakeAppliesOnScreen() ? "本輪總投注（港幣，十位）" : "每注金額（港幣）";
    }
    const stakeInp = $("#stake-custom");
    if (stakeInp) stakeInp.step = dutchStakeAppliesOnScreen() ? "10" : "1";
    syncDutchOddsBanner();
  }

  /** W / QIN 作十進制「含本贏面倍率」(>1)，作 Dutch 權重 */
  function parseOddsToDecimalTotal(od) {
    if (od == null || String(od).trim() === "") return NaN;
    const n = Number(String(od).replace(",", "."));
    if (!Number.isFinite(n) || n <= 1.0001) return NaN;
    return n;
  }

  /** @returns {null|'missing'|'invalid'|'api_off'} */
  function winOddsIssueForHorse(horseNo) {
    if (!hkjcOddsUseApi) return "api_off";
    const raw = raceOddsMap.get(String(horseNo))?.win;
    if (raw == null || String(raw).trim() === "") return "missing";
    if (!Number.isFinite(parseOddsToDecimalTotal(raw))) return "invalid";
    return null;
  }

  function placeOddsIssueForHorse(horseNo) {
    if (!hkjcOddsUseApi) return "api_off";
    const raw = raceOddsMap.get(String(horseNo))?.place;
    if (raw == null || String(raw).trim() === "") return "missing";
    if (!Number.isFinite(parseOddsToDecimalTotal(raw))) return "invalid";
    return null;
  }

  function qinOddsIssueForPairKey(pairKey) {
    if (!hkjcOddsUseApi) return "api_off";
    const raw = qinOddsByPair.get(pairKey);
    if (raw == null || String(raw).trim() === "") return "missing";
    if (!Number.isFinite(parseOddsToDecimalTotal(raw))) return "invalid";
    return null;
  }

  function qplOddsIssueForPairKey(pairKey) {
    if (!hkjcOddsUseApi) return "api_off";
    const raw = qplOddsByPair.get(pairKey);
    if (raw == null || String(raw).trim() === "") return "missing";
    if (!Number.isFinite(parseOddsToDecimalTotal(raw))) return "invalid";
    return null;
  }

  function assessDutchOddsReadiness() {
    if (!dutchStakeAppliesOnScreen()) return { show: false };

    const apiOff = !hkjcOddsUseApi;
    const anyWinInMap = [...raceOddsMap.values()].some((v) => v.win && String(v.win).trim());

    if (activeCategory === "win") {
      const nums = sortedNumericSelections();
      if (!nums.length) {
        return {
          show: true,
          level: "info",
          title: "Dutch 獨贏",
          detail: "請先選擇馬號。加入注項前，所選每匹馬均需有效獨贏 W 賠率（馬號下顯示 W）。",
          canAdd: true,
        };
      }
      if (apiOff) {
        return {
          show: true,
          level: "error",
          title: "無法 Dutch 拆賬",
          detail: "設定中已關閉賠率接口。請開啓「請求接口賠率」並刷新，或關閉 Dutch 改用平注。",
          canAdd: false,
        };
      }
      const missing = [];
      const invalid = [];
      nums.forEach((n) => {
        const iss = winOddsIssueForHorse(n);
        if (iss === "missing") missing.push(n);
        else if (iss === "invalid") invalid.push(n);
      });
      if (!anyWinInMap && missing.length === nums.length) {
        return {
          show: true,
          level: "error",
          title: "本場未載入獨贏賠率",
          detail: `${oddsLoadStatus}。請點頂欄刷新，並在設定中確認賠率 types 含 WIN。`,
          canAdd: false,
          missing: nums,
        };
      }
      if (missing.length || invalid.length) {
        const parts = [];
        if (missing.length) parts.push(`缺少 W：${missing.join("、")}`);
        if (invalid.length) parts.push(`W 無法用於拆賬：${invalid.join("、")}`);
        return {
          show: true,
          level: "error",
          title: "無法按 Dutch 加入注項",
          detail: `${parts.join("；")}。常見於已停售/賽果場或賠率未更新；請換場、刷新，或關閉 Dutch。`,
          canAdd: false,
          missing,
          invalid,
        };
      }
      return {
        show: true,
        level: "ok",
        title: "Dutch 獨贏就緒",
        detail: `已選 ${nums.length} 匹，均有有效 W，可按「本輪總投注」自動拆至各注。`,
        canAdd: true,
      };
    }

    if (activeCategory === "pla") {
      const nums = sortedNumericSelections();
      if (!nums.length) {
        return {
          show: true,
          level: "info",
          title: "Dutch 位置",
          detail: "請先選擇馬號。加入注項前，所選每匹馬均需有效位置 P 賠率（馬號下顯示 P）。",
          canAdd: true,
        };
      }
      if (apiOff) {
        return {
          show: true,
          level: "error",
          title: "無法 Dutch 拆賬",
          detail: "設定中已關閉賠率接口。請開啓「請求接口賠率」並刷新，或關閉 Dutch 改用平注。",
          canAdd: false,
        };
      }
      const anyPlaInMap = [...raceOddsMap.values()].some((v) => v.place && String(v.place).trim());
      const missing = [];
      const invalid = [];
      nums.forEach((n) => {
        const iss = placeOddsIssueForHorse(n);
        if (iss === "missing") missing.push(n);
        else if (iss === "invalid") invalid.push(n);
      });
      if (!anyPlaInMap && missing.length === nums.length) {
        return {
          show: true,
          level: "error",
          title: "本場未載入位置賠率",
          detail: `${oddsLoadStatus}。請點頂欄刷新，並在設定中確認賠率 types 含 PLA。`,
          canAdd: false,
          missing: nums,
        };
      }
      if (missing.length || invalid.length) {
        const parts = [];
        if (missing.length) parts.push(`缺少 P：${missing.join("、")}`);
        if (invalid.length) parts.push(`P 無法用於拆賬：${invalid.join("、")}`);
        return {
          show: true,
          level: "error",
          title: "無法按 Dutch 加入位置",
          detail: `${parts.join("；")}。請換場、刷新，或關閉 Dutch。`,
          canAdd: false,
          missing,
          invalid,
        };
      }
      return {
        show: true,
        level: "ok",
        title: "Dutch 位置就緒",
        detail: `已選 ${nums.length} 匹，均有有效 P，可按「本輪總投注」自動拆至各注。`,
        canAdd: true,
      };
    }

    if (activeCategory === "qin") {
      const pairs = qinellaPairsFromSelection();
      if (!pairs.length) {
        return {
          show: true,
          level: "info",
          title: "Dutch 連贏",
          detail: "請先選馬形成組合。有 QIN 時按賠率拆賬；部分或全部缺 QIN 時，總投將按注數平分。",
          canAdd: true,
        };
      }
      const keys = pairs.map(([a, b]) => normalizePairKey(Number(a), Number(b))).filter(Boolean);
      if (keys.length !== pairs.length) {
        return {
          show: true,
          level: "error",
          title: "組合無效",
          detail: "請重選馬號後再加入注項。",
          canAdd: false,
        };
      }
      const missingQin = [];
      const invalidQin = [];
      keys.forEach((k) => {
        const iss = qinOddsIssueForPairKey(k);
        if (iss === "missing" || iss === "api_off") missingQin.push(k);
        else if (iss === "invalid") invalidQin.push(k);
      });
      if (apiOff) {
        return {
          show: true,
          level: "warn",
          title: "無接口 QIN",
          detail: `共 ${keys.length} 組：已關閉賠率接口，加入時將總投按 ${keys.length} 注平分（非按 QIN 權重）。`,
          canAdd: true,
          missingQin: keys,
        };
      }
      if (missingQin.length === keys.length) {
        return {
          show: true,
          level: "warn",
          title: "全部組合無 QIN",
          detail: `${oddsLoadStatus}。加入時將把總投平分為 ${keys.length} 注；若需按賠率拆賬請刷新並確認 types 含 QIN。`,
          canAdd: true,
          missingQin,
        };
      }
      if (missingQin.length || invalidQin.length) {
        const parts = [];
        if (missingQin.length) parts.push(`缺 QIN：${missingQin.slice(0, 8).join("、")}${missingQin.length > 8 ? "…" : ""}`);
        if (invalidQin.length) parts.push(`QIN 無效：${invalidQin.slice(0, 6).join("、")}${invalidQin.length > 6 ? "…" : ""}`);
        return {
          show: true,
          level: "warn",
          title: "部分組合無有效 QIN",
          detail: `${parts.join("；")}。這些組合加入時將按注數平分總投，其餘按 QIN Dutch 拆賬。`,
          canAdd: true,
          missingQin,
          invalidQin,
        };
      }
      return {
        show: true,
        level: "ok",
        title: "Dutch 連贏就緒",
        detail: `${keys.length} 組均有有效 QIN，可按總投自動拆賬。`,
        canAdd: true,
      };
    }

    if (activeCategory === "qpl") {
      const pairs = qinellaPairsFromSelection();
      if (!pairs.length) {
        return {
          show: true,
          level: "info",
          title: "Dutch 位置Q",
          detail: "請先選馬形成組合。有 QPL 時按賠率拆賬；部分或全部缺 QPL 時，總投將按注數平分。",
          canAdd: true,
        };
      }
      const keys = pairs.map(([a, b]) => normalizePairKey(Number(a), Number(b))).filter(Boolean);
      if (keys.length !== pairs.length) {
        return {
          show: true,
          level: "error",
          title: "組合無效",
          detail: "請重選馬號後再加入注項。",
          canAdd: false,
        };
      }
      const missingQpl = [];
      const invalidQpl = [];
      keys.forEach((k) => {
        const iss = qplOddsIssueForPairKey(k);
        if (iss === "missing" || iss === "api_off") missingQpl.push(k);
        else if (iss === "invalid") invalidQpl.push(k);
      });
      if (apiOff) {
        return {
          show: true,
          level: "warn",
          title: "無接口 QPL",
          detail: `共 ${keys.length} 組：已關閉賠率接口，加入時將總投按 ${keys.length} 注平分。`,
          canAdd: true,
          missingQpl: keys,
        };
      }
      if (missingQpl.length === keys.length) {
        return {
          show: true,
          level: "warn",
          title: "全部組合無 QPL",
          detail: `${oddsLoadStatus}。加入時將把總投平分為 ${keys.length} 注；若需按賠率拆賬請確認 types 含 QPL。`,
          canAdd: true,
          missingQpl,
        };
      }
      if (missingQpl.length || invalidQpl.length) {
        const parts = [];
        if (missingQpl.length) {
          parts.push(
            `缺 QPL：${missingQpl.slice(0, 8).join("、")}${missingQpl.length > 8 ? "…" : ""}`
          );
        }
        if (invalidQpl.length) {
          parts.push(
            `QPL 無效：${invalidQpl.slice(0, 6).join("、")}${invalidQpl.length > 6 ? "…" : ""}`
          );
        }
        return {
          show: true,
          level: "warn",
          title: "部分組合無有效 QPL",
          detail: `${parts.join("；")}。缺賠率組合將平分總投，其餘按 QPL Dutch 拆賬。`,
          canAdd: true,
          missingQpl,
          invalidQpl,
        };
      }
      return {
        show: true,
        level: "ok",
        title: "Dutch 位置Q就緒",
        detail: `${keys.length} 組均有有效 QPL，可按總投自動拆賬。`,
        canAdd: true,
      };
    }

    return { show: false };
  }

  function syncDutchOddsBanner() {
    const banner = $("#dutch-odds-banner");
    const line = $("#odds-ready-line");
    const addBtn = $("#btn-add-bet");
    const r = assessDutchOddsReadiness();

    if (banner) {
      if (!r.show) {
        banner.hidden = true;
        banner.innerHTML = "";
        banner.className = "dutch-odds-banner";
      } else {
        banner.hidden = false;
        banner.className = `dutch-odds-banner dutch-odds-banner--${r.level}`;
        let tagsHtml = "";
        const tagList = [
          ...(r.missing || []).map((n) => ({ t: String(n), k: "missing" })),
          ...(r.invalid || []).map((n) => ({ t: `W?${n}`, k: "invalid" })),
          ...(r.missingQin || []).map((k) => ({ t: k, k: "qin" })),
          ...(r.invalidQin || []).map((k) => ({ t: `Q?${k}`, k: "qin" })),
          ...(r.missingQpl || []).map((k) => ({ t: k, k: "qpl" })),
          ...(r.invalidQpl || []).map((k) => ({ t: `QPL?${k}`, k: "qpl" })),
        ];
        if (tagList.length) {
          tagsHtml = `<span class="dutch-odds-banner__tags">${tagList
            .map((x) => `<span class="dutch-odds-banner__tag">${x.t}</span>`)
            .join("")}</span>`;
        }
        banner.innerHTML = `<span class="dutch-odds-banner__title">${r.title}</span><span class="dutch-odds-banner__detail">${r.detail}</span>${tagsHtml}`;
      }
    }

    if (line) {
      if (!r.show) {
        line.hidden = true;
        line.textContent = "";
      } else {
        line.hidden = false;
        const cls =
          r.level === "ok" ? "ok" : r.level === "warn" ? "warn" : r.level === "error" ? "error" : "info";
        line.className = `status-line__odds status-line__odds--${cls === "info" ? "warn" : cls}`;
        if (r.level === "ok") line.textContent = "賠率：Dutch 可拆賬";
        else if (r.level === "info") line.textContent = "Dutch：待選馬";
        else line.textContent = r.title;
      }
    }

    if (addBtn) {
      const block = r.show && r.canAdd === false;
      addBtn.disabled = block;
      addBtn.classList.toggle("btn--add-bet-blocked", block);
      addBtn.title = block ? String(r.detail || r.title || "") : "";
    }
  }

  /** 各注整數，總和嚴格等於 T */
  function distributeDutchIntegerStakes(quotients, totalInt) {
    const T = Math.round(totalInt);
    const n = quotients.length;
    if (n === 0 || T < 0) return [];
    if (T === 0) return Array(n).fill(0);
    const inv = quotients.map((q) => 1 / q);
    const invSum = inv.reduce((a, b) => a + b, 0);
    if (!(invSum > 0)) return Array(n).fill(0);
    const raw = inv.map((v) => (T * v) / invSum);
    const floor = raw.map((x) => Math.floor(x));
    let rem = T - floor.reduce((a, b) => a + b, 0);
    const order = raw
      .map((x, i) => ({ i, r: x - Math.floor(x) }))
      .sort((a, b) => b.r - a.r)
      .map((o) => o.i);
    const out = [...floor];
    let j = 0;
    while (rem > 0) {
      out[order[j % order.length]] += 1;
      rem -= 1;
      j += 1;
    }
    return out;
  }

  function distributeEqualIntegerStakes(count, totalInt) {
    const n = Math.max(0, Math.floor(count));
    const T = Math.round(totalInt);
    if (n <= 0) return [];
    const base = Math.floor(T / n);
    let rem = T - base * n;
    const out = Array(n).fill(base);
    for (let i = 0; i < rem; i += 1) out[i % n] += 1;
    return out;
  }

  /** Dutch 膽拖且各組合金額不同時，馬會一行膽拖無法分注 → 同步改寫兩行複式 */
  function dutchBankerHkjcSyncNote(stakes) {
    if (!bankerMode || !dutchStakeMode || !Array.isArray(stakes) || stakes.length < 2) return "";
    const allSame = stakes.every((s) => s === stakes[0]);
    if (!allSame) {
      return "；同步至馬會將改為複式兩行（如 1+4、1+5），各寫入對應 Dutch 金額";
    }
    return "";
  }

  function validateStakesAboveMin(stakes, ctxLabel) {
    const min = HKJC.MIN_HKD_PER_LINE;
    const bad = stakes.findIndex((s) => Math.round(s) < min);
    if (bad >= 0) {
      toast(`${ctxLabel}：Dutch 拆賬後第 ${bad + 1} 注低於 $${min}，請加大本輪總投`);
      return false;
    }
    return true;
  }

  /** 連贏/位置Q Dutch：有全組合賠率則按賠率拆，否則平分；金額均為十位 */
  function computePairStakesForOddsMap(oddsByPair, pairs, totalInt) {
    const keys = pairs.map(([a, b]) => normalizePairKey(Number(a), Number(b))).filter(Boolean);
    if (keys.length !== pairs.length || keys.length === 0) {
      return { stakes: [], allOdds: true, roundedTotal: 0, adjustedTotal: false };
    }
    const decs = keys.map((k) => parseOddsToDecimalTotal(oddsByPair.get(k)));
    const allOdds = decs.every((d) => Number.isFinite(d));
    const raw = Math.round(Number(totalInt) || 0);
    const rounded = Math.max(keys.length * HKJC.MIN_HKD_PER_LINE, roundToNearestTen(raw));
    const rawStakes = allOdds
      ? distributeDutchIntegerStakes(decs, rounded)
      : distributeEqualIntegerStakes(keys.length, rounded);
    const fin = finalizeDutchStakes(rawStakes, rounded);
    return {
      stakes: fin.stakes,
      allOdds,
      roundedTotal: fin.total,
      adjustedTotal: raw !== rounded,
    };
  }

  function computeQinStakesForPairList(pairs, totalInt) {
    const r = computePairStakesForOddsMap(qinOddsByPair, pairs, totalInt);
    return { ...r, allQin: r.allOdds };
  }

  function computeQplStakesForPairList(pairs, totalInt) {
    const r = computePairStakesForOddsMap(qplOddsByPair, pairs, totalInt);
    return { ...r, allQpl: r.allOdds };
  }

  function syncBetsListScrollUi() {
    const list = $("#slip-list");
    const wrap = $("#bets-list-wrap");
    const metaWrap = $("#slip-meta-wrap");
    if (!list || !wrap) return;
    const apply = () => {
      const scrollable = slipItems.length > 0 && list.scrollHeight > list.clientHeight + 2;
      wrap.classList.toggle("is-scrollable", scrollable);
      if (metaWrap) metaWrap.classList.toggle("is-scrollable", scrollable);
    };
    apply();
    requestAnimationFrame(apply);
  }

  function renderSlip() {
    const list = $("#slip-list");
    const meta = $("#slip-meta");
    if (!list || !meta) return;

    meta.textContent = `${slipItems.length} 項`;
    const badge = $("#notify-badge");
    if (badge) {
      badge.textContent = String(slipItems.length);
      badge.hidden = slipItems.length === 0;
      badge.title = slipItems.length > 0 ? `當前注單 ${slipItems.length} 項` : "";
    }

    list.innerHTML = "";
    if (slipItems.length === 0) {
      const empty = document.createElement("div");
      empty.className = "slip-empty";
      empty.textContent = "暫無注項（先選號再點“加入注項”）";
      list.appendChild(empty);
      return;
    }

    slipItems.slice().reverse().forEach((it) => {
      const row = document.createElement("div");
      row.className = "slip-item";
      row.setAttribute("role", "listitem");

      const main = document.createElement("div");
      main.className = "slip-item__main";
      main.textContent = `${it.type} ${it.combo}`;

      const sub = document.createElement("div");
      sub.className = "slip-item__sub";
      sub.textContent = it.dutchAlloc
        ? `Dutch 拆賬 每注 ${fmtMoney(it.stakePerLine)} × ${it.lines} 注`
        : `每注 ${fmtMoney(it.stakePerLine)} × ${it.lines} 注`;

      const amt = document.createElement("div");
      amt.className = "slip-item__amt";
      amt.textContent = fmtMoney(it.totalStake);

      const del = document.createElement("button");
      del.type = "button";
      del.className = "slip-item__del";
      del.textContent = "×";
      del.title = "刪除該注項";
      del.ariaLabel = "刪除該注項";
      del.addEventListener("click", () => {
        const before = slipItems.length;
        slipItems = slipItems.filter((x) => x.id !== it.id);
        renderSlip();
        toast(before === slipItems.length ? "未找到該注項" : "已刪除 1 項");
      });

      row.appendChild(main);
      row.appendChild(amt);
      row.appendChild(del);
      row.appendChild(sub);
      list.appendChild(row);
    });
    syncBetsListScrollUi();
  }

  function qinellaPairsFromSelection() {
    const nums = sortedNumericSelections().map(String);
    if (bankerMode) {
      if (!bankerNum) return [];
      const legs = nums.filter((x) => x !== bankerNum);
      return legs.map((x) => [bankerNum, x]);
    }
    if (nums.length < 2) return [];
    const pairs = [];
    for (let i = 0; i < nums.length; i += 1) {
      for (let j = i + 1; j < nums.length; j += 1) {
        pairs.push([nums[i], nums[j]]);
      }
    }
    return pairs;
  }

  function addCurrentSelectionToSlip() {
    if (activeCategory === "win") {
      const nums = sortedNumericSelections();
      if (nums.length === 0) {
        toast("獨贏：請至少選一匹馬");
        return;
      }
      const budgetOrPer = readStakePerLine();
      if (budgetOrPer <= 0) {
        toast(dutchStakeMode ? "請先填寫本輪總投注金額" : "請先選擇下注金額");
        return;
      }
      if (!dutchStakeMode) {
        const per = budgetOrPer;
        if (per < HKJC.MIN_HKD_PER_LINE) {
          toast(`標準注每注至少 $${HKJC.MIN_HKD_PER_LINE}`);
          return;
        }
        const items = nums.map((n) => {
          const horse = String(n);
          return {
            id: `${Date.now()}-W${horse}-${Math.random().toString(16).slice(2)}`,
            type: "獨贏",
            combo: horse,
            lines: 1,
            stakePerLine: per,
            totalStake: per,
          };
        });
        slipItems = slipItems.concat(items);
        renderSlip();
        toast(`已加入獨贏 ${items.length} 注（平注）`);
        return;
      }
      const decs = nums.map((n) => parseOddsToDecimalTotal(raceOddsMap.get(String(n))?.win));
      if (!decs.every((d) => Number.isFinite(d))) {
        toast("Dutch 拆賬需要各馬均有獨贏(W)有效賠率，請確認數據服務已返回本場 WIN");
        return;
      }
      const dutch = computeDutchStakesFromOdds(decs, budgetOrPer);
      if (dutch.adjustedTotal) {
        readDutchTotalStake({ updateInput: true, toastIfAdjusted: true });
      }
      if (!dutch.stakes.length || !validateStakesAboveMin(dutch.stakes, "獨贏")) return;
      const items = nums.map((n, i) => {
        const horse = String(n);
        return {
          id: `${Date.now()}-W${horse}-${Math.random().toString(16).slice(2)}`,
          type: "獨贏",
          combo: horse,
          lines: 1,
          stakePerLine: dutch.stakes[i],
          totalStake: dutch.stakes[i],
          dutchAlloc: true,
        };
      });
      slipItems = slipItems.concat(items);
      renderSlip();
      const extra =
        dutch.adjustedTotal || dutch.adjustedLines
          ? `（總投 ${fmtMoney(dutch.total)}，已按十位四捨五入）`
          : `（總投 ${fmtMoney(dutch.total)}）`;
      toast(`已加入獨贏 ${items.length} 注${extra}`);
      return;
    }

    if (activeCategory === "pla") {
      const nums = sortedNumericSelections();
      if (nums.length === 0) {
        toast("位置：請至少選一匹馬");
        return;
      }
      const budgetOrPer = readStakePerLine();
      if (budgetOrPer <= 0) {
        toast(dutchStakeMode ? "請先填寫本輪總投注金額" : "請先選擇下注金額");
        return;
      }
      if (!dutchStakeMode) {
        const per = budgetOrPer;
        if (per < HKJC.MIN_HKD_PER_LINE) {
          toast(`標準注每注至少 $${HKJC.MIN_HKD_PER_LINE}`);
          return;
        }
        const items = nums.map((n) => {
          const horse = String(n);
          return {
            id: `${Date.now()}-P${horse}-${Math.random().toString(16).slice(2)}`,
            type: "位置",
            combo: horse,
            lines: 1,
            stakePerLine: per,
            totalStake: per,
          };
        });
        slipItems = slipItems.concat(items);
        renderSlip();
        toast(`已加入位置 ${items.length} 注（平注）`);
        return;
      }
      const decs = nums.map((n) => parseOddsToDecimalTotal(raceOddsMap.get(String(n))?.place));
      if (!decs.every((d) => Number.isFinite(d))) {
        toast("Dutch 拆賬需要各馬均有位置(P)有效賠率，請確認數據服務已返回本場 PLA");
        return;
      }
      const dutch = computeDutchStakesFromOdds(decs, budgetOrPer);
      if (dutch.adjustedTotal) {
        readDutchTotalStake({ updateInput: true, toastIfAdjusted: true });
      }
      if (!dutch.stakes.length || !validateStakesAboveMin(dutch.stakes, "位置")) return;
      const items = nums.map((n, i) => {
        const horse = String(n);
        return {
          id: `${Date.now()}-P${horse}-${Math.random().toString(16).slice(2)}`,
          type: "位置",
          combo: horse,
          lines: 1,
          stakePerLine: dutch.stakes[i],
          totalStake: dutch.stakes[i],
          dutchAlloc: true,
        };
      });
      slipItems = slipItems.concat(items);
      renderSlip();
      const extra =
        dutch.adjustedTotal || dutch.adjustedLines
          ? `（總投 ${fmtMoney(dutch.total)}，已按十位四捨五入）`
          : `（總投 ${fmtMoney(dutch.total)}）`;
      toast(`已加入位置 ${items.length} 注${extra}`);
      return;
    }

    if (activeCategory === "qin") {
      const pairs = qinellaPairsFromSelection();
      if (pairs.length === 0) {
        toast(bankerMode ? "膽拖：請先選一匹膽，再選配腳" : "複式：請至少選兩匹馬");
        return;
      }
      const budgetOrPer = readStakePerLine();
      if (budgetOrPer <= 0) {
        toast(dutchStakeMode ? "請先填寫本輪總投注金額" : "請先選擇下注金額");
        return;
      }
      if (!dutchStakeMode) {
        const per = budgetOrPer;
        if (per < HKJC.MIN_HKD_PER_LINE) {
          toast(`標準注每注至少 $${HKJC.MIN_HKD_PER_LINE}`);
          return;
        }
        const items = pairs.map(([a, b]) => {
          const left = String(a);
          const right = String(b);
          const combo = Number(left) < Number(right) ? `${left}-${right}` : `${right}-${left}`;
          return {
            id: `${Date.now()}-${combo}-${Math.random().toString(16).slice(2)}`,
            type: "連贏",
            combo,
            lines: 1,
            stakePerLine: per,
            totalStake: per,
          };
        });
        slipItems = slipItems.concat(items);
        renderSlip();
        toast(`已加入 ${items.length} 注（平注）`);
        return;
      }
      const qinDutch = computeQinStakesForPairList(pairs, budgetOrPer);
      if (!qinDutch.stakes.length || qinDutch.stakes.length !== pairs.length) {
        toast("連贏 Dutch：組合無效，請重選馬號");
        return;
      }
      if (qinDutch.adjustedTotal) {
        readDutchTotalStake({ updateInput: true, toastIfAdjusted: true });
      }
      if (!qinDutch.allQin) toast("部分組合無 QIN 賠率，本輪總投按注數平分至各注");
      if (!validateStakesAboveMin(qinDutch.stakes, "連贏")) return;
      const items = pairs.map(([a, b], i) => {
        const left = String(a);
        const right = String(b);
        const combo = Number(left) < Number(right) ? `${left}-${right}` : `${right}-${left}`;
        return {
          id: `${Date.now()}-${combo}-${Math.random().toString(16).slice(2)}`,
          type: "連贏",
          combo,
          lines: 1,
          stakePerLine: qinDutch.stakes[i],
          totalStake: qinDutch.stakes[i],
          dutchAlloc: true,
        };
      });
      slipItems = slipItems.concat(items);
      renderSlip();
      const extra = qinDutch.adjustedTotal ? `（總投 ${fmtMoney(qinDutch.roundedTotal)}，已按十位四捨五入）` : `（總投 ${fmtMoney(qinDutch.roundedTotal)}）`;
      toast(`已加入 ${items.length} 注${extra}${dutchBankerHkjcSyncNote(qinDutch.stakes)}`);
      return;
    }

    if (activeCategory === "qpl") {
      const pairs = qinellaPairsFromSelection();
      if (pairs.length === 0) {
        toast(bankerMode ? "膽拖：請先選一匹膽，再選配腳" : "複式：請至少選兩匹馬");
        return;
      }
      const budgetOrPer = readStakePerLine();
      if (budgetOrPer <= 0) {
        toast(dutchStakeMode ? "請先填寫本輪總投注金額" : "請先選擇下注金額");
        return;
      }
      if (!dutchStakeMode) {
        const per = stakeForHkjc(budgetOrPer);
        if (per < HKJC.MIN_HKD_PER_LINE) {
          toast(`標準注每注至少 $${HKJC.MIN_HKD_PER_LINE}`);
          return;
        }
        if (per !== budgetOrPer) {
          toast(`馬會僅接受十位金額：${fmtMoney(budgetOrPer)} → ${fmtMoney(per)}`);
        }
        const items = pairs.map(([a, b]) => {
          const left = String(a);
          const right = String(b);
          const combo = Number(left) < Number(right) ? `${left}-${right}` : `${right}-${left}`;
          return {
            id: `${Date.now()}-QPL${combo}-${Math.random().toString(16).slice(2)}`,
            type: "位置Q",
            combo,
            lines: 1,
            stakePerLine: per,
            totalStake: per,
          };
        });
        slipItems = slipItems.concat(items);
        renderSlip();
        toast(`已加入位置Q ${items.length} 注（平注）`);
        return;
      }
      const qplDutch = computeQplStakesForPairList(pairs, budgetOrPer);
      if (!qplDutch.stakes.length || qplDutch.stakes.length !== pairs.length) {
        toast("位置Q Dutch：組合無效，請重選馬號");
        return;
      }
      if (qplDutch.adjustedTotal) {
        readDutchTotalStake({ updateInput: true, toastIfAdjusted: true });
      }
      if (!qplDutch.allQpl) toast("部分組合無 QPL 賠率，本輪總投按注數平分至各注");
      if (!validateStakesAboveMin(qplDutch.stakes, "位置Q")) return;
      const items = pairs.map(([a, b], i) => {
        const left = String(a);
        const right = String(b);
        const combo = Number(left) < Number(right) ? `${left}-${right}` : `${right}-${left}`;
        return {
          id: `${Date.now()}-QPL${combo}-${Math.random().toString(16).slice(2)}`,
          type: "位置Q",
          combo,
          lines: 1,
          stakePerLine: qplDutch.stakes[i],
          totalStake: qplDutch.stakes[i],
          dutchAlloc: true,
        };
      });
      slipItems = slipItems.concat(items);
      renderSlip();
      const extra = qplDutch.adjustedTotal
        ? `（總投 ${fmtMoney(qplDutch.roundedTotal)}，已按十位四捨五入）`
        : `（總投 ${fmtMoney(qplDutch.roundedTotal)}）`;
      toast(`已加入位置Q ${items.length} 注${extra}${dutchBankerHkjcSyncNote(qplDutch.stakes)}`);
      return;
    }

    const per = readStakePerLine();
    const nums = sortedNumericSelections().map(String);
    const MAX_ITEMS = 2000;
    const ensurePer = () => {
      if (per <= 0) {
        toast("請先選擇下注金額");
        return false;
      }
      if (per < HKJC.MIN_HKD_PER_LINE) {
        toast(`標準注每注至少 $${HKJC.MIN_HKD_PER_LINE}`);
        return false;
      }
      return true;
    };

    if (activeCategory === "fc") {
      if (nums.length < 2) {
        toast("二重：請至少選兩匹馬");
        return;
      }
      if (!ensurePer()) return;
      const perms = permutations(nums, 2);
      if (perms.length > MAX_ITEMS) {
        toast(`二重組合過多（${perms.length} 注），請減少選擇馬匹數`);
        return;
      }
      const items = perms.map(([a, b]) => ({
        id: `${Date.now()}-FC${a}>${b}-${Math.random().toString(16).slice(2)}`,
        type: "二重",
        combo: `${a}>${b}`,
        lines: 1,
        stakePerLine: per,
        totalStake: per,
      }));
      slipItems = slipItems.concat(items);
      renderSlip();
      toast(`已加入二重 ${items.length} 注`);
      return;
    }

    if (activeCategory === "tr") {
      if (nums.length < 3) {
        toast("三重：請至少選三匹馬");
        return;
      }
      if (!ensurePer()) return;
      const combs = combinations(nums, 3);
      if (combs.length > MAX_ITEMS) {
        toast(`三重組合過多（${combs.length} 注），請減少選擇馬匹數`);
        return;
      }
      const items = combs.map((arr) => {
        const sorted = [...arr].sort((x, y) => Number(x) - Number(y));
        return {
          id: `${Date.now()}-TR${sorted.join("-")}-${Math.random().toString(16).slice(2)}`,
          type: "三重",
          combo: sorted.join("-"),
          lines: 1,
          stakePerLine: per,
          totalStake: per,
        };
      });
      slipItems = slipItems.concat(items);
      renderSlip();
      toast(`已加入三重 ${items.length} 注`);
      return;
    }

    if (activeCategory === "tierce") {
      if (nums.length < 3) {
        toast("單T：請至少選三匹馬");
        return;
      }
      if (!ensurePer()) return;
      const perms = permutations(nums, 3);
      if (perms.length > MAX_ITEMS) {
        toast(`單T組合過多（${perms.length} 注），請減少選擇馬匹數`);
        return;
      }
      const items = perms.map((arr) => ({
        id: `${Date.now()}-T${arr.join(">")}-${Math.random().toString(16).slice(2)}`,
        type: "單T",
        combo: arr.join(">"),
        lines: 1,
        stakePerLine: per,
        totalStake: per,
      }));
      slipItems = slipItems.concat(items);
      renderSlip();
      toast(`已加入單T ${items.length} 注`);
      return;
    }

    if (activeCategory === "qtt") {
      if (nums.length < 4) {
        toast("四連：請至少選四匹馬");
        return;
      }
      if (!ensurePer()) return;
      const perms = permutations(nums, 4);
      if (perms.length > MAX_ITEMS) {
        toast(`四連組合過多（${perms.length} 注），請減少選擇馬匹數`);
        return;
      }
      const items = perms.map((arr) => ({
        id: `${Date.now()}-QTT${arr.join(">")}-${Math.random().toString(16).slice(2)}`,
        type: "四連",
        combo: arr.join(">"),
        lines: 1,
        stakePerLine: per,
        totalStake: per,
      }));
      slipItems = slipItems.concat(items);
      renderSlip();
      toast(`已加入四連 ${items.length} 注`);
      return;
    }

    if (activeCategory === "f4") {
      if (nums.length < 4) {
        toast("四重：請至少選四匹馬");
        return;
      }
      if (!ensurePer()) return;
      const combs = combinations(nums, 4);
      if (combs.length > MAX_ITEMS) {
        toast(`四重組合過多（${combs.length} 注），請減少選擇馬匹數`);
        return;
      }
      const items = combs.map((arr) => {
        const sorted = [...arr].sort((x, y) => Number(x) - Number(y));
        return {
          id: `${Date.now()}-F4${sorted.join("-")}-${Math.random().toString(16).slice(2)}`,
          type: "四重",
          combo: sorted.join("-"),
          lines: 1,
          stakePerLine: per,
          totalStake: per,
        };
      });
      slipItems = slipItems.concat(items);
      renderSlip();
      toast(`已加入四重 ${items.length} 注`);
      return;
    }

    if (activeCategory === "dbl") {
      toast("孖寶需跨兩場選擇，當前面板尚未實現");
      return;
    }
    if (activeCategory === "922") {
      toast("此玩法尚未開放");
      return;
    }
    if (activeCategory === "range") {
      toast("「範圍」暫不支援加入注單");
      return;
    }

    toast("當前玩法尚未接入");
    return;
  }

  function clearSlip() {
    if (slipItems.length === 0) {
      toast("注單已為空");
      return;
    }
    slipItems = [];
    renderSlip();
    toast("已清空注單");
  }

  function renderNav() {
    const nav = $("#nav-categories");
    if (!nav) return;
    if (HIDDEN_NAV_CATEGORY_IDS.has(activeCategory)) activeCategory = "qin";
    nav.innerHTML = "";
    visibleNavCategories().forEach((c) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "nav-btn" + (c.id === activeCategory ? " is-active" : "");
      b.textContent = c.label;
      b.dataset.id = c.id;
      b.addEventListener("click", () => {
        activeCategory = c.id;
        if (!isPairGridMode()) {
          bankerMode = false;
          bankerNum = null;
        }
        $$(".nav-btn", nav).forEach((x) => x.classList.toggle("is-active", x.dataset.id === activeCategory));
        setModeVisibility();
        if (activeCategory === "race") {
          ensureMeetingLoaded().then((ok) => {
            if (!ok) toast("暫時無法載入場次，已顯示預設列表");
            renderRacePanel();
            renderNums();
            updateStatus();
            updateRuleHint();
            fetchRaceOddsFromApi();
          });
        } else if (activeCategory === "history") {
          const sum = $("#num-pick-summary");
          if (sum) {
            sum.hidden = true;
            const main = $("#num-pick-summary-main");
            if (main) main.innerHTML = "";
          }
          selectedHistorySlipId = null;
          void loadBetHistoryPanel();
        }
        updateRuleHint();
        if (activeCategory !== "race" && activeCategory !== "history") {
          renderNums();
          updateStatus();
        }
      });
      nav.appendChild(b);
    });
  }

  function normalToggle(label) {
    if (selectedNums.has(label)) selectedNums.delete(label);
    else selectedNums.add(label);
  }

  function handleQinBankerClick(label) {
    if (!bankerNum) {
      bankerNum = label;
      selectedNums.add(label);
      return;
    }
    if (bankerNum === label) {
      bankerNum = null;
      selectedNums.delete(label);
      return;
    }
    if (selectedNums.has(label)) selectedNums.delete(label);
    else selectedNums.add(label);
  }

  function renderNums() {
    if (activeCategory === "history") return;
    const grid = $("#num-grid");
    if (!grid) return;
    grid.innerHTML = "";

    const row1 = document.createElement("div");
    row1.className = "num-row num-row--10";
    for (let n = 1; n <= 10; n += 1) {
      row1.appendChild(mkNum(String(n)));
    }

    const row2 = document.createElement("div");
    row2.className = "num-row";
    for (let n = 11; n <= maxRunnersForRace; n += 1) {
      row2.appendChild(mkNum(String(n)));
    }

    const row2extra = document.createElement("div");
    row2extra.className = "num-row";
    if (activeCategory === "race") {
      // 場次模式僅預覽賠率，不提供 F/全/拖，避免誤操作
    } else if (activeCategory === "win" || activeCategory === "pla") {
      row2extra.appendChild(mkNum("全", true));
    } else {
      row2extra.appendChild(mkNum("F", true));
      row2extra.appendChild(mkNum("全", true));
      row2extra.appendChild(mkNum("拖", true));
    }

    grid.appendChild(row1);
    grid.appendChild(row2);
    if (activeCategory !== "race") grid.appendChild(row2extra);
    renderSelectionSummary();
    updateComboOddsTables();
    syncDutchOddsBanner();
  }

  function oddsCaptionForMode(numLabel) {
    const od = raceOddsMap.get(String(numLabel));
    if (!od) return "";
    if (activeCategory === "race") {
      const bits = [];
      if (od.win) bits.push(`W${od.win}`);
      if (od.place) bits.push(`P${od.place}`);
      return bits.join("\n");
    }
    if (activeCategory === "win") return od.win ? `W ${od.win}` : "";
    if (activeCategory === "pla") return od.place ? `P ${od.place}` : "";
    if (activeCategory === "qin" || activeCategory === "qpl") {
      const bits = [];
      if (od.win) bits.push(`W${od.win}`);
      if (od.place) bits.push(`P${od.place}`);
      return bits.join("\n");
    }
    return "";
  }

  function mkNum(label, special) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "num-btn";
    if (special) {
      b.textContent = label;
      b.dataset.special = "1";
    } else {
      const cap = oddsCaptionForMode(label);
      const numSpan = document.createElement("span");
      numSpan.className = "num-btn__num";
      numSpan.textContent = label;
      b.appendChild(numSpan);
      if (cap) {
        const o = document.createElement("span");
        o.className = "num-btn__odds";
        o.textContent = cap;
        o.title = cap;
        b.appendChild(o);
      }
    }

    if (!special) {
      const isSel = selectedNums.has(label);
      const isBanker = isPairGridMode() && bankerMode && bankerNum === label;
      if (isBanker) b.classList.add("is-banker");
      else if (isSel) b.classList.add("is-on");
      if (activeCategory === "win" && dutchStakeAppliesOnScreen() && isSel) {
        const iss = winOddsIssueForHorse(label);
        if (iss) {
          b.classList.add("num-btn--odds-missing");
          const raw = raceOddsMap.get(String(label))?.win;
          if (iss === "missing") {
            b.title = "獨贏 Dutch：此馬暫無獨贏 W 賠率（請刷新或換場）";
          } else if (iss === "invalid") {
            b.title = `獨贏 Dutch：W=${raw || "—"} 無法用於拆賬（需為大於 1 的十進制賠率）`;
          } else {
            b.title = "獨贏 Dutch：請先在設定中開啓賠率接口";
          }
        } else if (isSel) {
          b.title = "獨贏：該馬單獨一注猜冠軍（Dutch 已具備 W）";
        }
      } else if (activeCategory === "pla" && dutchStakeAppliesOnScreen() && isSel) {
        const iss = placeOddsIssueForHorse(label);
        if (iss) {
          b.classList.add("num-btn--odds-missing");
          const raw = raceOddsMap.get(String(label))?.place;
          if (iss === "missing") {
            b.title = "位置 Dutch：此馬暫無位置 P 賠率（請刷新或換場）";
          } else if (iss === "invalid") {
            b.title = `位置 Dutch：P=${raw || "—"} 無法用於拆賬`;
          } else {
            b.title = "位置 Dutch：請先在設定中開啓賠率接口";
          }
        } else if (isSel) {
          b.title = "位置：該馬單獨一注猜入前三名（Dutch 已具備 P）";
        }
      } else if (isSel) {
        if (activeCategory === "win") b.title = "獨贏：該馬單獨一注猜冠軍";
        else if (activeCategory === "pla") b.title = "位置：該馬單獨一注猜入前三名";
        else b.title = "";
      }
    } else if (label === "拖" && isPairGridMode() && bankerMode) {
      b.classList.add("is-drag-mode", "is-on");
    } else if (label === "F" && isPairGridMode() && bankerMode && bankerNum) {
      const expectedLegs = maxRunnersForRace - 1;
      const legCount = [...selectedNums].filter((x) => /^\d+$/.test(x) && x !== bankerNum).length;
      if (legCount === expectedLegs) b.classList.add("is-on");
    }

    if (special && label === "拖" && isPairGridMode()) {
      b.title = bankerMode
        ? "點擊退出馬膽拖（恢復複式選號）"
        : "馬膽拖：可先只選一匹作膽再按此處；或先按此處再點膽馬與配腳";
    }
    if (special && label === "F" && isPairGridMode()) {
      b.title =
        "馬膽拖：選定膽馬後按此，一鍵拖齊本場其餘全部馬號（例：膽 1 則組合為 1-2、1-3…直至 1-全場）";
    }

    b.addEventListener("click", () => {
      if (!special && activeCategory === "race") return;
      if (special) {
        if (label === "全") {
          for (let i = 1; i <= maxRunnersForRace; i += 1) selectedNums.add(String(i));
        } else if (label === "拖") {
          if (!isPairGridMode()) return;
          if (bankerMode) {
            bankerMode = false;
            bankerNum = null;
          } else {
            const nums = sortedNumericSelections();
            if (nums.length > 1) {
              toast("膽拖請先只選一匹作膽馬，再按「拖」；或先按「拖」再依次點膽與配腳");
              renderNums();
              updateRuleHint();
              updateStatus();
              return;
            }
            bankerMode = true;
            if (nums.length === 1) bankerNum = String(nums[0]);
          }
        } else if (label === "F") {
          if (!isPairGridMode()) return;
          if (!bankerMode || !bankerNum) {
            toast("請先選定膽馬並處於馬膽拖模式，再按 F（膽拖全場：膽 拖齊其餘全部馬號）");
            renderNums();
            updateRuleHint();
            updateStatus();
            return;
          }
          selectedNums.clear();
          selectedNums.add(bankerNum);
          for (let i = 1; i <= maxRunnersForRace; i += 1) {
            const s = String(i);
            if (s !== bankerNum) selectedNums.add(s);
          }
        } else {
          return;
        }
        renderNums();
        updateRuleHint();
        updateStatus();
        return;
      }

      if (isPairGridMode() && bankerMode) handleQinBankerClick(label);
      else normalToggle(label);

      renderNums();
      updateStatus();
    });
    return b;
  }

  function renderAmounts() {
    const wrap = $("#amount-grid");
    wrap.innerHTML = "";
    amounts.forEach((a) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "amt-btn";
      b.textContent = `$${a}`;
      b.dataset.amount = String(a);
      b.addEventListener("click", () => {
        unitAmount = a;
        syncStakeCustomInputFromUnitAmount();
        updateStatus();
      });
      wrap.appendChild(b);
    });
    syncStakeCustomInputFromUnitAmount();
  }

  function updateStatus() {
    const lines = betLines();
    const inputVal = readStakePerLine();
    const dutchHere = dutchStakeAppliesOnScreen();
    const dutchRounded =
      dutchHere && inputVal > 0
        ? Math.max(
            lines > 0 ? lines * HKJC.MIN_HKD_PER_LINE : HKJC.MIN_HKD_PER_LINE,
            roundToNearestTen(inputVal)
          )
        : inputVal;
    const sum =
      dutchHere && lines > 0 ? dutchRounded : Math.round((Number(lines) || 0) * (Number(inputVal) || 0));
    const perForHint =
      dutchHere && lines > 0 ? dutchRounded / Math.max(1, lines) : inputVal;

    const betSumEl = $("#bet-sum");
    if (betSumEl) {
      betSumEl.textContent = sum.toLocaleString("zh-HK");
      let title = dutchHere && lines > 0 ? "獨贏/連贏 Dutch：金額為本輪總投注（整數十位）" : "";
      if (dutchHere && inputVal > 0 && inputVal !== dutchRounded) {
        title = `輸入 ${fmtMoney(inputVal)} → 馬會用 ${fmtMoney(dutchRounded)}（十位四捨五入）`;
      }
      betSumEl.title = title;
    }
    $("#bet-count").textContent = String(lines);

    syncAsideStakeWarn(perForHint, lines, dutchHere ? dutchRounded : inputVal);
    updateComboOddsTables();
    syncDutchOddsBanner();
  }

  function fillTable(tableId, rows, cols) {
    const tb = $(`#${tableId} tbody`);
    if (!tb) return;
    tb.innerHTML = "";
    rows.forEach((r) => {
      const tr = document.createElement("tr");
      if (r.hot) tr.classList.add("is-hot");
      cols.forEach((col) => {
        const td = document.createElement("td");
        const text = String(r[col]);
        td.textContent = text;
        // 統一可讀性：長文本用 title 承載完整內容（懸浮可見）
        if (text.length >= 12) td.title = text;
        tr.appendChild(td);
      });
      tb.appendChild(tr);
    });
  }

  function buildQinTableRows() {
    const pairs = qinellaPairsFromSelection();
    if (!pairs.length) {
      const hint = bankerMode
        ? "膽拖：請先選膽馬並至少一匹配腳後查看試算"
        : "請至少選擇兩匹馬後查看連贏試算";
      return [
        {
          combo: "—",
          odds: "—",
          total: "—",
          payout: hint,
          hot: false,
        },
      ];
    }
    const keys = pairs.map(([a, b]) => normalizePairKey(Number(a), Number(b))).filter(Boolean);
    if (!keys.length) {
      return [
        {
          combo: "—",
          odds: "—",
          total: "—",
          payout: "組合無效，請重選馬號",
          hot: false,
        },
      ];
    }
    const flatStake = Math.max(0, Math.round(readStakePerLine()));
    const dutchPrev = dutchStakeAppliesOnScreen() && flatStake > 0;
    const { stakes: dutchStakes } = dutchPrev ? computeQinStakesForPairList(pairs, flatStake) : { stakes: [] };
    const useDutchStakes = dutchPrev && dutchStakes.length === keys.length;

    return keys.map((k, idx) => {
      const od = qinOddsByPair.get(k);
      const dec = od != null && od !== "" ? Number(String(od).replace(",", ".")) : NaN;
      const stake = useDutchStakes ? dutchStakes[idx] : flatStake;
      const payout = Number.isFinite(dec) && stake > 0 ? Math.round(dec * stake) : NaN;
      return {
        combo: k,
        odds: od != null && od !== "" ? String(od) : "—",
        total: stake > 0 ? `試算 ${fmtMoney(stake)}` : "—",
        payout: Number.isFinite(payout) ? fmtMoney(payout) : "—",
        hot: false,
      };
    });
  }

  function buildQplTableRows() {
    const pairs = qinellaPairsFromSelection();
    if (!pairs.length) {
      const hint = bankerMode
        ? "膽拖：請先選膽馬並至少一匹配腳後查看試算"
        : "請至少選擇兩匹馬後查看位置 Q 試算";
      return [{ combo: "—", odds: "—", note: hint, hot: false }];
    }
    const keys = pairs.map(([a, b]) => normalizePairKey(Number(a), Number(b))).filter(Boolean);
    if (!keys.length) {
      return [{ combo: "—", odds: "—", note: "組合無效，請重選馬號", hot: false }];
    }
    const flatStake = Math.max(0, Math.round(readStakePerLine()));
    const dutchPrev = activeCategory === "qpl" && dutchStakeAppliesOnScreen() && flatStake > 0;
    const { stakes: dutchStakes } = dutchPrev ? computeQplStakesForPairList(pairs, flatStake) : { stakes: [] };
    const useDutchStakes = dutchPrev && dutchStakes.length === keys.length;
    return keys.map((k, idx) => {
      const od = qplOddsByPair.get(k);
      const has = od != null && String(od).trim() !== "";
      const stake = useDutchStakes ? dutchStakes[idx] : flatStake;
      let note = has ? "接口 QPL" : "無報價";
      if (useDutchStakes && stake > 0) note = `試算 ${fmtMoney(stake)}`;
      else if (activeCategory === "qpl" && flatStake > 0 && !dutchStakeMode) note = `試算 ${fmtMoney(flatStake)}`;
      return {
        combo: k,
        odds: has ? String(od) : "—",
        note,
        hot: false,
      };
    });
  }

  function updateComboOddsTables() {
    const qinRows = buildQinTableRows();
    fillTable("table-q", qinRows, ["combo", "odds", "total", "payout"]);
    if ($("#table-qpl")) fillTable("table-qpl", buildQplTableRows(), ["combo", "odds", "note"]);
    const qm = $("#q-meta");
    if (qm) {
      const nQ = qinRows.length && qinRows[0].combo === "—" ? 0 : qinRows.length;
      qm.textContent = `${nQ} 組`;
    }
    const qp = $("#q-payout");
    if (qp) {
      const pairsSel = qinellaPairsFromSelection();
      if (!pairsSel.length) {
        qp.textContent =
          "請先選中馬號後，本表會顯示您組合對應的連贏 / 位置 Q 與試算派彩；數據來自服務，不構成投注建議。";
      } else if (hkjcOddsUseApi && !qinOddsByPair.size && !qplOddsByPair.size) {
        qp.textContent =
          "未返回 QIN/QPL 時僅可依賴 W/P；請在賠率 types 中含 QIN,QPL（預設模板已包含）";
      } else {
        const s = Math.max(0, Math.round(readStakePerLine()));
        const dutchHere = dutchStakeAppliesOnScreen();
        if (s > 0) {
          qp.textContent = dutchHere
            ? `QIN/QPL 來自數據服務；已開啓 Dutch 時上方為「本輪總投注」，試算表按各組合分攤注額顯示派彩；不構成投注建議。`
            : `QIN/QPL 來自數據服務；「試算注」與「每注金額」${fmtMoney(s)} 一致，「預計派彩」按該額×賠率估算，不構成投注建議。`;
        } else {
          qp.textContent = "QIN/QPL 來自數據服務；請先設定金額以查看試算派彩。";
        }
      }
    }
    syncOddsStatusLabel();
  }

  function openSettingsPopover() {
    const pop = $("#settings-popover");
    if (!pop) return;
    const useEl = $("#settings-use-odds-api");
    if (useEl) useEl.checked = hkjcOddsUseApi;
    const acEl = $("#settings-bet-autoconfirm");
    if (acEl) acEl.checked = betAutoConfirm;
    const autoEl = $("#settings-odds-auto");
    if (autoEl) autoEl.checked = oddsAutoRefreshEnabled;
    const intEl = $("#settings-odds-interval");
    if (intEl) intEl.value = String([15, 30, 60].includes(oddsAutoRefreshSec) ? oddsAutoRefreshSec : 30);
    syncOddsStatusLabel();
    pop.hidden = false;
  }

  function closeSettingsPopover() {
    const pop = $("#settings-popover");
    if (pop) pop.hidden = true;
  }

  async function saveSettingsFromForm() {
    hkjcOddsUseApi = Boolean($("#settings-use-odds-api")?.checked);
    await storageSet({ [HKJC_ODDS_USE_KEY]: hkjcOddsUseApi });
    betAutoConfirm = Boolean($("#settings-bet-autoconfirm")?.checked);
    await storageSet({ [BET_AUTO_CONFIRM_KEY]: betAutoConfirm });
    oddsAutoRefreshEnabled = Boolean($("#settings-odds-auto")?.checked);
    await storageSet({ [HKJC_ODDS_AUTO_KEY]: oddsAutoRefreshEnabled });
    const iv = Number($("#settings-odds-interval")?.value);
    oddsAutoRefreshSec = iv === 15 || iv === 30 || iv === 60 ? iv : 30;
    await storageSet({ [HKJC_ODDS_INTERVAL_KEY]: oddsAutoRefreshSec });
    hkjcMeeting = null;
    meetingsCatalog = [];
    closeSettingsPopover();
    toast("已儲存，正在重載賽事與賠率");
    const ok = await ensureMeetingLoaded();
    if (ok) {
      renderRacePanel();
      applyRaceMetaFromMeeting();
      syncTopbarRace();
      renderNums();
      updateRuleHint();
      updateStatus();
      await fetchRaceOddsFromApi();
    } else {
      toast("無法載入賽事，請稍後重試或重新登入");
    }
    restartOddsAutoRefresh();
  }

  $("#btn-settings")?.addEventListener("click", () => openSettingsPopover());
  $("#btn-close-settings")?.addEventListener("click", () => closeSettingsPopover());
  $("#settings-popover-backdrop")?.addEventListener("click", () => closeSettingsPopover());
  $("#btn-save-settings")?.addEventListener("click", () => saveSettingsFromForm());
  $("#btn-refresh-odds")?.addEventListener("click", async () => {
    await fetchRaceOddsFromApi();
    const has =
      [...raceOddsMap.values()].some((v) => v.win || v.place) || qinOddsByPair.size > 0 || qplOddsByPair.size > 0;
    toast(has ? "已刷新本場賠率" : "仍未解析到賠率，請檢查接口");
  });

  $("#btn-dutch-flat")?.addEventListener("click", () => {
    void applyDutchStakeMode(false);
  });
  $("#btn-dutch-on")?.addEventListener("click", () => {
    void applyDutchStakeMode(true);
  });

  $("#btn-qin-combo-toggle")?.addEventListener("click", async () => {
    qinComboInlineCollapsed = !qinComboInlineCollapsed;
    syncQinComboInlineCollapseDom();
    await storageSet({ [QIN_COMBO_INLINE_COLLAPSED_KEY]: qinComboInlineCollapsed });
  });

  const stakeCustom = $("#stake-custom");
  stakeCustom?.addEventListener("input", () => updateStatus());
  stakeCustom?.addEventListener("change", () => updateStatus());
  stakeCustom?.addEventListener("blur", () => {
    if (String(stakeCustom.value ?? "").trim() === "") {
      syncStakeCustomInputFromUnitAmount();
      updateStatus();
      return;
    }
    if (dutchStakeAppliesOnScreen()) {
      readDutchTotalStake({ updateInput: true, toastIfAdjusted: true });
    }
    updateStatus();
  });

  $("#btn-trash").addEventListener("click", clearPicksFromUser);

  $("#btn-num-pick-summary-clear")?.addEventListener("click", clearPicksFromUser);

  $("#btn-refresh-header").addEventListener("click", async () => {
    if (activeCategory === "history") {
      void loadBetHistoryPanel();
      toast("已刷新注單記錄");
      return;
    }
    updateMarketMeta();
    await fetchRaceOddsFromApi();
    toast("已嘗試刷新賠率");
  });

  $("#btn-history-refresh")?.addEventListener("click", () => {
    void loadBetHistoryPanel();
  });

  function openWidePanelWindow() {
    if (!chrome?.runtime?.sendMessage) {
      toast("無法連接擴充功能");
      return;
    }
    chrome.runtime.sendMessage({ type: "OPEN_WIDE_PANEL" }, (res) => {
      if (chrome.runtime.lastError) {
        toast(`無法打開寬屏窗口：${chrome.runtime.lastError.message}`);
        return;
      }
      if (!res?.ok) {
        toast(res?.error ? String(res.error) : "無法打開寬屏窗口");
        return;
      }
      toast("已打開寬屏窗口（約 880px）；可拖到馬會頁右側使用");
    });
  }

  $("#btn-wide-panel")?.addEventListener("click", openWidePanelWindow);
  $("#btn-wide-panel-hint")?.addEventListener("click", openWidePanelWindow);

  $("#btn-close-hint").addEventListener("click", () => window.close());

  $("#btn-add-bet").addEventListener("click", () => {
    addCurrentSelectionToSlip();
  });

  $("#btn-sync-hkjc")?.addEventListener("click", () => {
    void syncToHkjcBettingSlip();
  });

  $("#btn-slip-clear")?.addEventListener("click", () => {
    clearSlip();
  });

  function updateMarketMeta() {
    const el = $("#q-ev");
    if (!el) return;
    if (lastOddsFetchAt) {
      const d = new Date(lastOddsFetchAt);
      el.textContent = d.toLocaleTimeString("zh-HK", { hour12: false });
      return;
    }
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    const ss = String(now.getSeconds()).padStart(2, "0");
    el.textContent = `${hh}:${mm}:${ss}`;
  }

  renderNav();
  syncTopbarRace();
  setModeVisibility();
  renderRacePanel();
  renderNums();
  renderAmounts();
  updateRuleHint();

  updateMarketMeta();
  updateStatus();
  renderSlip();

  $("#action-feedback-close")?.addEventListener("click", hideActionFeedback);

  // 先同步綁定事件，避免初始化 await 期間用戶提交表單導致預設刷新
  $("#login-form")?.addEventListener("submit", handleLoginSubmit);
  async function copyTextToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(ta);
        return ok;
      } catch {
        return false;
      }
    }
  }

  $("#btn-copy-token")?.addEventListener("click", async () => {
    const raw = auth?.token;
    if (!raw) {
      toast("請先登入");
      return;
    }
    const headerVal = raw.startsWith("Bearer ") ? raw : `Bearer ${raw}`;
    const ok = await copyTextToClipboard(headerVal);
    toast(ok ? "已複製登入憑證（調試用）" : "複製失敗");
  });

  $("#btn-logout")?.addEventListener("click", async () => {
    resetSessionExpiredGuard();
    await logoutToLogin("已退出登入");
  });

  // Auth init：popup 每次打開都會重新執行腳本，須從 chrome.storage 恢復 token（與是否點「退出」無關）
  (async () => {
    try {
      await loadHkjcPrefs();
      await loadAuth();
      const b = await storageGet(API_BASE_KEY);
      const storedBase = b?.[API_BASE_KEY];
      if (storedBase && typeof storedBase === "string") apiBase = storedBase.replace(/\/+$/, "");
      if ($("#login-base")) $("#login-base").value = apiBase;
      await applyRememberedUsername();
      if (auth?.token) {
        await ensureAuthOrShowLogin();
      }
      // 如果此時用戶已完成登入，避免把視圖切回登入頁
      if (!authInitDone) showView(Boolean(auth?.token));
      if (auth?.token) restartOddsAutoRefresh();
    } catch (e) {
      console.warn("[raceplugin] 初始化登入態失敗:", e);
      if (!authInitDone) showView(false);
    }

    // 預載入真實場次數據（不阻塞 UI）
    ensureMeetingLoaded().then((ok) => {
      if (!ok) return;
      renderRacePanel();
      syncTopbarRace();
      renderNums();
      updateStatus();
      updateRuleHint();
    });
  })();
})();
