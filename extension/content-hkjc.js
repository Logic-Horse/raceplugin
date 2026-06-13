/**
 * bet.hkjc.com：將插件注項同步至右側投注區（獨贏 / 位置 / 連贏 / 位置Q），不點擊「發送注項」。
 */
(() => {
  const SCRIPT_VERSION = 72;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /** syncDebug 默认开启；payload.syncDebug===false 或 __racepluginSyncDebug.disable() 可关 */
  let syncDebugOn = false;
  const syncTraceLog = [];

  function setSyncDebug(enabled) {
    syncDebugOn = Boolean(enabled);
    if (!syncDebugOn) syncTraceLog.length = 0;
  }

  function elSyncId(el) {
    if (!el) return "?";
    if (el.id) return `#${el.id}`;
    const cls = String(el.className || "")
      .split(/\s+/)
      .filter(Boolean)[0];
    return cls ? `.${cls}` : String(el.tagName || "").toLowerCase();
  }

  function syncDebug(msg, extra) {
    if (!syncDebugOn) return;
    const line =
      extra === undefined
        ? String(msg)
        : `${msg} ${typeof extra === "object" ? JSON.stringify(extra) : extra}`;
    syncTraceLog.push({ t: Date.now(), msg: line });
    console.log("[raceplugin-sync]", line);
  }

  function syncDebugErr(msg, err) {
    if (!syncDebugOn) return;
    const detail = err?.code || err?.message || String(err ?? "");
    syncDebug(`✗ ${msg}`, detail);
  }

  globalThis.__racepluginSyncDebug = {
    enable() {
      setSyncDebug(true);
      console.log("[raceplugin-sync] 调试已开启（下次同步会逐步输出）");
    },
    disable() {
      setSyncDebug(false);
      console.log("[raceplugin-sync] 调试已关闭");
    },
    get trace() {
      return syncTraceLog.map((x) => x.msg);
    },
  };

  function withSyncTrace(result) {
    if (!syncDebugOn || !result || typeof result !== "object") return result;
    return { ...result, syncTrace: syncTraceLog.map((x) => x.msg) };
  }

  /** 條件滿足即返回，避免固定長 sleep */
  async function pollUntil(testFn, opts = {}) {
    const interval = opts.interval ?? 45;
    const maxMs = opts.maxMs ?? 4000;
    const started = Date.now();
    while (Date.now() - started < maxMs) {
      const v = testFn();
      if (v) return v;
      await sleep(interval);
    }
    return null;
  }

  function isWinType(t) {
    const s = String(t || "").trim();
    return s === "獨贏" || s === "独赢" || s === "WIN";
  }

  function isQinType(t) {
    const s = String(t || "").trim();
    return s === "連贏" || s === "连赢" || s === "QIN";
  }

  function isQplType(t) {
    const s = String(t || "").trim();
    return s === "位置Q" || s === "位置 Q" || s === "QPL";
  }

  function isPlaType(t) {
    const s = String(t || "").trim();
    return s === "位置" || s === "Place" || s === "PLACE" || s === "PLA";
  }

  const onMessage = (msg, _sender, sendResponse) => {
    if (msg?.type === "HKJC_PING") {
      sendResponse({ ok: true, v: SCRIPT_VERSION });
      return false;
    }
    if (msg?.type === "HKJC_VERIFY_STAKE") {
      void verifyHkjcSlipStake(msg.payload)
        .then(sendResponse)
        .catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }));
      return true;
    }
    if (msg?.type !== "HKJC_APPLY_SLIP") return false;
    void applySlip(msg.payload)
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }));
    return true;
  };

  if (globalThis.__racepluginHkjcOnMessage) {
    try {
      chrome.runtime.onMessage.removeListener(globalThis.__racepluginHkjcOnMessage);
    } catch {
      /* ignore */
    }
  }
  globalThis.__racepluginHkjcOnMessage = onMessage;
  chrome.runtime.onMessage.addListener(onMessage);

  function parseHkjcRacePath(url) {
    try {
      const parts = new URL(url).pathname.split("/").filter(Boolean);
      const ri = parts.indexOf("racing");
      if (ri < 0 || parts.length < ri + 5) return null;
      return {
        segment: parts[ri + 1],
        date: parts[ri + 2],
        venue: String(parts[ri + 3]).toUpperCase(),
        race: Number(parts[ri + 4]),
      };
    } catch {
      /* ignore */
    }
    return null;
  }

  function sameMeetingContext(a, b) {
    return Boolean(a && b && a.date === b.date && a.venue === b.venue);
  }

  function parseQinCombo(combo) {
    const parts = String(combo ?? "")
      .trim()
      .split(/\D+/)
      .filter(Boolean)
      .map((x) => Number(x));
    if (parts.length !== 2) return null;
    const [a, b] = parts;
    if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0 || a === b) return null;
    return a < b ? [a, b] : [b, a];
  }

  const isCrossAlupPage = () => location.pathname.includes("cross_alup");
  const pollMs = () => (isCrossAlupPage() ? 48 : 32);

  /**
   * P1：填額專用節奏，與導航/checkbox poll 隔離；不受任何導航加速影響。
   */
  const stakeFillPollMs = () => (isCrossAlupPage() ? 42 : 36);
  const stakePreFillMs = () => (isCrossAlupPage() ? 100 : 72);
  const stakePostTypeMs = () => (isCrossAlupPage() ? 52 : 38);
  const stakeRetryGapMs = (attempt) => 52 + attempt * 26;

  /** 頂欄 #venue_ST / #venue_S1 / #venue_S2（div[role=button]） */
  function getCurrentVenueFromDom() {
    const active =
      document.querySelector('.venue-list [id^="venue_"].active') ||
      document.querySelector('[id^="venue_"].active[role="button"]') ||
      document.querySelector('.venue-list .active[id^="venue_"]');
    if (active?.id) {
      const m = /^venue_(.+)$/i.exec(active.id);
      if (m) return m[1].toUpperCase();
    }
    const fromUrl = parseHkjcRacePath(location.href);
    return fromUrl?.venue ? String(fromUrl.venue).toUpperCase() : null;
  }

  function isVenueTabActive(venueCode) {
    const v = String(venueCode ?? "").trim().toUpperCase();
    if (!v) return false;
    const el = document.getElementById(`venue_${v}`);
    if (el && (el.classList.contains("active") || /\bactive\b/.test(el.className || ""))) return true;
    return getCurrentVenueFromDom() === v;
  }

  async function ensureVenueTab(venueCode) {
    const v = String(venueCode ?? "").trim().toUpperCase();
    if (!v) return false;
    if (isVenueTabActive(v)) return true;

    syncDebug(`切换马场 #venue_${v}`);
    const venueEl = document.getElementById(`venue_${v}`);
    if (venueEl) {
      try {
        venueEl.scrollIntoView({ block: "nearest", inline: "center" });
      } catch {
        /* ignore */
      }
      firePointerClick(venueEl);
      firePointerClick(venueEl.querySelector("h3, span"));
      await pollUntil(() => isVenueTabActive(v), { interval: pollMs(), maxMs: 3500 });
      if (isVenueTabActive(v)) {
        await pollUntil(
          () =>
            document.querySelector(`#raceno_1`) ||
            document.querySelector('input[id^="wpleg_"]') ||
            document.querySelector("#rcOddsTable"),
          { interval: pollMs(), maxMs: isCrossAlupPage() ? 1800 : 1200 }
        );
        await sleep(isCrossAlupPage() ? 120 : 80);
        return true;
      }
    }

    const labels = [v];
    if (v === "ST") labels.push("田");
    const nodes = [...document.querySelectorAll("button, a, [role='tab'], [role='button']")];
    for (const el of nodes) {
      const t = (el.textContent || "").replace(/\s+/g, " ").trim();
      if (!t || t.length > 6) continue;
      if (!labels.includes(t) && !labels.includes(t.toUpperCase())) continue;
      if (el.offsetParent === null) continue;
      firePointerClick(el);
      await pollUntil(() => isVenueTabActive(v), { interval: pollMs(), maxMs: 2500 });
      if (isVenueTabActive(v)) return true;
    }
    return false;
  }

  function findRaceNoButton(raceNo) {
    const n = Number(raceNo);
    if (!Number.isFinite(n) || n < 1) return null;
    return (
      document.querySelector(`#raceno_${n}`) ||
      document.querySelector(`[aria-label="第${n}場"]`) ||
      document.querySelector(`[aria-label="第 ${n} 場"]`) ||
      document.querySelector(`#raceNo_${n}`) ||
      document.querySelector(`[data-raceno="${n}"]`) ||
      document.querySelector(`[data-race-no="${n}"]`) ||
      [...document.querySelectorAll(".race-no-item, [role='button'][id^='raceno_']")].find(
        (el) => el.id === `raceno_${n}` || el.getAttribute("aria-label") === `第${n}場`
      ) ||
      [...document.querySelectorAll("button, a, [role='button'], [role='tab']")].find((el) => {
        const t = (el.textContent || "").replace(/\s+/g, "").trim();
        return t === String(n) && el.offsetParent !== null;
      }) ||
      null
    );
  }

  /** 以頁面 DOM 為準（#raceno_N.active、#meetingDescNo、wpleg_* 馬會常不落址） */
  function getCurrentRaceNoFromDom() {
    const activeRace =
      document.querySelector(".race-no-item.active[id^='raceno_']") ||
      document.querySelector("[id^='raceno_'].race-no-item.active") ||
      document.querySelector("[id^='raceno_'].active");
    if (activeRace?.id) {
      const m = /raceno_(\d+)/i.exec(activeRace.id);
      if (m) return Number(m[1]);
    }
    const desc = document.querySelector("#meetingDescNo");
    if (desc) {
      const m = /第\s*(\d+)\s*場/.exec((desc.textContent || "").replace(/\s/g, ""));
      if (m) return Number(m[1]);
    }
    for (const prefix of ["wpleg_WIN_", "wpleg_QIN_", "wpleg_QPL_"]) {
      const inp = document.querySelector(`input[id^="${prefix}"]`);
      if (inp?.id) {
        const m = new RegExp(`^${prefix}(\\d+)_`).exec(inp.id);
        if (m) return Number(m[1]);
      }
    }
    const fromUrl = parseHkjcRacePath(location.href);
    return fromUrl?.race != null && Number.isFinite(Number(fromUrl.race))
      ? Number(fromUrl.race)
      : null;
  }

  async function waitForRaceReady(raceNo, maxMs = 5000) {
    const want = Number(raceNo);
    if (!Number.isFinite(want) || want < 1) return false;
    const ok = await pollUntil(
      () => {
        if (getCurrentRaceNoFromDom() !== want) return null;
        if (
          document.querySelector(`#raceno_${want}.active`) ||
          document.querySelector(`input[id^="wpleg_WIN_${want}_"]`) ||
          document.querySelector(`input[id^="wpleg_QIN_${want}_"]`) ||
          document.querySelector(`input[id^="wpleg_QPL_${want}_"]`)
        ) {
          return true;
        }
        return null;
      },
      { interval: pollMs(), maxMs }
    );
    return Boolean(ok) || getCurrentRaceNoFromDom() === want;
  }

  /** 場次 Tab 與賠率表 checkbox 均已就緒 */
  function isRaceDomReady(raceNo) {
    const want = Number(raceNo);
    if (!Number.isFinite(want) || want < 1) return false;
    if (getCurrentRaceNoFromDom() !== want) return false;
    return Boolean(
      document.querySelector(`#raceno_${want}.active`) ||
        document.querySelector(`input[id^="wpleg_WIN_${want}_"]`) ||
        document.querySelector(`input[id^="wpleg_QIN_${want}_"]`) ||
        document.querySelector(`input[id^="wpleg_QPL_${want}_"]`)
    );
  }

  async function ensureRaceReadyIfNeeded(raceNo, opts = {}) {
    if (isRaceDomReady(raceNo)) return true;
    return waitForRaceReady(raceNo, opts.maxMs ?? 2500);
  }

  /** 連贏/位置Q 賠率表 checkbox 已掛載（避免 P3 跳過等待後找不到勾選框） */
  async function ensureWpqRaceTableReady(raceNo, opts = {}) {
    const r = Number(resolveWpqRaceNo(raceNo));
    if (!Number.isFinite(r) || r < 1) return false;
    const ok = await pollUntil(
      () =>
        document.querySelector(`input[id^="wpleg_QIN_${r}_"]`) ||
        document.querySelector(`input[id^="wpleg_QPL_${r}_"]`) ||
        document.querySelector(`input[id^="wpbank"][id*="_QIN_${r}_"]`) ||
        document.querySelector(`input[id^="wpbank"][id*="_QPL_${r}_"]`),
      { interval: pollMs(), maxMs: opts.maxMs ?? 2200 }
    );
    return Boolean(ok);
  }

  function buildSyncPrepState(raceNo) {
    return {
      raceSettled: isRaceDomReady(raceNo),
      wpqReady: isWpqPoolReadyInUi(),
      qinSubTypeReady: isWpqPoolReadyInUi() && wpqSubTypeIs("QIN"),
      qplSubTypeReady: isWpqPoolReadyInUi() && wpqSubTypeIs("QPL"),
      winPoolReady: isWinPoolReadyInUi(),
      qinBankerModeReady: isQinBankerBetModeActive(),
    };
  }

  /** P3：導航勾選間隔（不影響填額 stakeFill* 節奏） */
  function navCbDelay(opts, fallback = 14) {
    if (opts?.poolReady || opts?.fast) return isCrossAlupPage() ? 8 : 5;
    return fallback;
  }

  /** 嘗試 SPA 改址不整頁 reload，較不易觸發「離開此網站？」 */
  function trySpaNavigateToUrl(targetUrl) {
    try {
      const want = new URL(targetUrl);
      if (want.origin !== location.origin) return false;
      const path = want.pathname + want.search + want.hash;
      if (location.pathname + location.search + location.hash === path) return true;
      history.pushState(history.state, "", path);
      window.dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
      return true;
    } catch {
      return false;
    }
  }

  async function clickRaceNoTab(raceNo) {
    const n = Number(raceNo);
    const tabBtn = findRaceNoButton(n);
    if (!tabBtn) return false;
    if (tabBtn.classList.contains("active") || tabBtn.closest?.(".active")) {
      return getCurrentRaceNoFromDom() === n;
    }
    syncDebug(`切换场次 #raceno_${n}`);
    try {
      tabBtn.scrollIntoView({ block: "nearest", inline: "center" });
    } catch {
      /* ignore */
    }
    firePointerClick(tabBtn);
    firePointerClick(tabBtn.querySelector("h3, span"));
    await sleep(isCrossAlupPage() ? 100 : 60);
    await pollUntil(
      () => getCurrentRaceNoFromDom() === n || document.querySelector(`#raceno_${n}.active`),
      { interval: pollMs(), maxMs: 2800 }
    );
    return getCurrentRaceNoFromDom() === n;
  }

  function pageMismatchPayload(targetUrl, raceNo, want, cur) {
    const domRace = getCurrentRaceNoFromDom();
    const domVenue = getCurrentVenueFromDom();
    return {
      ok: false,
      error: "PAGE_MISMATCH",
      expectedUrl: targetUrl,
      tabUrl: location.href,
      expectedRace: Number(raceNo),
      actualDomRace: domRace,
      actualDomVenue: domVenue,
      expected: want || null,
      actual: cur
        ? { ...cur, race: domRace ?? cur.race, venue: domVenue ?? cur.venue }
        : domRace != null || domVenue
          ? { race: domRace, venue: domVenue }
          : null,
    };
  }

  function isOnTargetRacePage(targetUrl, raceNo, venueCode) {
    const wantVenue = String(venueCode ?? parseHkjcRacePath(targetUrl)?.venue ?? "")
      .trim()
      .toUpperCase();
    const wantRace = Number(raceNo);
    const domRace = getCurrentRaceNoFromDom();
    const domVenue = getCurrentVenueFromDom();

    /** 頂欄 #venue_* / #raceno_* 為準（越洋 S1/S2/S3 切換時 URL 常不變） */
    if (Number.isFinite(wantRace) && wantRace > 0 && domRace === wantRace) {
      if (!wantVenue || !domVenue || domVenue === wantVenue) return true;
    }

    const want = parseHkjcRacePath(targetUrl);
    const cur = parseHkjcRacePath(location.href);
    if (want?.date && cur?.date && want.date !== cur.date) return false;

    return Boolean(
      cur &&
        want &&
        cur.date === want.date &&
        (!wantVenue || cur.venue === wantVenue) &&
        Number(cur.race) === wantRace
    );
  }

  async function navigateToTargetMeetingUrl(targetUrl) {
    if (!targetUrl || location.href === targetUrl) return;
    const want = parseHkjcRacePath(targetUrl);
    const cur = parseHkjcRacePath(location.href);
    if (want?.date && cur?.date && want.date === cur.date) return;
    if (trySpaNavigateToUrl(targetUrl)) {
      await sleep(isCrossAlupPage() ? 900 : 650);
      return;
    }
    location.assign(targetUrl);
    await pollUntil(
      () => {
        const now = parseHkjcRacePath(location.href);
        return now?.date === want?.date ? true : null;
      },
      { interval: pollMs(), maxMs: isCrossAlupPage() ? 4500 : 3500 }
    );
  }

  function isLeftPoolMenuActive(menuId) {
    const id = String(menuId || "").trim();
    const el = document.querySelector(`li#${id}`) || document.getElementById(id);
    if (!el) return false;
    if (el.classList.contains("active") || el.closest?.(".active")) return true;
    return /active|selected|current|on/i.test(el.className || "");
  }

  function isCheckboxVisible(cb) {
    return isInteractiveCheckbox(cb);
  }

  /** 馬會 checkbox 被鎖定（未開盤 / 已截止） */
  function isCheckboxBettingLocked(el) {
    const input = el?.type === "checkbox" ? el : el?.querySelector?.('input[type="checkbox"]');
    if (!input) return false;
    if (input.disabled) return true;
    if (input.closest?.(".checkbox-disabled")) return true;
    const wrap = input.closest?.(".checkbox-container");
    if (wrap?.classList.contains("checkbox-disabled")) return true;
    return false;
  }

  /** 馬會常用自訂 checkbox（input 可為 0×0，外層 .checkbox-container 可點） */
  function isInteractiveCheckbox(el) {
    if (!el || isCheckboxBettingLocked(el)) return false;
    const wrap = el.closest?.(".checkbox-container") || el;
    const r = wrap.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return true;
    if (el.type === "checkbox" && el.offsetParent !== null) return true;
    return false;
  }

  function getClickableCheckboxTarget(cb) {
    if (!cb) return null;
    const wrap = cb.closest?.(".checkbox-container");
    if (wrap) return wrap.querySelector("span") || wrap;
    return cb;
  }

  /** 左側菜單與賠率表均在「獨贏/位置」彩池（勿僅因 DOM 內有隱藏節點而誤判） */
  function isWinPoolReadyInUi() {
    const cb = document.querySelector('input[id^="wpleg_WIN_"]');
    return isLeftPoolMenuActive("wp") && isCheckboxVisible(cb);
  }

  /** 左側菜單與賠率表均在「連贏/位置Q」彩池 */
  function isWpqPoolReadyInUi() {
    const cb = document.querySelector('input[id^="wpleg_QIN_"], input[id^="wpleg_QPL_"]');
    return isLeftPoolMenuActive("wpq") && isCheckboxVisible(cb);
  }

  /** 左側「賠率」菜單：#wp 獨贏/位置、#wpq 連贏/位置Q（SPA 切換，不清投注區） */
  async function clickLeftMenuPool(menuId) {
    const id = String(menuId || "").trim();
    if (!id) return false;
    if (isLeftPoolMenuActive(id)) return true;
    syncDebug(`切换玩法 #${id}`);
    const el =
      document.querySelector(`li#${id}`) ||
      document.getElementById(id) ||
      document.querySelector(`#${id}.cursor-pointer`);
    if (!el) return false;
    try {
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
    } catch {
      /* ignore */
    }
    firePointerClick(el);
    firePointerClick(el.querySelector("span"));
    const ok = await pollUntil(() => isLeftPoolMenuActive(id), {
      interval: pollMs(),
      maxMs: isCrossAlupPage() ? 2200 : 1800,
    });
    return Boolean(ok);
  }

  /**
   * 同步準備：① 馬場 + 場次 → ② 左側玩法（與官網人手操作順序一致）
   */
  async function prepareHkjcUiForSync(
    payload,
    winFinal,
    plaFinal,
    qinFinal,
    qplFinal,
    raceNo,
    venueCode,
    targetUrl
  ) {
    const needWpFirst = winFinal.length > 0 || plaFinal.length > 0;
    const needQin = qinFinal.length > 0;
    const needQpl = qplFinal.length > 0;

    await ensureOnRacePage(targetUrl, raceNo, venueCode, {
      strictSamePage: payload.strictSamePage !== false,
    });

    const r = Number(raceNo);
    if (!isRaceDomReady(r)) {
      await waitForRaceReady(r, isCrossAlupPage() ? 3500 : 2500);
    }

    if (needWpFirst) {
      await ensureWinPoolTab({ soft: false });
    } else if (needQin || needQpl) {
      await ensureWpqPoolReady({ soft: false });
      if (needQin && !needQpl) {
        await ensureWpqSubType("QIN", { soft: false });
        const { singles, batches } = partitionQinBankerBatches(qinFinal);
        const { extraSingles } = expandBankerBatchesForSync(batches);
        if (singles.length || extraSingles.length) {
          await ensureWpqBoxBetMode();
        } else if (batches.length) {
          await ensureQinBankerBetMode();
        }
      } else if (needQpl && !needQin) {
        await ensureWpqSubType("QPL", { soft: false });
        const { singles, batches } = partitionQinBankerBatches(qplFinal);
        const { extraSingles } = expandBankerBatchesForSync(batches);
        if (singles.length || extraSingles.length) {
          await ensureWpqBoxBetMode();
        }
      }
    }

    return buildSyncPrepState(r);
  }

  /**
   * 同步準備步驟 ①：切馬場 #venue_* → 切場次 #raceno_*（必要時改址至正確賽馬日）
   * 越洋同日多馬場以 DOM 頂欄為準，不依 URL 判斷是否已就緒。
   */
  async function ensureOnRacePage(targetUrl, raceNo, venueCode, opts = {}) {
    const strict = opts.strictSamePage !== false;
    const want = parseHkjcRacePath(targetUrl);
    const venue = String(venueCode ?? want?.venue ?? "").trim().toUpperCase();
    const r = Number(raceNo);

    await navigateToTargetMeetingUrl(targetUrl);

    for (let attempt = 0; attempt < 4; attempt++) {
      if (isOnTargetRacePage(targetUrl, raceNo, venue)) return;

      if (venue) {
        await ensureVenueTab(venue);
        await sleep(isCrossAlupPage() ? 140 : 90);
      }

      if (getCurrentRaceNoFromDom() !== r) {
        if (await clickRaceNoTab(r)) {
          await waitForRaceReady(r, isCrossAlupPage() ? 4000 : 3000);
        }
      }

      if (isOnTargetRacePage(targetUrl, raceNo, venue)) return;
      await sleep(isCrossAlupPage() ? 180 : 120);
    }

    if (isOnTargetRacePage(targetUrl, raceNo, venue)) return;

    if (strict) {
      const err = new Error("PAGE_MISMATCH");
      err.code = "PAGE_MISMATCH";
      Object.assign(err, pageMismatchPayload(targetUrl, raceNo, want, parseHkjcRacePath(location.href)));
      throw err;
    }

    if (targetUrl && location.href !== targetUrl) {
      trySpaNavigateToUrl(targetUrl);
      await sleep(600);
      if (isOnTargetRacePage(targetUrl, raceNo, venue)) return;
      location.assign(targetUrl);
      await pollUntil(
        () => (isOnTargetRacePage(targetUrl, raceNo, venue) ? true : null),
        { interval: pollMs(), maxMs: isCrossAlupPage() ? 3500 : 2800 }
      );
    }
  }

  function clickPoolNav(matcher) {
    const nodes = [...document.querySelectorAll("a, button, [role='tab'], li, span, div")];
    for (const el of nodes) {
      const t = (el.textContent || "").replace(/\s+/g, " ").trim();
      if (!t || t.length > 40) continue;
      if (matcher(t) && el.offsetParent !== null) {
        el.click();
        return true;
      }
    }
    return false;
  }

  /** soft：已在獨贏/連贏表時不切彩池，避免右側投注區被馬會重置 */
  async function ensureWinPoolTab(opts = {}) {
    if (opts.soft !== false && isWinPoolReadyInUi()) return;
    const clicked = await clickLeftMenuPool("wp");
    if (!clicked) {
      clickPoolNav((t) => /獨贏/.test(t) && /位置/.test(t));
      clickPoolNav((t) => /^獨贏/.test(t) || (t.includes("獨贏") && t.length <= 12));
    }
    await pollUntil(
      () =>
        isLeftPoolMenuActive("wp") &&
        document.querySelector('input[id^="wpleg_WIN_"]'),
      {
        interval: pollMs(),
        maxMs: isCrossAlupPage() ? 2800 : 2000,
      }
    );
    await sleep(isCrossAlupPage() ? 120 : 80);
  }

  function isUiVisible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const st = getComputedStyle(el);
    if (st.visibility === "hidden" || st.display === "none") return false;
    return el.offsetParent !== null || st.position === "fixed";
  }

  /** 模擬完整指標序列，React 自訂 radio 較易響應 */
  function firePointerClick(el) {
    if (!el) return;
    try {
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
    } catch {
      /* ignore */
    }
    const base = { bubbles: true, cancelable: true, view: window };
    try {
      el.dispatchEvent(
        new PointerEvent("pointerdown", { ...base, pointerId: 1, pointerType: "mouse", isPrimary: true })
      );
      el.dispatchEvent(new MouseEvent("mousedown", base));
      el.dispatchEvent(
        new PointerEvent("pointerup", { ...base, pointerId: 1, pointerType: "mouse", isPrimary: true })
      );
      el.dispatchEvent(new MouseEvent("mouseup", base));
      el.dispatchEvent(new MouseEvent("click", base));
    } catch {
      el.click();
    }
  }

  /** 繞過 React controlled input，同步 #subTypeQPL 等 radio 的 checked */
  function setNativeRadioChecked(radio, checked = true) {
    if (!radio || radio.type !== "radio") return;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked")?.set;
    if (setter) setter.call(radio, checked);
    else radio.checked = checked;
    radio.dispatchEvent(new Event("input", { bubbles: true }));
    radio.dispatchEvent(new Event("change", { bubbles: true }));
  }

  /** 位置Q 子玩法下 checkbox id 為 wpleg_QPL_* / wpbank1_QPL_*，連贏為 QIN */
  function resolveWpqCheckboxPool(explicitPool) {
    const p = String(explicitPool || "").toUpperCase();
    if (p === "QPL" || p === "QIN" || p === "QQP") return p;
    if (wpqSubTypeIs("QPL")) return "QPL";
    if (wpqSubTypeIs("QQP")) return "QQP";
    return "QIN";
  }

  function wpqPoolTagsForLookup(explicitPool) {
    const primary = resolveWpqCheckboxPool(explicitPool);
    return [primary, ...["QIN", "QPL", "QQP"].filter((t) => t !== primary)];
  }

  /** WPQ 頁「連贏 / 位置Q / 連贏及位置Q」子玩法 */
  function wpqSubTypeIs(pool) {
    const p = String(pool || "").toUpperCase();
    const radio = document.getElementById(`subType${p}`);
    if (radio?.checked) return true;
    const wrap = document.querySelector(`.radio-button-set-method-${p}`);
    if (wrap?.classList.contains("radio-button-set-item-checked")) return true;
    const mobile = document.getElementById(`subTypeMobile${p}`);
    if (mobile?.classList.contains("active")) return true;
    if (mobile?.getAttribute("aria-selected") === "true") return true;
    return false;
  }

  function wpqSubtypeLabel(pool) {
    const p = String(pool || "").toUpperCase();
    if (p === "QPL") return "位置Q";
    if (p === "QQP") return "連贏及位置Q";
    return "連贏";
  }

  function findWpqSubTypeControls(pool) {
    const p = String(pool || "QIN").toUpperCase();
    const wrap = document.querySelector(`.radio-button-set-method-${p}`);
    const radio = document.getElementById(`subType${p}`);
    const label = wrap?.querySelector("label.radio-container") || radio?.closest("label");
    const textSpan = label?.querySelector("span:not(.radio-checkmark)");
    const mobile = document.getElementById(`subTypeMobile${p}`);
    return { p, wrap, radio, label, textSpan, mobile };
  }

  /** 點選 WPQ 右側「連贏 / 位置Q / …」單選（對齊 bet.hkjc.com 的 radio-button-set DOM） */
  async function clickWpqSubTypeControl(pool) {
    const { p, wrap, radio, label, textSpan, mobile } = findWpqSubTypeControls(pool);
    const useDesktop = wrap && isUiVisible(wrap);
    const useMobile = mobile && isUiVisible(mobile) && !useDesktop;

    if (useDesktop) {
      firePointerClick(textSpan);
      await sleep(20);
      firePointerClick(label);
      await sleep(20);
      firePointerClick(wrap);
      if (radio && !radio.checked) {
        setNativeRadioChecked(radio, true);
        firePointerClick(radio);
      }
    } else if (useMobile) {
      firePointerClick(mobile.querySelector("div") || mobile);
      await sleep(20);
      firePointerClick(mobile);
    } else {
      firePointerClick(textSpan);
      firePointerClick(label);
      firePointerClick(radio);
      firePointerClick(mobile?.querySelector("div") || mobile);
      if (radio && !radio.checked) setNativeRadioChecked(radio, true);
    }

    const wantLabel = wpqSubtypeLabel(p).replace(/\s/g, "");
    for (const span of document.querySelectorAll(".radio-button-set-item label span:not(.radio-checkmark)")) {
      const t = (span.textContent || "").replace(/\s/g, "");
      if (t === wantLabel) {
        firePointerClick(span);
        firePointerClick(span.closest("label"));
        break;
      }
    }

    await sleep(isCrossAlupPage() ? 90 : 55);
  }

  async function ensureWpqSubType(pool, opts = {}) {
    const p = String(pool || "QIN").toUpperCase();
    if (opts.soft !== false && wpqSubTypeIs(p)) return;

    await pollUntil(() => document.getElementById(`subType${p}`), {
      interval: pollMs(),
      maxMs: isCrossAlupPage() ? 2200 : 1600,
    });

    for (let attempt = 0; attempt < 6; attempt++) {
      await clickWpqSubTypeControl(p);
      if (wpqSubTypeIs(p)) return;
      await sleep(isCrossAlupPage() ? 120 : 85);
    }

    const ok = await pollUntil(() => wpqSubTypeIs(p), {
      interval: pollMs(),
      maxMs: isCrossAlupPage() ? 3600 : 2800,
    });
    if (!ok && !wpqSubTypeIs(p)) {
      throw new Error(`HKJC_${p}_SUBTYPE_NOT_READY`);
    }
  }

  function assertBetLineIsQpl(line) {
    if (isQplBetLine(line)) return;
    if (isQinBetLine(line)) throw new Error("HKJC_BANKER_LINE_MISMATCH:qin-instead-of-qpl");
    throw new Error("HKJC_BANKER_LINE_MISMATCH:wrong-pool");
  }

  function filterFinalsBySyncScope(scope, winFinal, plaFinal, qinFinal, qplFinal) {
    const s = String(scope || "all").toLowerCase();
    if (s === "all") return { winFinal, plaFinal, qinFinal, qplFinal };
    return {
      winFinal: s === "win" ? winFinal : [],
      plaFinal: s === "pla" ? plaFinal : [],
      qinFinal: s === "qin" ? qinFinal : [],
      qplFinal: s === "qpl" ? qplFinal : [],
    };
  }

  async function ensureWpqPoolReady(opts = {}) {
    if (opts.soft !== false && isWpqPoolReadyInUi()) return;
    const clicked = await clickLeftMenuPool("wpq");
    if (!clicked) {
      const ok = clickPoolNav((t) => /連贏/.test(t) && (/位置Q|位置 Q/.test(t) || /QPL/.test(t)));
      if (!ok) clickPoolNav((t) => /^連贏/.test(t) || t.includes("連贏 /"));
    }
    await pollUntil(
      () =>
        isLeftPoolMenuActive("wpq") &&
        (document.querySelector('input[id^="wpleg_QIN_"]') ||
          document.querySelector('input[id^="wpleg_QPL_"]')),
      {
        interval: pollMs(),
        maxMs: isCrossAlupPage() ? 2800 : 2000,
      }
    );
    await sleep(isCrossAlupPage() ? 120 : 80);
  }

  async function ensureQinPoolTab(opts = {}) {
    if (opts.soft !== false && isWpqPoolReadyInUi() && wpqSubTypeIs("QIN")) {
      return;
    }
    await ensureWpqPoolReady(opts);
    await ensureWpqSubType("QIN", { soft: false });
  }

  async function ensureQplPoolTab(opts = {}) {
    if (opts.soft !== false && isWpqPoolReadyInUi() && wpqSubTypeIs("QPL")) {
      return;
    }
    await ensureWpqPoolReady(opts);
    await ensureWpqSubType("QPL", { soft: false });
  }

  function isQinBankerBetModeActive() {
    const ids = ["subTypeBT", "subTypeBanker", "subTypeBANKER", "subTypeFCTBanker"];
    for (const id of ids) {
      if (document.getElementById(id)?.checked) return true;
    }
    return Boolean(
      document.querySelector(".radio-button-set-method-BT.radio-button-set-item-checked")
    );
  }

  /** 連贏膽拖：部分場次需先切到「膽拖」投注方式（非複式）；返回 true 表示剛切換需短等 */
  async function ensureQinBankerBetMode() {
    if (isQinBankerBetModeActive()) return false;

    const ids = ["subTypeBT", "subTypeBanker", "subTypeBANKER", "subTypeFCTBanker"];
    for (const id of ids) {
      const radio = document.getElementById(id);
      if (radio && !radio.checked) {
        radio.click();
        radio.closest("label")?.click();
        await sleep(120);
        return true;
      }
    }
    const wrap = document.querySelector(".radio-button-set-method-BT, .radio-button-set-method-Banker");
    if (wrap && !wrap.classList.contains("radio-button-set-item-checked")) {
      wrap.querySelector("label, input")?.click();
      wrap.click();
      await sleep(120);
      return true;
    }
    if (clickPoolNav((t) => /^膽拖$|^胆拖$/.test(t.replace(/\s/g, "")))) {
      await sleep(150);
      return true;
    }
    return false;
  }

  /** Dutch 各組合金額不同時改複式同步：離開「膽拖」投注方式，在「腳」欄選兩匹 */
  async function ensureWpqBoxBetMode() {
    const bankerIds = ["subTypeBT", "subTypeBanker", "subTypeBANKER", "subTypeFCTBanker"];
    let bankerOn = false;
    for (const id of bankerIds) {
      if (document.getElementById(id)?.checked) {
        bankerOn = true;
        break;
      }
    }
    if (
      !bankerOn &&
      !document.querySelector(".radio-button-set-method-BT.radio-button-set-item-checked")
    ) {
      return false;
    }

    const boxWraps = [
      ".radio-button-set-method-FCT:not(.radio-button-set-method-BT)",
      ".radio-button-set-method-BOX",
      ".radio-button-set-method-BX",
      ".radio-button-set-method-Normal",
      ".radio-button-set-method-Multi",
    ];
    for (const sel of boxWraps) {
      const wrap = document.querySelector(sel);
      if (!wrap || wrap.classList.contains("radio-button-set-item-checked")) continue;
      const label = wrap.querySelector("label, input");
      if (label) {
        firePointerClick(label);
        await sleep(100);
        return true;
      }
    }
    if (clickPoolNav((t) => /^複式$|^复式$/.test(t.replace(/\s/g, "")))) {
      await sleep(120);
      return true;
    }
    for (const id of bankerIds) {
      const radio = document.getElementById(id);
      if (radio?.checked) {
        setNativeRadioChecked(radio, false);
        firePointerClick(radio.closest("label") || radio);
        await sleep(80);
        return true;
      }
    }
    return false;
  }

  function normalizeStakeTen(stake) {
    return Math.max(10, Math.round(Number(stake) / 10) * 10 || 10);
  }

  function readStakeFromLine(line) {
    const roots = [
      line?.querySelector(".collapse-content-r"),
      line?.querySelector(".unit-stake"),
      line,
    ].filter(Boolean);
    for (const root of roots) {
      for (const input of root.querySelectorAll("input.OfInnerInput, input[type='text'], input")) {
        if (!input || input.disabled || input.type === "checkbox") continue;
        const n = Number(String(input.value || "").replace(/[^\d.]/g, ""));
        if (Number.isFinite(n) && n > 0) return normalizeStakeTen(n);
      }
    }
    return null;
  }

  /** 從馬會文案解析港幣十位金額（如 $160.00 → 160） */
  function parseHkdFromText(text) {
    const n = Number(String(text || "").replace(/[^\d.]/g, ""));
    return Number.isFinite(n) ? normalizeStakeTen(n) : null;
  }

  /** 讀取注單行「注數」「投注金額」——反映 React 已提交狀態，非僅 input 顯示值 */
  function readLineBetMeta(line) {
    if (!line) return { betCount: 1, committedAmount: null };
    const text = (line.textContent || "").replace(/\s+/g, " ");
    let betCount = 1;
    const countM = /注[数數]\s*[:：]?\s*(\d+)/i.exec(text);
    if (countM) betCount = Math.max(1, Number(countM[1]) || 1);
    let committedAmount = null;
    const amtM = /投注金[额額]\s*[:：]\s*\$?\s*([\d,]+(?:\.\d{1,2})?)/i.exec(text);
    if (amtM) committedAmount = parseHkdFromText(amtM[1]);
    return { betCount, committedAmount };
  }

  function expectedLineCommittedAmount(stake, betCount) {
    const per = normalizeStakeTen(stake);
    const n = Math.max(1, Number(betCount) || 1);
    return per * n;
  }

  /** 該行金額是否已由馬會接受（優先看行內 input，再看行小計文案） */
  function isLineStakeCommitted(line, stake) {
    const wantPer = normalizeStakeTen(stake);
    const inputStake = readStakeFromLine(line);
    if (inputStake === wantPer) return true;
    const meta = readLineBetMeta(line);
    const wantCommitted = expectedLineCommittedAmount(stake, meta.betCount);
    if (meta.committedAmount != null) return meta.committedAmount === wantCommitted;
    return false;
  }

  /** 行內文案「投注金額」是否已與目標一致（比 input 顯示值更可靠） */
  function isLineStakeReactCommitted(line, stake) {
    const meta = readLineBetMeta(line);
    const wantCommitted = expectedLineCommittedAmount(stake, meta.betCount);
    if (meta.committedAmount != null) return meta.committedAmount === wantCommitted;
    return isLineStakeCommitted(line, stake);
  }

  /** 投注區底部「總投注金額」 */
  function readBetSlipGrandTotal() {
    const scopes = [
      document.querySelector("#betslip-panel"),
      document.querySelector('[data-testid="bet_placeBetList_scrollView"]')?.closest("[class*='slip'], [class*='Slip'], div"),
      document.querySelector("#betslip-panel")?.parentElement,
    ].filter(Boolean);

    const labelRe = /[總总]投注金[额額]?\s*[:：]?\s*\$?\s*([\d,]+(?:\.\d{1,2})?)/gi;
    for (const scope of scopes) {
      const text = (scope.innerText || scope.textContent || "").replace(/\s+/g, " ");
      const matches = [...text.matchAll(labelRe)];
      if (matches.length) {
        const n = parseHkdFromText(matches[matches.length - 1][1]);
        if (n != null) {
          const lineSum = sumSlipLineInputStakes();
          if (!getBetLines().length && lineSum <= 0 && n === 10) continue;
          return n;
        }
      }
    }

    for (const scope of scopes) {
      for (const el of scope.querySelectorAll("[class*='total'], [class*='Total'], [class*='grand']")) {
        const t = (el.textContent || "").replace(/\s+/g, " ");
        const m = /\$?\s*([\d,]+(?:\.\d{1,2})?)\s*$/.exec(t.trim());
        if (m) {
          const n = parseHkdFromText(m[1]);
          if (n != null && n >= 10) return n;
        }
      }
    }

    const committedSum = sumSlipLineCommittedStakes();
    if (committedSum > 0) return committedSum;
    return null;
  }

  function sumSlipLineCommittedStakes() {
    let sum = 0;
    let any = false;
    for (const line of getBetLines()) {
      const meta = readLineBetMeta(line);
      if (meta.committedAmount != null) {
        sum += meta.committedAmount;
        any = true;
      }
    }
    return any ? normalizeStakeTen(sum) : 0;
  }

  function sumSlipLineInputStakes() {
    return getBetLines().reduce((s, line) => s + (readStakeFromLine(line) || 0), 0);
  }

  function captureSlipBaseline() {
    const lineCount = getBetLines().length;
    const lineInputSum = sumSlipLineInputStakes();
    let grandTotal = readBetSlipGrandTotal();
    if (lineCount === 0 && lineInputSum <= 0) grandTotal = null;
    return { lineCount, lineInputSum, grandTotal };
  }

  function normalizeSlipBaseline(baseline) {
    if (baseline && typeof baseline === "object" && "lineInputSum" in baseline) {
      return {
        lineCount: Number(baseline.lineCount) || 0,
        lineInputSum: Number(baseline.lineInputSum) || 0,
        grandTotal:
          baseline.grandTotal != null && Number.isFinite(Number(baseline.grandTotal))
            ? normalizeStakeTen(baseline.grandTotal)
            : null,
      };
    }
    const grand =
      baseline != null && Number.isFinite(Number(baseline)) ? normalizeStakeTen(baseline) : null;
    return { lineCount: getBetLines().length, lineInputSum: sumSlipLineInputStakes(), grandTotal: grand };
  }

  function sumItemsStake(items) {
    return (Array.isArray(items) ? items : []).reduce(
      (s, it) => s + normalizeStakeTen(it?.stakePerLine),
      0
    );
  }

  /** Dutch 膽拖各組合金額不同 → 拆成多行複式同步 */
  function hasDutchBankerBoxExpansion(items) {
    const { batches } = partitionQinBankerBatches(Array.isArray(items) ? items : []);
    return batches.some((batch) => !bankerBatchStakesEqual(batch.items));
  }

  /** Dutch 可拆賬（膽拖+複式）時跳過底部總投核對：插件逐行累加與馬會一行多注/複式行小計可能不一致 */
  function shouldSkipGrandTotalVerify(payload, qinFinal, qplFinal) {
    if (payload?.skipGrandTotalVerify === true) return true;
    if (payload?.dutchStakeMode !== true) return false;
    if (hasDutchBankerBoxExpansion(qinFinal) || hasDutchBankerBoxExpansion(qplFinal)) {
      return true;
    }
    if (payload?.bankerMode && (qinFinal.length > 0 || qplFinal.length > 0)) return true;
    return false;
  }

  function buildSkippedGrandTotalVerify(expectedDelta, slipBaseline) {
    const b = normalizeSlipBaseline(slipBaseline);
    const want = normalizeStakeTen(expectedDelta);
    return {
      ok: true,
      skippedGrandTotal: true,
      expectedDelta: want,
      actualDelta: null,
      grandTotal: readBetSlipGrandTotal(),
      slipTotalBefore: b.grandTotal,
      lineInputSum: sumSlipLineInputStakes(),
    };
  }

  function buildStakeVerifyForSync(payload, syncedItems, slipBaseline, qinFinal, qplFinal) {
    const expectedDelta = sumItemsStake(syncedItems);
    if (shouldSkipGrandTotalVerify(payload, qinFinal, qplFinal)) {
      return buildSkippedGrandTotalVerify(expectedDelta, slipBaseline);
    }
    return buildStakeVerifySnapshot(expectedDelta, slipBaseline);
  }

  async function verifySyncStakeTotalsIfNeeded(payload, slipBaseline, items, qinFinal, qplFinal) {
    if (shouldSkipGrandTotalVerify(payload, qinFinal, qplFinal)) return;
    await verifySyncStakeTotals(slipBaseline, items);
  }

  function horseFromWinCheckboxId(id) {
    const m = /wpleg_(?:[A-Z0-9]+_)?WIN_\d+_(\d+)/i.exec(String(id || ""));
    return m ? String(Number(m[1])) : "";
  }

  function horseFromPlaCheckboxId(id) {
    const m = /wpleg_(?:[A-Z0-9]+_)?PLA_\d+_(\d+)/i.exec(String(id || ""));
    return m ? String(Number(m[1])) : "";
  }

  /** 獨贏/位置單馬注：標籤須為單一馬號，勿把「2 + 3」配對行誤配到馬 2 或 3 */
  function isSingleHorseBetLabel(label, horseNo) {
    const h = String(Number(horseNo));
    const t = String(label || "").replace(/\s+/g, " ").trim();
    if (!t || /\+|>|拖/.test(t)) return false;
    if (t === h) return true;
    if (h.length === 1 && t === `0${h}`) return true;
    return false;
  }

  /** 僅取消「不在保留名單」的場內勾選；勿整批清空（會連帶清掉投注區已有注項） */
  async function uncheckWinExcept(raceNo, keepHorses) {
    const keep = new Set([...keepHorses].map((h) => String(Number(h))));
    const r = Number(raceNo);
    for (const cb of document.querySelectorAll(`input[id^="wpleg_WIN_${r}_"]:checked`)) {
      const h = horseFromWinCheckboxId(cb.id);
      if (h && !keep.has(h)) await setCheckboxChecked(cb, false, 35);
    }
  }

  /**
   * 取消左側勾選，但**不**動已在投注區、金額正確的馬（取消勾選會把該注從投注區清掉）。
   */
  async function uncheckWinSelectionNotInSlip(raceNo, stakePerLine, keepHorse = null) {
    const keep = keepHorse != null ? String(Number(keepHorse)) : null;
    const wantStake = normalizeStakeTen(stakePerLine);
    const r = Number(raceNo);
    for (const cb of document.querySelectorAll(`input[id^="wpleg_WIN_${r}_"]:checked`)) {
      const h = horseFromWinCheckboxId(cb.id);
      if (!h) continue;
      if (keep && h === keep) continue;
      if (slipHasWinLineExact(h, wantStake)) continue;
      await setCheckboxChecked(cb, false, 35);
    }
  }

  async function uncheckPlaSelectionNotInSlip(raceNo, stakePerLine, keepHorse = null) {
    const keep = keepHorse != null ? String(Number(keepHorse)) : null;
    const wantStake = normalizeStakeTen(stakePerLine);
    const r = Number(raceNo);
    for (const cb of document.querySelectorAll(`input[id^="wpleg_PLA_${r}_"]:checked`)) {
      const h = horseFromPlaCheckboxId(cb.id);
      if (!h) continue;
      if (keep && h === keep) continue;
      if (slipHasPlaLineExact(h, wantStake)) continue;
      await setCheckboxChecked(cb, false, 35);
    }
  }

  /** 添加到投注區後，等馬會自行取消左側勾選（勿手動 uncheck，否則會清掉剛加入的注） */
  async function waitWinHorseCheckboxReleased(raceNo, horse, venueCode) {
    await pollUntil(
      () => {
        const cb = findWinCheckbox(raceNo, horse, venueCode);
        if (!cb) return true;
        return !cb.checked ? true : null;
      },
      { interval: pollMs(), maxMs: isCrossAlupPage() ? 3200 : 2600 }
    );
  }

  async function waitPlaHorseCheckboxReleased(raceNo, horse, venueCode) {
    await pollUntil(
      () => {
        const cb = findPlaCheckbox(raceNo, horse, venueCode);
        if (!cb) return true;
        return !cb.checked ? true : null;
      },
      { interval: pollMs(), maxMs: isCrossAlupPage() ? 3200 : 2600 }
    );
  }

  async function uncheckPlaExcept(raceNo, keepHorses) {
    const keep = new Set([...keepHorses].map((h) => String(Number(h))));
    const r = Number(raceNo);
    for (const cb of document.querySelectorAll(`input[id^="wpleg_PLA_${r}_"]:checked`)) {
      const h = horseFromPlaCheckboxId(cb.id);
      if (h && !keep.has(h)) await setCheckboxChecked(cb, false, 35);
    }
  }

  function isWpqPairCheckboxId(id, raceNo) {
    const r = Number(raceNo);
    return new RegExp(`^wpleg_(QIN|QPL|QQP)_${r}_\\d+_\\d+$`, "i").test(String(id || ""));
  }

  function isQinPairCheckboxId(id, raceNo) {
    return isWpqPairCheckboxId(id, raceNo);
  }

  /** 單腳選框 wpleg_{QIN|QPL}_{場次}_{馬號}；排除組合格 */
  function parseWpqLegHorseFromId(id, raceNo) {
    const r = Number(raceNo);
    if (isWpqPairCheckboxId(id, r)) return null;
    const m = new RegExp(`^wpleg_(QIN|QPL|QQP)_${r}_(\\d+)$`, "i").exec(String(id || ""));
    return m ? String(Number(m[2])) : null;
  }

  function parseQinLegHorseFromId(id, raceNo) {
    return parseWpqLegHorseFromId(id, raceNo);
  }

  /** 官網 WPQ 膽欄：wpbank1_{QIN|QPL}_{場次}_{馬號} */
  function parseWpqBankerHorseFromId(id, raceNo) {
    const r = Number(raceNo);
    const s = String(id || "");
    let m = new RegExp(`^wpbank\\d*_(QIN|QPL|QQP)_${r}_(\\d+)$`, "i").exec(s);
    if (m) return String(Number(m[2]));
    m = new RegExp(`^wpleg_QIN_B_${r}_(\\d+)$`, "i").exec(s);
    if (m) return String(Number(m[1]));
    return null;
  }

  function parseQinBankerHorseFromId(id, raceNo) {
    return parseWpqBankerHorseFromId(id, raceNo);
  }

  async function uncheckWpqExcept(raceNo, keepHorses, pool) {
    const keep = new Set([...keepHorses].map((h) => String(Number(h))));
    const r = Number(raceNo);
    const tags = wpqPoolTagsForLookup(pool);
    for (const tag of tags) {
      for (const cb of document.querySelectorAll(`input[id^="wpbank"][id*="_${tag}_${r}_"]:checked`)) {
        const h = parseWpqBankerHorseFromId(cb.id, r);
        if (h && !keep.has(h)) await setCheckboxChecked(cb, false, 35);
      }
      for (const cb of document.querySelectorAll(`input[id^="wpleg_${tag}_${r}_"]:checked`)) {
        const id = cb.id || "";
        const pairM = new RegExp(`^wpleg_${tag}_${r}_(\\d+)_(\\d+)$`, "i").exec(id);
        if (pairM) {
          const a = String(Number(pairM[1]));
          const b = String(Number(pairM[2]));
          if (!keep.has(a) || !keep.has(b)) await setCheckboxChecked(cb, false, 35);
          continue;
        }
        const h = parseWpqLegHorseFromId(id, r);
        if (h && !keep.has(h)) await setCheckboxChecked(cb, false, 35);
      }
    }
  }

  async function uncheckQinExcept(raceNo, keepHorses) {
    return uncheckWpqExcept(raceNo, keepHorses);
  }

  function winHorsesAlreadyInSlip() {
    const horses = [];
    for (const line of getBetLines()) {
      const label =
        line.querySelector(".collapse-betline")?.textContent?.replace(/\s+/g, " ").trim() ||
        line.textContent?.replace(/\s+/g, " ").trim() ||
        "";
      if (!label || /\+/.test(label)) continue;
      const m = /^(\d+)/.exec(label);
      if (m) horses.push(String(Number(m[1])));
    }
    return horses;
  }

  /** 僅當「馬號/組合 + 金額」都相同才視為重複；同馬不同額應各佔一行 */
  function slipHasWinLineExact(horse, stake) {
    const want = normalizeStakeTen(stake);
    return getBetLines().some(
      (l) => betLineMatchesHorse(l, horse) && readStakeFromLine(l) === want
    );
  }

  function isQinBetLine(line) {
    const title = (line.querySelector(".title")?.textContent || "").replace(/\s+/g, "");
    return (title.includes("連贏") || title.includes("QIN")) && !title.includes("位置Q");
  }

  function isQplBetLine(line) {
    const title = (line.querySelector(".title")?.textContent || "").replace(/\s+/g, "");
    if (title.includes("位置Q") || title.includes("位置 Q")) return true;
    if (/位置/.test(title) && /Q/i.test(title) && !title.includes("連贏")) return true;
    if (/\bQPL\b/i.test(title)) return true;
    const pool = (line.dataset?.pool || line.getAttribute("data-pool") || "").toUpperCase();
    if (pool === "QPL") return true;
    return false;
  }

  /** WPQ 腳選框場次以頁面 DOM 為準（與插件場次偶爾不同步） */
  function resolveWpqRaceNo(fallback) {
    const dom = getCurrentRaceNoFromDom();
    if (dom != null && Number.isFinite(dom) && dom > 0) return dom;
    const n = Number(fallback);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  }

  function findColumnHeaderLabel(text) {
    const want = String(text).replace(/\s/g, "");
    const nodes = document.querySelectorAll("th, td, div, span, label, p, button");
    for (const el of nodes) {
      const t = (el.textContent || "").replace(/\s/g, "");
      if (t !== want) continue;
      if (el.children.length > 4) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return el;
    }
    return null;
  }

  function columnCenterX(el) {
    const r = el.getBoundingClientRect();
    return r.left + r.width / 2;
  }

  function findCheckboxNearColumn(rowEl, headerEl) {
    if (!rowEl || !headerEl) return null;
    const hx = columnCenterX(headerEl);
    const inputs = [
      ...rowEl.querySelectorAll('input[type="checkbox"]'),
      ...rowEl.querySelectorAll(".checkbox-container"),
    ];
    let best = null;
    let bestDist = Infinity;
    for (const inp of inputs) {
      const box = inp.getBoundingClientRect();
      if (box.width <= 0 && box.height <= 0) continue;
      const cx = box.left + box.width / 2;
      const dist = Math.abs(cx - hx);
      if (dist < bestDist) {
        bestDist = dist;
        best = inp.tagName === "INPUT" ? inp : inp.querySelector('input[type="checkbox"]') || inp;
      }
    }
    return best && isInteractiveCheckbox(best) ? best : null;
  }

  function getRowCheckboxesOrdered(rowEl) {
    if (!rowEl) return [];
    const seen = new Set();
    const out = [];
    for (const inp of rowEl.querySelectorAll('input[type="checkbox"]')) {
      if (!isInteractiveCheckbox(inp) || seen.has(inp)) continue;
      seen.add(inp);
      out.push(inp);
    }
    out.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
    return out;
  }

  function rowMatchesHorse(rowEl, horse) {
    const h = String(Number(horse));
    if (!rowEl) return false;
    const cells = rowEl.querySelectorAll("td, th, div");
    for (const cell of cells) {
      const raw = (cell.textContent || "").trim();
      if (/^\d{1,2}$/.test(raw) && String(Number(raw)) === h) return true;
      const num = raw.replace(/\D/g, "");
      if (num === h && raw.length <= 4) return true;
    }
    const m = new RegExp(`(?:^|\\s)0?${h}(?:\\s|$)`).exec((rowEl.textContent || "").slice(0, 40));
    return Boolean(m);
  }

  function findRunnerRowByHorse(horse, raceNo) {
    const h = String(Number(horse));
    const r = Number(resolveWpqRaceNo(raceNo));
    const runnerTd = document.getElementById(`runnerNo_${r}_${h}`);
    if (runnerTd) {
      const row =
        runnerTd.closest("tr.rc-odds-row-m") ||
        runnerTd.closest("tr[class*='odds-row']") ||
        runnerTd.closest("tr");
      if (row?.querySelector('input[type="checkbox"], .checkbox-container')) {
        try {
          row.scrollIntoView({ block: "nearest", inline: "nearest" });
        } catch {
          /* ignore */
        }
        return row;
      }
    }
    const compact =
      document.querySelector(`#rc-odds-table-compact-${r}`) ||
      document.querySelector("table.rc-odds-table-compact");
    const roots = [
      compact,
      document.querySelector("#rcOddsTable"),
      document.querySelector("[id*='Odds']"),
      document.body,
    ].filter(Boolean);
    for (const root of roots) {
      const rows = root.querySelectorAll("tr.rc-odds-row-m, tr[class*='odds-row'], tr");
      for (const row of rows) {
        if (row.closest("thead")) continue;
        if (row.closest(".qin-odds-table, .qin-table")) continue;
        if (!row.querySelector('input[type="checkbox"], .checkbox-container')) continue;
        if (rowMatchesHorse(row, h)) return row;
      }
    }
    return null;
  }

  function isQinBankerCheckboxChecked(raceNo, horse, pool) {
    const cb = findQinBankerCheckbox(raceNo, horse, pool);
    if (cb?.checked) return true;
    const r = Number(resolveWpqRaceNo(raceNo));
    const want = String(Number(horse));
    for (const tag of wpqPoolTagsForLookup(pool)) {
      for (const el of document.querySelectorAll(`input[id^="wpbank"][id*="_${tag}_${r}_"]:checked`)) {
        const h = parseWpqBankerHorseFromId(el.id, r);
        if (h === want) return true;
      }
    }
    return false;
  }

  function isQinLegFootCheckboxChecked(raceNo, horse, pool) {
    const cb = findQinLegFootCheckbox(raceNo, horse, pool);
    return Boolean(cb?.checked);
  }

  function qinBankerCheckboxIdCandidates(raceNo, horse, pool) {
    const r = Number(resolveWpqRaceNo(raceNo));
    const h = Number(horse);
    const ph = padHorse(h);
    const ids = [];
    for (const tag of wpqPoolTagsForLookup(pool)) {
      ids.push(
        `wpbank1_${tag}_${r}_${h}`,
        `wpbank1_${tag}_${r}_${ph}`,
        `wpbank_${tag}_${r}_${h}`,
        `wpbank2_${tag}_${r}_${h}`
      );
      if (tag === "QIN") {
        ids.push(
          `wpleg_QIN_B_${r}_${h}`,
          `wpleg_QIN_Banker_${r}_${h}`,
          `wpleg_QIN_${r}_${h}_B`,
          `wpleg_QINB_${r}_${h}`,
          `wpleg_QIN_B_${r}_${ph}`,
          `wpleg_QIN_${r}_${ph}_B`
        );
      }
    }
    return ids;
  }

  function qinLegFootCheckboxIdCandidates(raceNo, horse, pool) {
    const r = Number(resolveWpqRaceNo(raceNo));
    const h = Number(horse);
    const ph = padHorse(h);
    const ids = [];
    for (const tag of wpqPoolTagsForLookup(pool)) {
      ids.push(`wpleg_${tag}_${r}_${h}`, `wpleg_${tag}_${r}_${ph}`);
      if (tag === "QIN") {
        ids.push(
          `wpleg_QIN_L_${r}_${h}`,
          `wpleg_QIN_Leg_${r}_${h}`,
          `wpleg_QIN_${r}_${h}_L`,
          `wpleg_QINL_${r}_${h}`,
          `wpleg_QIN_L_${r}_${ph}`,
          `wpleg_QIN_${r}_${ph}_L`
        );
      }
    }
    return ids;
  }

  /** 馬會 WPQ：馬號 | 膽 | 腳（表頭可能不在 table 內，用座標或「每行第1/2個框」） */
  function getWpqBankerLegHeaders() {
    const bankerHdr = findColumnHeaderLabel("膽");
    const legHdr = findColumnHeaderLabel("腳") || findColumnHeaderLabel("脚");
    if (bankerHdr && legHdr) return { bankerHdr, legHdr };
    return null;
  }

  function findQinBankerCheckbox(raceNo, horse, pool) {
    for (const id of qinBankerCheckboxIdCandidates(raceNo, horse, pool)) {
      const el = document.getElementById(id);
      if (el && isInteractiveCheckbox(el)) return el;
    }
    const headers = getWpqBankerLegHeaders();
    const row = findRunnerRowByHorse(horse, raceNo);
    if (headers && row) {
      const cb = findCheckboxNearColumn(row, headers.bankerHdr);
      if (cb) return cb;
    }
    if (row) {
      const cbs = getRowCheckboxesOrdered(row);
      const banker = cbs.find((inp) => /^wpbank/i.test(inp.id || ""));
      if (banker) return banker;
      if (cbs[0]) return cbs[0];
    }
    return null;
  }

  function findQinLegFootCheckbox(raceNo, horse, pool) {
    const row = findRunnerRowByHorse(horse, raceNo);
    if (row) {
      try {
        row.scrollIntoView({ block: "nearest", inline: "nearest" });
      } catch {
        /* ignore */
      }
    }
    for (const id of qinLegFootCheckboxIdCandidates(raceNo, horse, pool)) {
      const el = document.getElementById(id);
      if (el && !/^wpbank/i.test(el.id || "") && !isCheckboxBettingLocked(el)) return el;
    }
    const headers = getWpqBankerLegHeaders();
    if (headers && row) {
      const cb = findCheckboxNearColumn(row, headers.legHdr);
      if (cb && !/^wpbank/i.test(cb.id || "")) return cb;
    }
    if (row) {
      const cbs = getRowCheckboxesOrdered(row);
      const leg = cbs.find(
        (inp) => /^wpleg_(QIN|QPL|QQP)_/i.test(inp.id || "") && !/^wpbank/i.test(inp.id || "")
      );
      if (leg) return leg;
      const plain = cbs.find((inp) => !/^wpbank/i.test(inp.id || ""));
      if (plain) return plain;
      if (cbs.length >= 2 && !/^wpbank/i.test(cbs[1].id || "")) return cbs[1];
    }
    return findQinLegCheckboxLegacy(raceNo, horse, pool);
  }

  /** 連贏複式同步前：左側 WPQ、子類型連贏、投注方式複式、賠率表就緒 */
  async function prepareQinBoxPairSync(raceNo, opts = {}) {
    await ensureQinPoolTab({ soft: false });
    const switched = await ensureWpqBoxBetMode();
    if (switched) await sleep(isCrossAlupPage() ? 160 : 120);
    const r = Number(resolveWpqRaceNo(raceNo));
    await ensureWpqRaceTableReady(r, { maxMs: opts.maxMs ?? 2800 });
    await sleep(isCrossAlupPage() ? 40 : 28);
  }

  async function uncheckAllWpqBankers(raceNo, pool) {
    const r = Number(resolveWpqRaceNo(raceNo));
    for (const tag of wpqPoolTagsForLookup(pool)) {
      for (const cb of document.querySelectorAll(`input[id^="wpbank"][id*="_${tag}_${r}_"]`)) {
        if (cb.checked) await setCheckboxChecked(cb, false, 16);
      }
    }
  }

  /** 複式：兩匹均在「腳」欄勾選，且「膽」欄全清 */
  async function waitWpqBoxFootPairSelected(raceNo, h1, h2, pool = "QIN", opts = {}) {
    const r = Number(resolveWpqRaceNo(raceNo));
    const maxMs = opts.maxMs ?? 4000;
    const want = new Set([String(Number(h1)), String(Number(h2))]);
    const tags = wpqPoolTagsForLookup(pool);
    const ok = await pollUntil(
      () => {
        if (isQbPairCellSelected(pool, h1, h2)) return true;
        for (const tag of tags) {
          for (const el of document.querySelectorAll(`input[id^="wpbank"][id*="_${tag}_${r}_"]:checked`)) {
            return null;
          }
        }
        const checked = new Set();
        for (const tag of tags) {
          for (const el of document.querySelectorAll(`input[id^="wpleg_${tag}_${r}_"]:checked`)) {
            if (isWpqPairCheckboxId(el.id, r)) continue;
            const leg = parseWpqLegHorseFromId(el.id, r);
            if (leg && want.has(leg)) checked.add(leg);
          }
        }
        return checked.size >= 2 && [...want].every((h) => checked.has(h)) ? true : null;
      },
      { interval: pollMs(), maxMs }
    );
    return Boolean(ok);
  }

  /** 複式勾選前清表：批量同步第 2 項起僅清非本組合腳位，避免撤銷已加入投注區的注單 */
  async function clearWpqPairSelection(raceNo, h1, h2, pool, opts = {}) {
    if (opts.skipInitialClear) {
      await uncheckWpqExcept(resolveWpqRaceNo(raceNo), [h1, h2], pool);
      await sleep(isCrossAlupPage() ? 40 : 24);
      return;
    }
    await uncheckQinTableForRace(raceNo, pool, opts);
    await uncheckAllWpqBankers(raceNo, pool);
    await sleep(isCrossAlupPage() ? 55 : 36);
  }

  async function selectWpqBoxPairOnce(raceNo, h1, h2, pool, opts = {}) {
    const r = Number(resolveWpqRaceNo(raceNo));
    await clearWpqPairSelection(raceNo, h1, h2, pool, opts);

    if (!opts.skipQbCell && (await clickQbPairCell(pool, h1, h2))) {
      const qbOk = await waitWpqBoxFootPairSelected(r, h1, h2, pool, {
        maxMs: opts.maxMs ?? 3200,
      });
      if (qbOk) return { ok: true };
    }

    const cb1 = findQinLegFootCheckbox(r, h1, pool);
    const cb2 = findQinLegFootCheckbox(r, h2, pool);
    if (!cb1 || !cb2 || isCheckboxBettingLocked(cb1) || isCheckboxBettingLocked(cb2)) {
      return { ok: false, code: `MISSING_${pool}_CHECKBOX:${h1}-${h2}` };
    }

    await setCheckboxChecked(cb1, true, 18);
    await sleep(24);
    await setCheckboxChecked(cb2, true, 18);

    const ok = await waitWpqBoxFootPairSelected(r, h1, h2, pool, { maxMs: opts.maxMs ?? 4200 });
    if (!ok) {
      return { ok: false, code: `HKJC_INSUFFICIENT_SELECTION:${pool === "QPL" ? "qpl" : "qin"}` };
    }
    return { ok: true };
  }

  async function selectWpqBoxPair(raceNo, h1, h2, pool, opts = {}) {
    let sel = await selectWpqBoxPairOnce(raceNo, h1, h2, pool, opts);
    if (sel.ok) return sel;
    await prepareQinBoxPairSync(raceNo, { maxMs: 2400 });
    sel = await selectWpqBoxPairOnce(raceNo, h1, h2, pool, {
      ...opts,
      maxMs: Math.max(opts.maxMs ?? 4200, 4800),
    });
    return sel;
  }

  function findQinLegCheckboxLegacy(raceNo, horse, pool) {
    const r = Number(resolveWpqRaceNo(raceNo));
    const hit = findCheckboxByIds(qinHorseCheckboxIds(r, horse, pool));
    if (hit && !isWpqPairCheckboxId(hit.id, r) && isCheckboxVisible(hit)) return hit;
    const h = Number(horse);
    for (const tag of wpqPoolTagsForLookup(pool)) {
      for (const cb of document.querySelectorAll(`input[id^="wpleg_${tag}_${r}_"]`)) {
        const id = cb.id || "";
        if (isWpqPairCheckboxId(id, r)) continue;
        const leg = parseWpqLegHorseFromId(id, r);
        if (leg != null && Number(leg) === h && isCheckboxVisible(cb)) return cb;
      }
    }
    return null;
  }

  function findQinLegCheckbox(raceNo, horse, pool) {
    return findQinLegFootCheckbox(raceNo, horse, pool);
  }

  /** P3：僅清本場 WPQ 勾選，避免掃描整頁 #rcOddsTable */
  async function uncheckQinTableForRace(raceNo, pool = "QIN", opts = {}) {
    const r = Number(resolveWpqRaceNo(raceNo));
    const delay = navCbDelay(opts, 14);
    const tags = wpqPoolTagsForLookup(pool);
    for (const tag of tags) {
      for (const cb of document.querySelectorAll(
        `input[id^="wpbank"][id*="_${tag}_${r}_"]:checked, input[id^="wpleg_${tag}_${r}_"]:checked`
      )) {
        await setCheckboxChecked(cb, false, delay);
      }
    }
  }

  async function uncheckAllQinTableSelections(raceNo, opts = {}) {
    await uncheckQinTableForRace(raceNo, "QIN", opts);
    await uncheckQinTableForRace(raceNo, "QPL", opts);
  }

  function isQinBankerBetLine(line) {
    if (!isQinBetLine(line)) return false;
    if (line.querySelector(".banker")) return true;
    const content = line.querySelector(".content");
    return Boolean(content?.querySelector(".banker") || /拖/.test(content?.textContent || ""));
  }

  function isQinBoxBetLine(line) {
    if (!isQinBetLine(line) || isQinBankerBetLine(line)) return false;
    const content = line.querySelector(".content");
    if (!content) return false;
    const plusBlocks = [...content.querySelectorAll("div")].filter((d) =>
      /\+/.test(d.textContent || "")
    );
    return plusBlocks.length >= 2;
  }

  function betLineLabelText(line) {
    return (
      line.querySelector(".collapse-betline")?.textContent?.replace(/\s+/g, " ").trim() ||
      line.textContent?.replace(/\s+/g, " ").trim() ||
      ""
    );
  }

  /** 官網膽拖行：如 4&gt;5 + 6 */
  function betLineMatchesBankerDrag(line, banker, legs) {
    const label = betLineLabelText(line).replace(/\s/g, "");
    const b = String(Number(banker));
    if (!new RegExp(`^${b}>`).test(label)) return false;
    for (const leg of legs) {
      if (!label.includes(String(Number(leg)))) return false;
    }
    return true;
  }

  function isQplBankerBetLine(line) {
    if (!isQplBetLine(line)) return false;
    const label = betLineLabelText(line);
    if (/>/.test(label)) return true;
    if (line.querySelector(".banker")) return true;
    return /拖/.test(label);
  }

  function isQplBoxBetLine(line) {
    if (!isQplBetLine(line) || isQplBankerBetLine(line)) return false;
    const label = betLineLabelText(line);
    if (/>/.test(label)) return false;
    const parts = label.split("+").map((s) => s.trim()).filter(Boolean);
    return parts.length >= 2 && !/>/.test(label);
  }

  /** 膽拖行僅一個「每注」框；各組合同額時用該額作每注 */
  function resolveBankerBatchStake(items) {
    const stakes = (items || [])
      .map((it) => normalizeStakeTen(it?.stakePerLine))
      .filter((s) => s > 0);
    if (!stakes.length) return 10;
    if (!bankerBatchStakesEqual(items)) return null;
    return stakes[0];
  }

  function bankerBatchStakesEqual(items) {
    const stakes = (items || [])
      .map((it) => normalizeStakeTen(it?.stakePerLine))
      .filter((s) => s > 0);
    if (stakes.length <= 1) return true;
    return stakes.every((s) => s === stakes[0]);
  }

  /** 連贏複式「1 + 4」或膽腳單對「1>4」 */
  function betLineMatchesQinPair(line, h1, h2) {
    if (betLineMatchesPair(line, h1, h2)) return true;
    const label = betLineLabelText(line).replace(/\s/g, "");
    const a = Number(h1);
    const b = Number(h2);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
    return (
      new RegExp(`^${a}>${b}$`).test(label) ||
      new RegExp(`^${b}>${a}$`).test(label) ||
      betLineMatchesBankerDrag(line, a, [b]) ||
      betLineMatchesBankerDrag(line, b, [a])
    );
  }

  function qinPairLineMatcher(h1, h2) {
    return (l) => {
      if (!betLineMatchesQinPair(l, h1, h2)) return false;
      if (isQinBetLine(l)) return true;
      if (isQplBetLine(l)) return false;
      return wpqSubTypeIs("QIN");
    };
  }

  function qplPairLineMatcher(h1, h2) {
    return (l) => {
      if (!betLineMatchesQinPair(l, h1, h2)) return false;
      if (isQplBetLine(l)) return true;
      if (isQinBetLine(l)) return false;
      return wpqSubTypeIs("QPL");
    };
  }

  function bankerLegFromPairItem(it, payloadBankerNum) {
    const bankerRaw = it?._bankerSync ?? payloadBankerNum;
    const legRaw = it?._legSync;
    const banker = Number(bankerRaw);
    if (!Number.isFinite(banker) || banker <= 0) return null;
    if (legRaw != null && Number.isFinite(Number(legRaw))) {
      return { banker, leg: Number(legRaw) };
    }
    const pair = parseQinCombo(it?.combo);
    if (!pair || !pair.some((h) => Number(h) === banker)) return null;
    const leg = pair.find((h) => Number(h) !== banker);
    if (leg == null) return null;
    return { banker, leg: Number(leg) };
  }

  async function waitWpqBankerSingleLegSelected(raceNo, banker, leg, pool = "QIN", opts = {}) {
    const maxMs = opts.maxMs ?? (opts.quick ? 2000 : 3200);
    const ok = await pollUntil(
      () => {
        if (!isQinBankerCheckboxChecked(raceNo, banker, pool)) return null;
        if (!isQinLegFootCheckboxChecked(raceNo, leg, pool)) return null;
        return true;
      },
      { interval: pollMs(), maxMs }
    );
    return Boolean(ok);
  }

  /** Dutch 膽拖各組合金額不同時，官網一行膽拖無法分注 → 改兩行複式「1+4」「1+5」 */
  function expandBankerBatchesForSync(batches) {
    const kept = [];
    const extraSingles = [];
    for (const batch of batches) {
      if (bankerBatchStakesEqual(batch.items)) {
        kept.push(batch);
        continue;
      }
      for (const it of batch.items) {
        extraSingles.push({ ...it, _dutchBoxSync: true });
      }
    }
    return { batches: kept, extraSingles };
  }

  function slipHasQplBankerDragExact(banker, legs, stake) {
    const want = normalizeStakeTen(stake);
    return getBetLines().some(
      (l) =>
        isQplBetLine(l) &&
        isQplBankerBetLine(l) &&
        betLineMatchesBankerDrag(l, banker, legs) &&
        readStakeFromLine(l) === want
    );
  }

  function findQinPairCheckbox(raceNo, h1, h2, pool) {
    return findCheckboxByIds(qinPairCheckboxIds(raceNo, h1, h2, pool));
  }

  function isQbPairCellSelected(pool, h1, h2) {
    const cell = findQbPairCell(pool, h1, h2);
    if (!cell) return false;
    const cls = cell.className || "";
    if (/selected|active|on|checked|pick/i.test(cls)) return true;
    if (cell.getAttribute("aria-selected") === "true") return true;
    return false;
  }

  async function waitWpqPairSelected(raceNo, h1, h2, pool = "QPL", opts = {}) {
    const r = Number(resolveWpqRaceNo(raceNo));
    const maxMs = opts.maxMs ?? (opts.quick ? 1200 : 1800);
    const want = new Set([String(Number(h1)), String(Number(h2))]);
    const tags = wpqPoolTagsForLookup(pool);
    const ok = await pollUntil(
      () => {
        if (isQbPairCellSelected(pool, h1, h2)) return true;
        const pairCb = findQinPairCheckbox(r, h1, h2, pool);
        if (pairCb?.checked) return true;
        let n = 0;
        for (const tag of tags) {
          for (const el of document.querySelectorAll(`input[id^="wpleg_${tag}_${r}_"]:checked`)) {
            const leg = parseWpqLegHorseFromId(el.id, r);
            if (leg && want.has(leg)) n += 1;
          }
        }
        return n >= 2 ? true : null;
      },
      { interval: pollMs(), maxMs }
    );
    return Boolean(ok);
  }

  async function waitWpqBankerLegsSelected(raceNo, banker, legs, opts = {}) {
    const r = Number(resolveWpqRaceNo(raceNo));
    const pool = opts.pool || resolveWpqCheckboxPool();
    const maxMs = opts.maxMs ?? (opts.quick ? 1600 : 2800);
    const ok = await pollUntil(
      () => {
        if (!isQinBankerCheckboxChecked(r, banker, pool)) return null;
        for (const leg of legs) {
          if (!isQinLegFootCheckboxChecked(r, leg, pool)) return null;
        }
        return true;
      },
      { interval: pollMs(), maxMs }
    );
    return Boolean(ok);
  }

  /** 馬膽拖：多組合共用同一膽（如 4 拖 5、6 → 4-5、4-6） */
  function partitionQinBankerBatches(items) {
    const batches = [];
    const used = new Set();
    const list = [...items];
    while (list.length >= 2) {
      const batch = findBankerBatchInList(list);
      if (!batch) break;
      batches.push(batch);
      for (const it of batch.items) {
        used.add(it);
        const i = list.indexOf(it);
        if (i >= 0) list.splice(i, 1);
      }
    }
    const singles = items.filter((it) => !used.has(it));
    return { singles, batches };
  }

  function findBankerBatchInList(items) {
    const pairs = items.map((it) => ({ it, pair: parseQinCombo(it.combo) })).filter((x) => x.pair);
    if (pairs.length < 2) return null;
    for (const { pair } of pairs) {
      for (const bankerCand of pair) {
        const sub = pairs.filter((p) => p.pair.includes(bankerCand));
        if (sub.length >= 2) {
          const legs = [...new Set(sub.flatMap((p) => p.pair.filter((h) => h !== bankerCand)))];
          if (legs.length >= 1) {
            return { banker: bankerCand, legs, items: sub.map((p) => p.it) };
          }
        }
      }
    }
    return null;
  }

  function qplLineMatcher(h1, h2) {
    return qplPairLineMatcher(h1, h2);
  }

  function qinLineMatcher(h1, h2) {
    return qinPairLineMatcher(h1, h2);
  }

  function slipHasQinLineExact(h1, h2, stake) {
    const want = normalizeStakeTen(stake);
    return getBetLines().some(
      (l) => isQinBetLine(l) && betLineMatchesQinPair(l, h1, h2) && readStakeFromLine(l) === want
    );
  }

  function slipHasQplLineExact(h1, h2, stake) {
    const want = normalizeStakeTen(stake);
    return getBetLines().some(
      (l) => isQplBetLine(l) && betLineMatchesQinPair(l, h1, h2) && readStakeFromLine(l) === want
    );
  }

  function isPlaBetLine(line) {
    const title = (line.querySelector(".title")?.textContent || "").replace(/\s+/g, "");
    return title.includes("位置") && !title.includes("位置Q") && !title.includes("連贏");
  }

  function slipHasPlaLineExact(horse, stake) {
    const want = normalizeStakeTen(stake);
    return getBetLines().some(
      (l) => isPlaBetLine(l) && betLineMatchesHorse(l, horse) && readStakeFromLine(l) === want
    );
  }

  function partitionPlaItemsForSync(items, opts = {}) {
    if (opts.alwaysAdd) {
      return { toAdd: [...items], toUpdate: [], skipped: 0 };
    }
    const toAdd = [];
    let skipped = 0;
    for (const it of items) {
      const horse = String(it.combo ?? "").trim();
      if (slipHasPlaLineExact(horse, it.stakePerLine)) skipped += 1;
      else toAdd.push(it);
    }
    return { toAdd, toUpdate: [], skipped };
  }

  function partitionWinItemsForSync(items, opts = {}) {
    if (opts.alwaysAdd) {
      return { toAdd: [...items], toUpdate: [], skipped: 0 };
    }
    const toAdd = [];
    let skipped = 0;
    for (const it of items) {
      const horse = String(it.combo ?? "").trim();
      if (slipHasWinLineExact(horse, it.stakePerLine)) skipped += 1;
      else toAdd.push(it);
    }
    return { toAdd, toUpdate: [], skipped };
  }

  function partitionQinItemsForSync(items, opts = {}) {
    if (opts.alwaysAdd) {
      return { toAdd: [...items], toUpdate: [], skipped: 0 };
    }
    const toAdd = [];
    let skipped = 0;
    for (const it of items) {
      const pair = parseQinCombo(it.combo);
      if (!pair) continue;
      const [h1, h2] = pair;
      if (slipHasQinLineExact(h1, h2, it.stakePerLine)) skipped += 1;
      else toAdd.push(it);
    }
    return { toAdd, toUpdate: [], skipped };
  }

  function partitionQplItemsForSync(items, opts = {}) {
    if (opts.alwaysAdd) {
      return { toAdd: [...items], toUpdate: [], skipped: 0 };
    }
    const toAdd = [];
    let skipped = 0;
    const { singles, batches } = partitionQinBankerBatches(items);
    for (const batch of batches) {
      if (!bankerBatchStakesEqual(batch.items)) {
        for (const it of batch.items) {
          const pair = parseQinCombo(it.combo);
          if (!pair) continue;
          const [h1, h2] = pair;
          if (slipHasQplLineExact(h1, h2, it.stakePerLine)) skipped += 1;
          else toAdd.push(it);
        }
        continue;
      }
      const stake = resolveBankerBatchStake(batch.items);
      if (stake != null && slipHasQplBankerDragExact(batch.banker, batch.legs, stake)) {
        skipped += batch.items.length;
      } else {
        for (const it of batch.items) toAdd.push(it);
      }
    }
    for (const it of singles) {
      const pair = parseQinCombo(it.combo);
      if (!pair) continue;
      const [h1, h2] = pair;
      if (slipHasQplLineExact(h1, h2, it.stakePerLine)) skipped += 1;
      else toAdd.push(it);
    }
    return { toAdd, toUpdate: [], skipped };
  }

  /** 馬會在選馬不足時彈「第 N 場所選馬匹數目不足」；加入投注區前確認勾選已生效 */
  async function waitSelectionReady(mode, raceNo, opts = {}) {
    const r = Number(raceNo);
    const { pairCb, h1, h2 } = opts;
    const ok = await pollUntil(
      () => {
        if (mode === "win") {
          return document.querySelectorAll(`input[id^="wpleg_WIN_${r}_"]:checked`).length >= 1 || null;
        }
        if (mode === "pla") {
          return document.querySelectorAll(`input[id^="wpleg_PLA_${r}_"]:checked`).length >= 1 || null;
        }
        if (pairCb?.checked) return true;
        const checked = [];
        for (const tag of ["QIN", "QPL", "QQP"]) {
          checked.push(...document.querySelectorAll(`input[id^="wpleg_${tag}_${r}_"]:checked`));
        }
        if (checked.length >= 2) return true;
        if (h1 != null && h2 != null) {
          const want = new Set([String(h1), String(h2), padHorse(h1), padHorse(h2)]);
          const ids = new Set(
            checked.map((el) => {
              const leg = parseWpqLegHorseFromId(el.id, r);
              return leg || "";
            })
          );
          if ([...want].filter((x) => ids.has(String(Number(x))) || ids.has(x)).length >= 2) return true;
        }
        return null;
      },
      { interval: pollMs(), maxMs: 1600 }
    );
    return Boolean(ok);
  }

  function findAddToSlipButton() {
    return (
      document.querySelector("button.AddToSlip") ||
      document.querySelector(".AddToSlip") ||
      document.querySelector(".addSlip .AddToSlip") ||
      [...document.querySelectorAll("button, a, [role='button'], div.AddToSlip")].find((el) =>
        /加入投注區|添加到投注區|加入|添加|add/i.test(el.textContent || "")
      )
    );
  }

  /** 官網「投注計算機」每注金額輸入框（.unitBetInput） */
  function findUnitBetInput() {
    const root = document.querySelector(".investment-cal");
    if (root) {
      for (const el of root.querySelectorAll("input.unitBetInput, input.OfInnerInput")) {
        if (el.disabled || el.classList.contains("betTotalInput")) continue;
        if (el.closest(".investment-cal-bettotal")) continue;
        if (isUiVisible(el)) return el;
      }
    }
    return (
      document.querySelector(".investment-cal-unitbet-input input.OfInnerInput:not([disabled])") ||
      document.querySelector("input.unitBetInput:not([disabled])")
    );
  }

  function readCalculatorBetCount() {
    const root = document.querySelector(".investment-cal");
    if (!root) return null;
    const text = (root.textContent || "").replace(/\s+/g, " ");
    const m = /注[数數]\s*[:：]?\s*(\d+)/i.exec(text);
    if (m) return Math.max(0, Number(m[1]) || 0);
    return null;
  }

  function readCalculatorBetTotal() {
    const root = document.querySelector(".investment-cal");
    if (!root) return null;
    const input =
      root.querySelector(".investment-cal-bettotal input.OfInnerInput") ||
      root.querySelector("input.betTotalInput");
    if (!input) return null;
    const raw = String(input.value ?? "").replace(/[^\d.]/g, "");
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? normalizeStakeTen(n) : null;
  }

  /** 馬會「添加」按鈕讀取的是計算機「投注金額」總額，非僅每注 input 顯示值 */
  async function waitCalculatorBetTotalCommitted(stake, maxMs) {
    const count = readCalculatorBetCount() || 1;
    const wantTotal = expectedLineCommittedAmount(stake, count);
    const ok = await pollUntil(
      () => {
        const unit = findUnitBetInput();
        const unitOk = unit && isUnitBetInputCommitted(unit, stake);
        const total = readCalculatorBetTotal();
        return unitOk && total === wantTotal ? true : null;
      },
      { interval: stakeFillPollMs(), maxMs: maxMs ?? (isCrossAlupPage() ? 4800 : 3800) }
    );
    return Boolean(ok);
  }

  function findCalculatorBlurTarget(calcInput) {
    const root = document.querySelector(".investment-cal");
    return (
      root?.querySelector(".investment-cal-lbl") ||
      root?.querySelector(".investment-cal-betno") ||
      root?.querySelector(".investment-cal-bettotal") ||
      root
    );
  }

  /** 人手：点 .unitBetInput → 点框外（或「添加」），让 React 接受每注金额 */
  async function commitCalculatorStakeByFocusBlur(calcInput) {
    if (!calcInput) return false;
    const outside = findCalculatorBlurTarget(calcInput);
    let inputId = calcInput.id;
    let outsideId = outside?.id;
    let assignedIn = false;
    let assignedOut = false;
    if (!inputId) {
      inputId = `raceplugin-calc-in-${Date.now().toString(36)}`;
      calcInput.id = inputId;
      assignedIn = true;
    }
    if (outside && !outsideId) {
      outsideId = `raceplugin-calc-out-${Date.now().toString(36)}`;
      outside.id = outsideId;
      assignedOut = true;
    }
    try {
      await runMainWorldOp({
        type: "focus-blur",
        inputId,
        outsideId: outsideId || null,
      });
    } finally {
      if (assignedIn) {
        setTimeout(() => {
          try {
            calcInput.removeAttribute("id");
          } catch {
            /* ignore */
          }
        }, 400);
      }
      if (assignedOut && outside) {
        setTimeout(() => {
          try {
            outside.removeAttribute("id");
          } catch {
            /* ignore */
          }
        }, 400);
      }
    }
    await sleep(isCrossAlupPage() ? 120 : 85);
    return true;
  }

  /**
   * 人手第⑤步：在计算器 input 已填金额后，一次 native click 点「添加」
   * （点添加会先 blur 计算器，等同人手）。
   */
  async function clickCalcInputThenAddToSlip(calcInput) {
    const addBtn = findAddToSlipButton();
    if (!addBtn) throw new Error("MISSING_ADD_TO_SLIP");
    let inputId = calcInput.id;
    let addId = addBtn.id;
    let assignedIn = false;
    let assignedAdd = false;
    if (!inputId) {
      inputId = `raceplugin-calc-in-${Date.now().toString(36)}`;
      calcInput.id = inputId;
      assignedIn = true;
    }
    if (!addId) {
      addId = `raceplugin-add-${Date.now().toString(36)}`;
      addBtn.id = addId;
      assignedAdd = true;
    }
    try {
      await runMainWorldOp({ type: "calc-add-sequence", inputId, addId });
    } finally {
      if (assignedIn) {
        setTimeout(() => {
          try {
            calcInput.removeAttribute("id");
          } catch {
            /* ignore */
          }
        }, 400);
      }
      if (assignedAdd) {
        setTimeout(() => {
          try {
            addBtn.removeAttribute("id");
          } catch {
            /* ignore */
          }
        }, 400);
      }
    }
    await sleep(isCrossAlupPage() ? 140 : 100);
  }

  async function commitCalculatorStakeToReact(input, stake) {
    await commitCalculatorStakeByFocusBlur(input);
    await sleep(isCrossAlupPage() ? 80 : 55);
    return waitCalculatorBetTotalCommitted(stake);
  }

  async function ensureInvestmentCalculatorExpanded() {
    const root = document.querySelector(".investment-cal");
    if (!root) return;
    const input = findUnitBetInput();
    if (input && isUiVisible(input)) return;
    const toggle =
      root.querySelector(".investment-cal-arow") ||
      root.querySelector(".investment-cal-arrow") ||
      root.querySelector('[class*="investment-cal"] [class*="arrow"]');
    if (toggle) {
      firePointerClick(toggle);
      await sleep(isCrossAlupPage() ? 120 : 90);
    }
  }

  /** 勾選生效後，計算機「注數」應 ≥ minCount（非「-」） */
  async function waitInvestmentCalculatorReady(minCount = 1, maxMs) {
    await ensureInvestmentCalculatorExpanded();
    const ok = await pollUntil(
      () => {
        const n = readCalculatorBetCount();
        return n != null && n >= minCount ? true : null;
      },
      { interval: stakeFillPollMs(), maxMs: maxMs ?? (isCrossAlupPage() ? 3200 : 2600) }
    );
    return Boolean(ok);
  }

  function isUnitBetInputCommitted(input, stake) {
    const want = String(normalizeStakeTen(stake));
    const got = String(input?.value ?? "").replace(/[^\d]/g, "");
    return got === want;
  }

  /** 人手步驟 ④：在投注計算機填每注金額 */
  async function fillInvestmentCalculatorStake(stake) {
    const want = normalizeStakeTen(stake);
    const stakeStr = String(want);
    await ensureInvestmentCalculatorExpanded();
    const input = await pollUntil(() => {
      const el = findUnitBetInput();
      return el && isUiVisible(el) && !el.disabled ? el : null;
    }, {
      interval: stakeFillPollMs(),
      maxMs: 3200,
    });
    if (!input) throw new Error("NO_UNIT_BET_INPUT");
    try {
      input.scrollIntoView({ block: "nearest", inline: "nearest" });
      input.focus();
      input.click();
    } catch {
      /* ignore */
    }
    await sleep(stakePreFillMs());
    await typeInputValueInMainWorld(input, stakeStr);
    await sleep(stakePostTypeMs());
    await commitCalculatorStakeByFocusBlur(input);
    if (
      isUnitBetInputCommitted(input, want) &&
      (await waitCalculatorBetTotalCommitted(want, isCrossAlupPage() ? 2200 : 1600))
    ) {
      return input;
    }
    await setInputValueInMainWorld(input, stakeStr);
    await sleep(stakePostTypeMs());
    await commitCalculatorStakeByFocusBlur(input);
    if (
      isUnitBetInputCommitted(input, want) &&
      (await waitCalculatorBetTotalCommitted(want, isCrossAlupPage() ? 2200 : 1600))
    ) {
      return input;
    }
    if (isUnitBetInputCommitted(input, want)) {
      if (await waitCalculatorBetTotalCommitted(want, isCrossAlupPage() ? 2200 : 1600)) {
        return input;
      }
    }
    await typeStakeIntoInput(input, stakeStr, { stakeFill: true });
    const ok = await pollUntil(() => (isUnitBetInputCommitted(input, want) ? true : null), {
      interval: stakeFillPollMs(),
      maxMs: 3200,
    });
    if (!ok) throw new Error("HKJC_CALC_STAKE_FILL_FAILED");
    if (!(await commitCalculatorStakeToReact(input, want))) {
      throw new Error("HKJC_CALC_TOTAL_NOT_READY");
    }
    return input;
  }

  async function rollbackSlipAddsSince(slipBefore, matcher) {
    for (const line of [...getBetLines().slice(slipBefore)].filter(matcher)) {
      await clickRemoveBetLine(line);
    }
  }

  /**
   * 人手 ④⑤：填投注計算機 → 添加到投注區 → 校驗；若「添加」仍帶入預設 $10 則在注單行補填（程式化添加限制）。
   * 勾選後若已有自動加行，先移除再填計算機，避免 $10 殘留或匹配錯行。
   */
  async function commitSelectionViaCalculator(stake, slipBefore, matcher) {
    const before = Number.isFinite(slipBefore) ? slipBefore : getBetLines().length;
    const want = normalizeStakeTen(stake);
    await discardPrematureSlipLines(before, matcher, stake);
    syncDebug(`等待计算器注数 ≥ 1（当前 ${readCalculatorBetCount() ?? "-"}）`);
    if (!(await waitInvestmentCalculatorReady(1))) {
      throw new Error("HKJC_CALC_NOT_READY");
    }
    syncDebug(`填计算机 .unitBetInput → ${want}`);
    const calcInput = await fillInvestmentCalculatorStake(stake);
    if (!isUnitBetInputCommitted(calcInput, stake)) {
      throw new Error("HKJC_CALC_STAKE_FILL_FAILED");
    }
    const betCount = readCalculatorBetCount() || 1;
    const betTotal = readCalculatorBetTotal();
    syncDebug(`计算器已确认 每注 $${want} × ${betCount} = 总额 $${betTotal ?? "?"}`);
    if (betTotal !== expectedLineCommittedAmount(stake, betCount)) {
      throw new Error("HKJC_CALC_TOTAL_NOT_READY");
    }
    syncDebug("点击添加", ".AddToSlip（计算器 focus → 添加，等同人手 blur）");
    await clickCalcInputThenAddToSlip(calcInput);
    let line = await pollUntil(() => findAddedBetLine(matcher, before, { preferStake: stake }), {
      interval: pollMs(),
      maxMs: isCrossAlupPage() ? 3200 : 2600,
    });
    if (!line) line = findNewestBetLine(matcher);
    if (!line) throw new Error("NO_BET_LINE_MATCH");
    if (!isLineStakeCommitted(line, stake)) {
      const lineStake = readStakeFromLine(line);
      if (lineStake === 10 || lineStake === normalizeStakeTen(10)) {
        syncDebug(`添加后仍为默认 $10，注单行补填 → $${want}（计算器 React 未入账时的兜底）`);
        await fillStakeOnLine(line, stake);
      }
    } else {
      syncDebug(`添加后注单行 ✓ $${want}（计算器→添加，无需补填）`);
    }
    await commitLineStakeByFocusBlur(line);
    try {
      await assertStakeCommitted(line, stake);
      syncDebug(`校验注单行 ✓ $${want}（投注区共 ${getBetLines().length} 行）`);
    } catch (e) {
      syncDebug(
        "金额校验失败",
        `want=$${want} lineInput=$${readStakeFromLine(line) ?? "?"} committed=$${e?.gotCommitted ?? readLineBetMeta(line).committedAmount ?? "?"} inputs=${debugLineStakeSnapshot(line)}`
      );
      syncDebugErr("回滚本注", e);
      await rollbackSlipAddsSince(before, matcher);
      throw e;
    }
    return line;
  }

  /** @deprecated 使用 commitSelectionViaCalculator */
  async function addWinPlaSingleViaCalculator(matcher, stake, slipBefore) {
    return commitSelectionViaCalculator(stake, slipBefore, matcher);
  }

  function setNativeInputValue(input, value) {
    const proto = window.HTMLInputElement?.prototype;
    const setter = proto && Object.getOwnPropertyDescriptor(proto, "value")?.set;
    const tracker = input?._valueTracker;
    if (tracker) {
      try {
        tracker.setValue(String(input.value ?? ""));
      } catch {
        /* ignore */
      }
    }
    if (setter) setter.call(input, value);
    else input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  async function withTempElementId(el, fn) {
    let tempId = el.id;
    let assignedId = false;
    if (!tempId) {
      tempId = `raceplugin-tmp-${Date.now().toString(36)}`;
      el.id = tempId;
      assignedId = true;
    }
    try {
      return await fn(tempId);
    } finally {
      if (assignedId) {
        setTimeout(() => {
          try {
            el.removeAttribute("id");
          } catch {
            /* ignore */
          }
        }, 400);
      }
    }
  }

  async function runMainWorldOp(op) {
    try {
      const resp = await chrome.runtime.sendMessage({ type: "HKJC_MAIN_WORLD_OP", op });
      if (resp?.ok) return resp;
    } catch {
      /* fallback below */
    }
    dispatchMainWorldOp(op);
    await sleep(isCrossAlupPage() ? 60 : 40);
    return { ok: true };
  }

  function dispatchMainWorldOp(op) {
    document.documentElement.setAttribute("data-raceplugin-main-op", JSON.stringify(op));
    document.dispatchEvent(
      new CustomEvent(
        op.type === "set-input" || op.type === "type-input" || op.type === "insert-text" || op.type === "commit-input"
          ? "raceplugin-main-set-input"
          : "raceplugin-main-click",
        { detail: op, bubbles: true, composed: true }
      )
    );
  }

  /** 在页面 MAIN world 写入 React 受控 input */
  async function setInputValueInMainWorld(input, value) {
    if (!input) return false;
    await withTempElementId(input, async (tempId) => {
      await runMainWorldOp({ type: "set-input", tempId, value: String(value) });
    });
    return true;
  }

  /** 在 MAIN world 逐字输入（模拟人手，让 React 内部状态与 DOM 一致） */
  async function typeInputValueInMainWorld(input, value) {
    if (!input) return false;
    await withTempElementId(input, async (tempId) => {
      await runMainWorldOp({ type: "type-input", tempId, value: String(value) });
    });
    return true;
  }

  /** 在 MAIN world 用 insertText（部分 React 表单比 setValue 更易入账） */
  async function insertTextValueInMainWorld(input, value) {
    if (!input) return false;
    await withTempElementId(input, async (tempId) => {
      await runMainWorldOp({ type: "insert-text", tempId, value: String(value) });
    });
    return true;
  }

  /** 在 MAIN world 触发完整 pointer/click */
  async function clickElementInMainWorld(el) {
    if (!el) return false;
    await withTempElementId(el, async (tempId) => {
      await runMainWorldOp({ type: "click", tempId });
    });
    return true;
  }

  /** Enter + blur（备用；马会 cross_alup 以「点 input → 点框外」入账更可靠） */
  async function commitLineStakeInMainWorld(input) {
    if (!input) return false;
    await withTempElementId(input, async (tempId) => {
      await runMainWorldOp({ type: "commit-input", tempId });
    });
    return true;
  }

  /** 注单行金额框外的安全点击目标（避开移除按钮与其它 input） */
  function findStakeBlurTarget(line, input) {
    const candidates = [
      line?.querySelector(".collapse-betline"),
      line?.querySelector(".guoguan"),
      line?.querySelector(".collapse-content-l"),
      line?.querySelector(".bet-type-col"),
      line?.querySelector(".title > div:first-child"),
    ].filter(Boolean);
    for (const el of candidates) {
      if (input && el.contains(input)) continue;
      if (el.querySelector?.("input.OfInnerInput, input[type='text']") === input) continue;
      return el;
    }
    const panel = document.querySelector("#betslip-panel");
    return panel?.querySelector('[class*="header"]') || panel;
  }

  /**
   * 模拟人手：原生 click 点金额框 → 点框外（isTrusted），写入「總投注金額」。
   */
  async function commitLineStakeByFocusBlur(line) {
    await ensureBetLineExpanded(line);
    const input = stakeInputFromLine(line);
    if (!input || input.disabled) return false;
    const val = String(input.value ?? "").replace(/[^\d]/g, "");
    if (!val) return false;

    const outside = findStakeBlurTarget(line, input);
    let inputId = input.id;
    let outsideId = outside?.id;
    let assignedIn = false;
    let assignedOut = false;
    if (!inputId) {
      inputId = `raceplugin-in-${Date.now().toString(36)}`;
      input.id = inputId;
      assignedIn = true;
    }
    if (outside && !outsideId) {
      outsideId = `raceplugin-out-${Date.now().toString(36)}`;
      outside.id = outsideId;
      assignedOut = true;
    }

    const grandBefore = readBetSlipGrandTotal();
    try {
      await runMainWorldOp({
        type: "focus-blur",
        inputId,
        outsideId: outsideId || null,
      });
    } finally {
      if (assignedIn) {
        setTimeout(() => {
          try {
            input.removeAttribute("id");
          } catch {
            /* ignore */
          }
        }, 400);
      }
      if (assignedOut && outside) {
        setTimeout(() => {
          try {
            outside.removeAttribute("id");
          } catch {
            /* ignore */
          }
        }, 400);
      }
    }

    await pollUntil(() => {
      const grand = readBetSlipGrandTotal();
      const committed = sumSlipLineCommittedStakes();
      if (grand != null && grandBefore != null && grand > grandBefore) return true;
      if (grand != null && grandBefore == null && grand >= Number(val)) return true;
      if (committed > 0 && committed >= Number(val)) return true;
      return null;
    }, { interval: pollMs(), maxMs: isCrossAlupPage() ? 2200 : 1600 });

    await sleep(isCrossAlupPage() ? 100 : 70);
    return true;
  }

  /** 逐行 focus+blur，使底部「總投注金額」与行内 input 一致 */
  async function commitAllSlipLineStakesViaFocusBlur() {
    const lines = getBetLines();
    for (let i = 0; i < lines.length; i++) {
      const grandBefore = readBetSlipGrandTotal();
      await commitLineStakeByFocusBlur(lines[i]);
      syncDebug(
        `入账 focus+blur 第 ${i + 1}/${lines.length} 行`,
        `總投注=$${readBetSlipGrandTotal() ?? "?"} committed=$${sumSlipLineCommittedStakes() || "?"} (前=$${grandBefore ?? "?"})`
      );
    }
  }

  function stakeInputFromLine(line) {
    const root = line?.querySelector(".collapse-content-r") || line;
    for (const input of root?.querySelectorAll("input.OfInnerInput, input[type='text'], input") || []) {
      if (input.disabled || input.type === "checkbox") continue;
      return input;
    }
    return null;
  }

  function debugLineStakeSnapshot(line) {
    const inputs = [...(line?.querySelectorAll("input") || [])].map((i) => ({
      id: i.id || null,
      val: i.value,
      disabled: i.disabled,
      type: i.type,
    }));
    return JSON.stringify(inputs);
  }

  /** 逐字輸入，React 受控 .OfInnerInput 較易接受；stakeFill 為填額慢路徑 */
  async function typeStakeIntoInput(input, stakeStr, opts = {}) {
    if (!input) return false;
    const text = String(stakeStr ?? "").replace(/[^\d]/g, "");
    if (!text) return false;
    const stakeFill = opts.stakeFill === true;
    const clearMs = stakeFill ? (isCrossAlupPage() ? 28 : 20) : 16;
    const charMs = stakeFill ? (isCrossAlupPage() ? 14 : 12) : 8;
    const tailMs = stakeFill ? stakePostTypeMs() : 24;
    try {
      input.focus();
      input.click();
      input.select?.();
    } catch {
      /* ignore */
    }
    setNativeInputValue(input, "");
    await sleep(clearMs);
    for (const ch of text) {
      const code = ch.charCodeAt(0);
      const keyOpts = { key: ch, code: `Digit${ch}`, keyCode: code, which: code, bubbles: true, cancelable: true };
      input.dispatchEvent(new KeyboardEvent("keydown", keyOpts));
      setNativeInputValue(input, `${String(input.value ?? "").replace(/[^\d]/g, "")}${ch}`);
      try {
        input.dispatchEvent(
          new InputEvent("input", { bubbles: true, cancelable: true, data: ch, inputType: "insertText" })
        );
      } catch {
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
      input.dispatchEvent(new KeyboardEvent("keyup", keyOpts));
      await sleep(charMs);
    }
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new Event("blur", { bubbles: true }));
    await sleep(tailMs);
    return String(input.value ?? "").replace(/,/g, "").trim() === text;
  }

  async function pollLineStakeCommitted(line, stake, maxMs = 1500) {
    const ok = await pollUntil(() => (isLineStakeReactCommitted(line, stake) ? true : null), {
      interval: stakeFillPollMs(),
      maxMs,
    });
    return Boolean(ok);
  }

  async function prepareStakeInputForFill(line) {
    const input = await pollUntil(() => stakeInputFromLine(line), {
      interval: stakeFillPollMs(),
      maxMs: 2400,
    });
    if (!input) throw new Error("NO_STAKE_INPUT");
    try {
      input.focus();
      input.click();
    } catch {
      /* ignore */
    }
    await sleep(stakePreFillMs());
    return input;
  }

  async function assertStakeCommitted(line, stake) {
    const want = normalizeStakeTen(stake);
    const meta = readLineBetMeta(line);
    const wantCommitted = expectedLineCommittedAmount(stake, meta.betCount);
    const input = stakeInputFromLine(line);
    if (input && readStakeFromLine(line) === want && !isLineStakeReactCommitted(line, stake)) {
      await commitLineStakeByFocusBlur(line);
      await sleep(stakePostTypeMs());
    }

    const ok = await pollUntil(() => (isLineStakeReactCommitted(line, stake) ? true : null), {
      interval: stakeFillPollMs(),
      maxMs: isCrossAlupPage() ? 5500 : 3600,
    });
    if (ok) return;

    const gotCommitted = readLineBetMeta(line).committedAmount;
    const err = new Error("HKJC_STAKE_FILL_FAILED");
    err.code = "HKJC_STAKE_FILL_FAILED";
    err.want = want;
    err.wantCommitted = wantCommitted;
    err.got = readStakeFromLine(line);
    err.gotCommitted = gotCommitted;
    throw err;
  }

  /** @deprecated 使用 assertStakeCommitted */
  async function assertStakeOnLine(line, stake) {
    return assertStakeCommitted(line, stake);
  }

  async function verifyBetSlipStakeDelta(slipBaseline, expectedDelta) {
    const b = normalizeSlipBaseline(slipBaseline);
    const want = normalizeStakeTen(expectedDelta);
    if (want <= 0) return;

    let passedVia = null;
    const ok = await pollUntil(() => {
      const lineSum = sumSlipLineInputStakes();
      const lineDelta = lineSum - b.lineInputSum;
      if (lineDelta === want) {
        passedVia = "lines";
        return true;
      }
      const now = readBetSlipGrandTotal();
      if (now != null && b.grandTotal != null && now - b.grandTotal === want) {
        passedVia = "grand";
        return true;
      }
      if (now != null && b.grandTotal == null && b.lineInputSum === 0 && lineDelta === want) {
        passedVia = "lines";
        return true;
      }
      return null;
    }, { interval: pollMs(), maxMs: isCrossAlupPage() ? 6500 : 3500 });

    if (ok) {
      if (passedVia === "lines") {
        const grand = readBetSlipGrandTotal();
        const wantGrand = (b.grandTotal ?? 0) + want;
        if (grand != null && grand !== wantGrand) {
          syncDebug(
            "行内合计 OK，總投注金額未同步",
            `lines=$${sumSlipLineInputStakes()} 總投注=$${grand} 期望=$${wantGrand}`
          );
        }
      }
      return;
    }

    const now = readBetSlipGrandTotal();
    const lineSum = sumSlipLineInputStakes();
    syncDebug(
      "總投注金額校验失败",
      `wantΔ=$${want} before=$${b.grandTotal ?? "?"} now=$${now ?? "?"} actualΔ=$${now != null && b.grandTotal != null ? now - b.grandTotal : "?"} lineSum=$${lineSum} lineΔ=$${lineSum - b.lineInputSum}`
    );
    const err = new Error("HKJC_STAKE_TOTAL_MISMATCH");
    err.code = "HKJC_STAKE_TOTAL_MISMATCH";
    err.want = want;
    err.got = now != null && b.grandTotal != null ? now - b.grandTotal : lineSum - b.lineInputSum;
    throw err;
  }

  async function verifySyncStakeTotals(slipBaseline, items) {
    const expectedDelta = sumItemsStake(items);
    if (expectedDelta <= 0) return;
    await commitAllSlipLineStakesViaFocusBlur();
    const b = normalizeSlipBaseline(slipBaseline);
    const wantGrand = (b.grandTotal ?? 0) + expectedDelta;
    const grandOk = await pollUntil(() => {
      const grand = readBetSlipGrandTotal();
      const committed = sumSlipLineCommittedStakes();
      if (grand === wantGrand) return true;
      if (committed === wantGrand && committed > 0) return true;
      return null;
    }, { interval: pollMs(), maxMs: isCrossAlupPage() ? 9000 : 5500 });
    if (!grandOk) {
      syncDebug(
        "總投注入账未完成",
        `grand=$${readBetSlipGrandTotal() ?? "?"} committed=$${sumSlipLineCommittedStakes() || "?"} want=$${wantGrand}`
      );
    } else {
      syncDebug("總投注金額入账 ✓", `$${readBetSlipGrandTotal() ?? sumSlipLineCommittedStakes()}`);
    }
    await verifyBetSlipStakeDelta(slipBaseline, expectedDelta);
  }

  /** P5：供 popup 確認閘門讀取馬會「總投注金額」快照 */
  function buildStakeVerifySnapshot(expectedDelta, slipBaseline) {
    const b = normalizeSlipBaseline(slipBaseline);
    const want = normalizeStakeTen(expectedDelta);
    const grand = readBetSlipGrandTotal();
    const lineSum = sumSlipLineInputStakes();
    const lineDelta = lineSum - b.lineInputSum;
    let grandDelta = null;
    if (grand != null && b.grandTotal != null) grandDelta = grand - b.grandTotal;
    else if (grand != null && b.grandTotal == null && b.lineInputSum === 0) grandDelta = grand;
    const ok = want > 0 && (lineDelta === want || grandDelta === want);
    return {
      ok,
      expectedDelta: want,
      actualDelta: grandDelta ?? lineDelta,
      lineSumDelta: lineDelta,
      grandTotal: grand,
      lineInputSum: lineSum,
      slipTotalBefore: b.grandTotal,
    };
  }

  async function verifyHkjcSlipStake(payload) {
    const expectedDelta = normalizeStakeTen(payload?.expectedDelta);
    const slipBaseline = normalizeSlipBaseline(
      payload?.slipBaseline ??
        (payload?.slipTotalBefore != null
          ? { grandTotal: payload.slipTotalBefore, lineInputSum: 0, lineCount: 0 }
          : captureSlipBaseline())
    );
    if (expectedDelta <= 0) {
      return { ok: false, error: "INVALID_EXPECTED_DELTA" };
    }
    if (!document.querySelector("#betslip-panel")) {
      return { ok: false, error: "NO_BETSLIP_PANEL" };
    }
    const polled = await pollUntil(
      () => {
        const snap = buildStakeVerifySnapshot(expectedDelta, slipBaseline);
        return snap.ok ? snap : null;
      },
      { interval: stakeFillPollMs(), maxMs: 2800 }
    );
    const snap = polled || buildStakeVerifySnapshot(expectedDelta, slipBaseline);
    return { ok: Boolean(snap.ok), ...snap };
  }

  function padHorse(n) {
    return String(n).padStart(2, "0");
  }

  function findCheckboxByIds(ids) {
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) return el;
    }
    return null;
  }

  function qinPairCheckboxIds(raceNo, h1, h2, pool) {
    const r = Number(raceNo);
    const [a, b] = h1 < h2 ? [h1, h2] : [h2, h1];
    const ids = [];
    for (const tag of wpqPoolTagsForLookup(pool)) {
      ids.push(
        `wpleg_${tag}_${r}_${a}_${b}`,
        `wpleg_${tag}_${r}_${b}_${a}`,
        `wpleg_${tag}_${r}_${padHorse(a)}_${padHorse(b)}`,
        `wpleg_${tag}_${r}_${padHorse(b)}_${padHorse(a)}`
      );
    }
    return ids;
  }

  function qinHorseCheckboxIds(raceNo, horse, pool) {
    const r = Number(raceNo);
    const h = Number(horse);
    const ids = [];
    for (const tag of wpqPoolTagsForLookup(pool)) {
      ids.push(`wpleg_${tag}_${r}_${h}`, `wpleg_${tag}_${r}_${padHorse(h)}`);
    }
    return ids;
  }

  /** 賠率矩陣格（qb_QIN_1_2 / qb_QPL_1_12）；與腳選框 wpleg_QIN 並存 */
  function qbPairCellIds(pool, h1, h2) {
    const a = Number(h1);
    const b = Number(h2);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return [];
    const [lo, hi] = a < b ? [a, b] : [b, a];
    const prefix = String(pool || "QIN").toUpperCase() === "QPL" ? "qb_QPL_" : "qb_QIN_";
    return [`${prefix}${lo}_${hi}`, `${prefix}${hi}_${lo}`];
  }

  function findQbPairCell(pool, h1, h2) {
    for (const id of qbPairCellIds(pool, h1, h2)) {
      const el = document.getElementById(id);
      if (el) return el;
    }
    const a = Number(h1);
    const b = Number(h2);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    const [lo, hi] = a < b ? [a, b] : [b, a];
    const tag = String(pool || "QIN").toUpperCase() === "QPL" ? "QPL" : "QIN";
    return (
      document.querySelector(`[id^="qb_${tag}_${lo}_${hi}"]`) ||
      document.querySelector(`[id^="qb_${tag}_${hi}_${lo}"]`) ||
      document.querySelector(`[id*="qb_${tag}_${lo}_${hi}"]`)
    );
  }

  async function clickQbPairCell(pool, h1, h2) {
    const cell = findQbPairCell(pool, h1, h2);
    if (!cell) return false;
    try {
      cell.scrollIntoView({ block: "nearest", inline: "nearest" });
    } catch {
      /* ignore */
    }
    cell.click();
    cell.querySelector(".cp, .table-odds, span")?.click();
    await sleep(isCrossAlupPage() ? 50 : 32);
    return true;
  }

  function stakeFillEntry(line, stake, matcher) {
    return { line, stake: normalizeStakeTen(stake), matcher };
  }

  function resolveStakeFillLine(entry, slipAnchor) {
    let line = entry?.line;
    if (line?.isConnected && document.contains(line)) return line;
    if (typeof entry?.matcher !== "function") return line || null;
    const pool =
      slipAnchor != null && Number.isFinite(slipAnchor)
        ? getBetLines().slice(slipAnchor)
        : getBetLines();
    const matched = pool.filter(entry.matcher);
    if (matched.length) {
      const stake = entry.stake;
      if (stake != null) {
        const committed = matched.filter((l) => isLineStakeCommitted(l, stake));
        if (committed.length) return committed[committed.length - 1];
      }
      return matched[matched.length - 1];
    }
    return findNewestBetLine(entry.matcher) || null;
  }

  /**
   * P2 階段二：統一慢填額；階段三：掃描未提交行再補填一次。
   */
  async function fillStakeEntriesPhase2(entries, slipAnchor) {
    const list = Array.isArray(entries) ? entries.filter(Boolean) : [];
    if (!list.length) return;

    for (const ent of list) {
      const line = resolveStakeFillLine(ent, slipAnchor);
      if (!line) throw new Error("NO_BET_LINE_MATCH");
      if (isLineStakeCommitted(line, ent.stake)) continue;
      await fillStakeOnLine(line, ent.stake);
      await assertStakeCommitted(line, ent.stake);
    }

    const needsRescan = list.filter((ent) => {
      const line = resolveStakeFillLine(ent, slipAnchor);
      return line && !isLineStakeCommitted(line, ent.stake);
    });
    for (const ent of needsRescan) {
      const line = resolveStakeFillLine(ent, slipAnchor);
      if (!line) throw new Error("NO_BET_LINE_MATCH");
      await fillStakeOnLine(line, ent.stake);
      await assertStakeCommitted(line, ent.stake);
    }
  }

  /** P2：勾選後 → 填計算機 → 加入投注區（人手 ④⑤） */
  async function appendPairToSlipOnly(matcher, slipBefore, stake) {
    if (stake == null) {
      const before = Number.isFinite(slipBefore) ? slipBefore : getBetLines().length;
      await clickAddToSlip();
      let line = await pollUntil(() => findAddedBetLine(matcher, before), {
        interval: pollMs(),
        maxMs: isCrossAlupPage() ? 2600 : 2000,
      });
      if (!line) line = findNewestBetLine(matcher);
      if (!line) throw new Error("NO_BET_LINE_MATCH");
      return line;
    }
    return commitSelectionViaCalculator(stake, slipBefore, matcher);
  }

  async function completePairSlipStake(matcher, stake, slipBefore) {
    const want = normalizeStakeTen(stake);
    await commitSelectionViaCalculator(want, slipBefore, matcher);
    return { added: 1 };
  }

  function pairSlipResult() {
    return { added: 1 };
  }

  /** 位置Q/連贏：填計算機 → 加入投注區 → 校驗 */
  async function appendPairToSlipAndFill(matcher, stake, slipBefore) {
    return commitSelectionViaCalculator(stake, slipBefore, matcher);
  }

  async function requireWpqPairSelected(raceNo, h1, h2, pool, waitOpts) {
    const ok = await waitWpqPairSelected(raceNo, h1, h2, pool, waitOpts);
    if (!ok) {
      const tag = String(pool || "QIN").toUpperCase() === "QPL" ? "qpl" : "qin";
      throw new Error(`HKJC_INSUFFICIENT_SELECTION:${tag}`);
    }
  }

  /**
   * 連贏膽拖：官網為「膽」欄勾膽馬、「腳」欄勾配腳 → 投注區 **一行**（含「拖」、注數=配腳數）。
   */
  async function addQinBankerDrag(raceNo, batch, opts = {}) {
    const { banker, legs, items } = batch;
    const r = resolveWpqRaceNo(raceNo);
    if (!opts.poolReady) {
      await ensureQinPoolTab({ soft: true });
    } else if (!isWpqPoolReadyInUi() || !wpqSubTypeIs("QIN")) {
      await ensureQinPoolTab({ soft: false });
    }
    if (!opts.raceSettled) await ensureRaceReadyIfNeeded(r, { maxMs: 2500 });
    if (!opts.betModeReady) {
      const switchedMode = await ensureQinBankerBetMode();
      if (switchedMode) await sleep(isCrossAlupPage() ? 120 : 80);
    }

    const cbDelay = navCbDelay(opts);
    await uncheckWinExcept(raceNo, []);
    await uncheckQinTableForRace(raceNo, "QIN", opts);

    const bCb = findQinBankerCheckbox(r, banker, "QIN");
    if (!bCb) throw new Error(`MISSING_QIN_BANKER:${banker}`);
    await setCheckboxChecked(bCb, true, cbDelay);
    for (const leg of legs) {
      const lcb = findQinLegFootCheckbox(r, leg, "QIN");
      if (!lcb) throw new Error(`MISSING_QIN_LEG:${leg}`);
      await setCheckboxChecked(lcb, true, cbDelay);
    }

    const waitOpts = { pool: "QIN", quick: Boolean(opts.poolReady), maxMs: opts.poolReady ? 2000 : 3000 };
    if (!(await waitWpqBankerLegsSelected(r, banker, legs, waitOpts))) {
      throw new Error("HKJC_INSUFFICIENT_SELECTION:qin-banker");
    }

    const slipBefore = getBetLines().length;
    const stake = resolveBankerBatchStake(items);
    if (stake == null) throw new Error("HKJC_BANKER_DUTCH_UNEQUAL");
    const bankerMatcher = (l) =>
      isQinBankerBetLine(l) && betLineMatchesBankerDrag(l, banker, legs);
    const line = await commitSelectionViaCalculator(stake, slipBefore, bankerMatcher);
    if (isQinBoxBetLine(line)) {
      throw new Error("HKJC_BANKER_LINE_MISMATCH:box");
    }
    return { added: items.length };
  }

  /**
   * 位置Q膽拖：與連贏相同勾「膽」「腳」→ 投注區一行（如 4&gt;5 + 6）。
   */
  async function addQplBankerDrag(raceNo, batch, opts = {}) {
    const { banker, legs, items } = batch;
    const r = resolveWpqRaceNo(raceNo);
    if (!opts.poolReady) {
      await ensureWpqPoolReady({ soft: true });
      await ensureWpqSubType("QPL", { soft: false });
    } else if (!isWpqPoolReadyInUi() || !wpqSubTypeIs("QPL")) {
      await ensureWpqPoolReady({ soft: false });
      await ensureWpqSubType("QPL", { soft: false });
    }
    if (!opts.raceSettled) await ensureRaceReadyIfNeeded(r, { maxMs: 2500 });
    if (!opts.poolReady) await sleep(isCrossAlupPage() ? 150 : 100);

    const cbDelay = navCbDelay(opts);
    await uncheckWinExcept(raceNo, []);
    await uncheckQinTableForRace(raceNo, "QPL", opts);

    const bCb = findQinBankerCheckbox(r, banker, "QPL");
    if (!bCb) throw new Error(`MISSING_QIN_BANKER:${banker}`);
    await setCheckboxChecked(bCb, true, cbDelay);
    for (const leg of legs) {
      const lcb = findQinLegFootCheckbox(r, leg, "QPL");
      if (!lcb) throw new Error(`MISSING_QIN_LEG:${leg}`);
      await setCheckboxChecked(lcb, true, cbDelay);
    }

    const waitOpts = { pool: "QPL", quick: Boolean(opts.poolReady), maxMs: opts.poolReady ? 2000 : 3000 };
    if (!(await waitWpqBankerLegsSelected(r, banker, legs, waitOpts))) {
      throw new Error("HKJC_INSUFFICIENT_SELECTION:qpl-banker");
    }

    const slipBefore = getBetLines().length;
    const stake = resolveBankerBatchStake(items);
    if (stake == null) throw new Error("HKJC_BANKER_DUTCH_UNEQUAL");
    const bankerMatcher = (l) =>
      isQplBankerBetLine(l) && betLineMatchesBankerDrag(l, banker, legs);
    const line = await commitSelectionViaCalculator(stake, slipBefore, bankerMatcher);
    if (isQplBoxBetLine(line)) {
      throw new Error("HKJC_BANKER_LINE_MISMATCH:qpl-box");
    }
    assertBetLineIsQpl(line);
    return { added: items.length };
  }

  function winCheckboxIds(raceNo, horse, venueCode) {
    const r = Number(raceNo);
    const h = Number(horse);
    const ids = [`wpleg_WIN_${r}_${h}`, `wpleg_WIN_${r}_${padHorse(h)}`];
    const v = String(venueCode ?? "").trim().toUpperCase();
    if (/^S\d+$/.test(v)) {
      ids.push(`wpleg_${v}_WIN_${r}_${h}`, `wpleg_${v}_WIN_${r}_${padHorse(h)}`);
    }
    return ids;
  }

  function plaCheckboxIds(raceNo, horse, venueCode) {
    const r = Number(raceNo);
    const h = Number(horse);
    const ids = [`wpleg_PLA_${r}_${h}`, `wpleg_PLA_${r}_${padHorse(h)}`];
    const v = String(venueCode ?? "").trim().toUpperCase();
    if (/^S\d+$/.test(v)) {
      ids.push(`wpleg_${v}_PLA_${r}_${h}`, `wpleg_${v}_PLA_${r}_${padHorse(h)}`);
    }
    return ids;
  }

  function findPlaCheckbox(raceNo, horse, venueCode) {
    const hit = findCheckboxByIds(plaCheckboxIds(raceNo, horse, venueCode));
    if (hit) return hit;
    const r = Number(raceNo);
    const h = Number(horse);
    const ph = padHorse(h);
    for (const cb of document.querySelectorAll(`input[id^="wpleg_PLA_${r}_"]`)) {
      const id = cb.id || "";
      if (id.endsWith(`_${h}`) || id.endsWith(`_${ph}`)) return cb;
    }
    return null;
  }

  function findWinCheckbox(raceNo, horse, venueCode) {
    const hit = findCheckboxByIds(winCheckboxIds(raceNo, horse, venueCode));
    if (hit) return hit;
    const r = Number(raceNo);
    const h = Number(horse);
    const ph = padHorse(h);
    for (const cb of document.querySelectorAll(`input[id*="WIN"][id*="_${r}_"]`)) {
      const id = cb.id || "";
      if (id.endsWith(`_${h}`) || id.endsWith(`_${ph}`)) return cb;
    }
    return null;
  }

  function getBetLines() {
    const panel = document.querySelector("#betslip-panel");
    if (!panel) return [];
    return [...panel.querySelectorAll(".bet-line")];
  }

  function findNewestBetLine(matcher) {
    const lines = getBetLines();
    for (let i = lines.length - 1; i >= 0; i--) {
      if (matcher(lines[i])) return lines[i];
    }
    return null;
  }

  async function ensureBetLineExpanded(line) {
    if (!line?.classList?.contains("bet-line-collapse")) return;
    const input = stakeInputFromLine(line);
    if (input && isUiVisible(input)) return;
    const title = line.querySelector(".title");
    if (title) {
      await clickElementInMainWorld(title);
      await sleep(isCrossAlupPage() ? 90 : 65);
    }
  }

  /** P1 填額：MAIN world 写入 + 人手式 focus+blur 入账。 */
  async function fillStakeOnLine(line, stake) {
    if (!line) throw new Error("NO_BET_LINE");
    const want = normalizeStakeTen(stake);
    const stakeStr = String(want);
    if (isLineStakeReactCommitted(line, stake)) return;

    await ensureBetLineExpanded(line);
    const input = await prepareStakeInputForFill(line);
    if (isLineStakeReactCommitted(line, stake)) return;

    for (let attempt = 0; attempt < 6; attempt++) {
      if (isLineStakeReactCommitted(line, stake)) return;
      await insertTextValueInMainWorld(input, stakeStr);
      await commitLineStakeByFocusBlur(line);
      if (await pollLineStakeCommitted(line, stake, 2000)) return;
      await typeInputValueInMainWorld(input, stakeStr);
      await commitLineStakeByFocusBlur(line);
      if (await pollLineStakeCommitted(line, stake, 1600)) return;
      await typeStakeIntoInput(input, stakeStr, { stakeFill: true });
      await commitLineStakeByFocusBlur(line);
      if (await pollLineStakeCommitted(line, stake, 2000)) return;
      await sleep(stakeRetryGapMs(attempt));
    }
    await assertStakeCommitted(line, stake);
  }

  /** 在 slipBefore 之後新增的注單行中，按 matcher 找本次添加的那一行（取最後一條匹配，避開勾選自動加行） */
  function findAddedBetLine(matcher, linesBefore, opts = {}) {
    const added = getBetLines().slice(linesBefore);
    if (!added.length) return null;
    const matched = added.filter(matcher);
    if (!matched.length) return added[added.length - 1];
    const preferStake = opts.preferStake;
    if (preferStake != null) {
      const committed = matched.filter((l) => isLineStakeCommitted(l, preferStake));
      if (committed.length) return committed[committed.length - 1];
    }
    return matched[matched.length - 1];
  }

  function findRemoveBetLineButton(line) {
    if (!line) return null;
    return (
      line.querySelector('[aria-label="移除注項"]') ||
      line.querySelector(".switch-btn-icon.open-btn-icon") ||
      line.querySelector(".open-btn-icon") ||
      [...line.querySelectorAll("[role='button'], button, a, div")].find((el) =>
        /移除|刪除|删除|remove/i.test(el.getAttribute?.("aria-label") || el.textContent || "")
      )
    );
  }

  async function clickRemoveBetLine(line) {
    const btn = findRemoveBetLineButton(line);
    if (btn) {
      firePointerClick(btn);
      await sleep(isCrossAlupPage() ? 100 : 75);
      if (!line.isConnected || !document.contains(line)) return true;
    }
    const alt =
      line.querySelector(".title [role='button']") ||
      line.querySelector(".title .switch-btn-icon") ||
      line.querySelector(".bet-line-close");
    if (alt) {
      firePointerClick(alt);
      await sleep(isCrossAlupPage() ? 100 : 75);
    }
    return !line.isConnected || !document.contains(line);
  }

  /** 勾選後馬會有時自動加一行（預設 $10）；僅移除尚未正確入單的預加行 */
  async function discardPrematureSlipLines(slipBefore, matcher, stake) {
    const isBadPremature = (line) => stake == null || !isLineStakeCommitted(line, stake);
    for (let round = 0; round < 5; round++) {
      const premature = getBetLines().slice(slipBefore).filter(matcher).filter(isBadPremature);
      if (!premature.length) return;
      syncDebug(`移除勾选自动预加行 ×${premature.length}`);
      for (const line of premature) {
        await clickRemoveBetLine(line);
      }
      await sleep(isCrossAlupPage() ? 100 : 75);
    }
    const left = getBetLines().slice(slipBefore).filter(matcher).filter(isBadPremature);
    if (left.length) {
      const err = new Error("HKJC_PREMATURE_SLIP_LINE");
      err.code = "HKJC_PREMATURE_SLIP_LINE";
      throw err;
    }
  }

  /** 勾選後 → 填計算機 → 加入投注區 */
  async function addSelectionToSlipOnly(matcher, linesBefore, stake) {
    if (!document.querySelector("#betslip-panel")) throw new Error("NO_BETSLIP_PANEL");
    if (stake != null) {
      return commitSelectionViaCalculator(stake, linesBefore, matcher);
    }
    const before = Number.isFinite(linesBefore) ? linesBefore : getBetLines().length;
    await clickAddToSlip();
    let line = await pollUntil(() => findAddedBetLine(matcher, before), {
      interval: pollMs(),
      maxMs: isCrossAlupPage() ? 2800 : 2200,
    });
    if (!line) line = findNewestBetLine(matcher);
    if (!line) throw new Error("NO_BET_LINE_MATCH");
    return line;
  }

  async function addSelectionToSlipAndFill(matcher, stake, linesBefore) {
    return commitSelectionViaCalculator(stake, linesBefore, matcher);
  }

  function betLineMatchesHorse(line, horseNo) {
    const label =
      line.querySelector(".collapse-betline")?.textContent?.replace(/\s+/g, " ").trim() ||
      line.textContent?.replace(/\s+/g, " ").trim() ||
      "";
    return isSingleHorseBetLabel(label, horseNo);
  }

  function betLineMatchesPair(line, h1, h2) {
    const label =
      line.querySelector(".collapse-betline")?.textContent?.replace(/\s+/g, " ").trim() ||
      line.textContent?.replace(/\s+/g, " ").trim() ||
      "";
    if (!label) return false;
    const a = String(h1);
    const b = String(h2);
    const re1 = new RegExp(`0?${a}\\s*\\+\\s*0?${b}`);
    const re2 = new RegExp(`0?${b}\\s*\\+\\s*0?${a}`);
    return re1.test(label) || re2.test(label);
  }

  async function setCheckboxChecked(cb, checked, delayMs = 14) {
    if (!cb) return;
    const input = cb.type === "checkbox" ? cb : cb.querySelector?.('input[type="checkbox"]') || cb;
    if (checked && isCheckboxBettingLocked(input)) {
      const err = new Error("HKJC_BETTING_LOCKED");
      err.code = "HKJC_BETTING_LOCKED";
      throw err;
    }
    const isOn = input.type === "checkbox" ? Boolean(input.checked) : false;
    if (isOn !== checked) {
      const clickTarget = getClickableCheckboxTarget(input);
      firePointerClick(clickTarget);
      firePointerClick(input.closest(".checkbox-container"));
      if (input.type === "checkbox" && Boolean(input.checked) !== checked) {
        firePointerClick(input);
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked")?.set;
        if (setter) setter.call(input, checked);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
      if (delayMs > 0) await sleep(delayMs);
    }
  }

  async function clickAddToSlip() {
    const addBtn = findAddToSlipButton();
    if (!addBtn) throw new Error("MISSING_ADD_TO_SLIP");
    try {
      addBtn.scrollIntoView({ block: "nearest", inline: "nearest" });
    } catch {
      /* ignore */
    }
    await clickElementInMainWorld(addBtn);
    await sleep(isCrossAlupPage() ? 120 : 75);
  }

  async function waitWinSelectionCount(raceNo, minCount) {
    const r = Number(raceNo);
    const ok = await pollUntil(
      () => document.querySelectorAll(`input[id^="wpleg_WIN_${r}_"]:checked`).length >= minCount || null,
      { interval: pollMs(), maxMs: 2000 }
    );
    return Boolean(ok);
  }

  async function waitForBetLineCount(slipBefore, wantCount, maxMs = 2800) {
    const lines = await pollUntil(
      () => {
        const slice = getBetLines().slice(slipBefore);
        return slice.length >= wantCount ? slice : null;
      },
      { interval: pollMs(), maxMs }
    );
    return lines || getBetLines().slice(slipBefore);
  }

  /** 獨贏：每注均走 ③勾選 → ④填計算機 → ⑤添加 */
  async function addWinHorsesBatch(raceNo, items, venueCode, opts = {}) {
    const slipOpts = opts.alwaysAdd === false ? {} : { alwaysAdd: true };
    const { toAdd, toUpdate, skipped } = partitionWinItemsForSync(items, slipOpts);
    for (const u of toUpdate) await fillStakeOnLine(u.line, u.stake);
    if (!toAdd.length) return { added: 0, skipped, updated: toUpdate.length };

    await ensureWinPoolTab({ soft: true });

    const itemErrors = [];
    let added = 0;

    const addOneWin = async (it) => {
      const horse = String(it.combo ?? "").trim();
      const stake = it.stakePerLine;
      const matcher = (l) => betLineMatchesHorse(l, horse);
      syncDebug(`── 独赢 马 ${horse} 每注 $${normalizeStakeTen(stake)} ──`);
      await uncheckPlaExcept(raceNo, []);
      await uncheckWinSelectionNotInSlip(raceNo, stake, horse);
      const cb = findWinCheckbox(raceNo, horse, venueCode);
      if (!cb) throw new Error(`MISSING_WIN_CHECKBOX:wpleg_WIN_${raceNo}_${horse}`);
      const slipBefore = getBetLines().length;
      syncDebug(`勾选 ${elSyncId(cb)}`);
      await setCheckboxChecked(cb, true, 14);
      if (!(await waitSelectionReady("win", raceNo))) {
        throw new Error("HKJC_INSUFFICIENT_SELECTION:win");
      }
      if (!(await waitInvestmentCalculatorReady(1))) {
        throw new Error("HKJC_CALC_NOT_READY");
      }
      await commitSelectionViaCalculator(stake, slipBefore, matcher);
      syncDebug(`等待马会取消勾选 ${elSyncId(cb)}`);
      await waitWinHorseCheckboxReleased(raceNo, horse, venueCode);
      syncDebug(`✓ 独赢 ${horse} 完成`);
    };

    for (const it of toAdd) {
      try {
        await addOneWin(it);
        added += 1;
      } catch (e) {
        syncDebugErr(`独赢 ${it.combo} 失败`, e);
        itemErrors.push({
          combo: String(it.combo ?? "").trim(),
          type: "獨贏",
          error: String(e?.code || e?.message || e),
        });
        await uncheckWinSelectionNotInSlip(raceNo, it.stakePerLine);
        await uncheckPlaExcept(raceNo, []);
      }
    }

    return { added, skipped, updated: toUpdate.length, errors: itemErrors.length ? itemErrors : undefined };
  }

  async function addWinHorseSequential(raceNo, horseNo, stake, venueCode) {
    const r = await addWinHorsesBatch(raceNo, [{ combo: horseNo, stakePerLine: stake }], venueCode);
    return r.added;
  }

  async function waitPlaSelectionCount(raceNo, minCount) {
    const r = Number(raceNo);
    const ok = await pollUntil(
      () => document.querySelectorAll(`input[id^="wpleg_PLA_${r}_"]:checked`).length >= minCount || null,
      { interval: pollMs(), maxMs: 2000 }
    );
    return Boolean(ok);
  }

  /** 位置：每注均走 ③勾選 → ④填計算機 → ⑤添加 */
  async function addPlaHorsesBatch(raceNo, items, venueCode, opts = {}) {
    const slipOpts = opts.alwaysAdd === false ? {} : { alwaysAdd: true };
    const { toAdd, toUpdate, skipped } = partitionPlaItemsForSync(items, slipOpts);
    for (const u of toUpdate) await fillStakeOnLine(u.line, u.stake);
    if (!toAdd.length) return { added: 0, skipped, updated: toUpdate.length };

    await ensureWinPoolTab({ soft: true });

    const itemErrors = [];
    let added = 0;

    for (const it of toAdd) {
      const horse = String(it.combo ?? "").trim();
      const stake = it.stakePerLine;
      const matcher = (l) => isPlaBetLine(l) && betLineMatchesHorse(l, horse);
      try {
        syncDebug(`── 位置 马 ${horse} 每注 $${normalizeStakeTen(stake)} ──`);
        await uncheckWinExcept(raceNo, []);
        await uncheckPlaSelectionNotInSlip(raceNo, stake, horse);
        const cb = findPlaCheckbox(raceNo, horse, venueCode);
        if (!cb) throw new Error(`MISSING_PLA_CHECKBOX:wpleg_PLA_${raceNo}_${horse}`);
        const slipBefore = getBetLines().length;
        syncDebug(`勾选 ${elSyncId(cb)}`);
        await setCheckboxChecked(cb, true, 14);
        if (!(await waitSelectionReady("pla", raceNo))) {
          throw new Error("HKJC_INSUFFICIENT_SELECTION:pla");
        }
        if (!(await waitInvestmentCalculatorReady(1))) {
          throw new Error("HKJC_CALC_NOT_READY");
        }
        await commitSelectionViaCalculator(stake, slipBefore, matcher);
        await waitPlaHorseCheckboxReleased(raceNo, horse, venueCode);
        syncDebug(`✓ 位置 ${horse} 完成`);
        added += 1;
      } catch (e) {
        syncDebugErr(`位置 ${horse} 失败`, e);
        itemErrors.push({
          combo: horse,
          type: "位置",
          error: String(e?.code || e?.message || e),
        });
        await uncheckWinExcept(raceNo, []);
        await uncheckPlaSelectionNotInSlip(raceNo, stake);
      }
    }
    return { added, skipped, updated: toUpdate.length, errors: itemErrors.length ? itemErrors : undefined };
  }

  async function addPlaHorseSequential(raceNo, horseNo, stake, venueCode) {
    const r = await addPlaHorsesBatch(raceNo, [{ combo: horseNo, stakePerLine: stake }], venueCode);
    return r.added;
  }

  function formatBetLineRaceTitle(venueCode, raceNo) {
    const v = String(venueCode || "ST").trim().toUpperCase() || "ST";
    const r = Number(raceNo);
    return `場次 ${v} - ${Number.isFinite(r) ? r : 1} `;
  }

  function findTemplateBetLine(poolKeyword) {
    const lines = getBetLines();
    if (poolKeyword) {
      const hit = lines.find((l) => (l.querySelector(".title")?.textContent || "").includes(poolKeyword));
      if (hit) return hit;
    }
    return lines[0] || null;
  }

  function cloneBetLineFromTemplate(template) {
    const line = template.cloneNode(true);
    line.querySelectorAll("[id]").forEach((el) => el.removeAttribute("id"));
    return line;
  }

  /**
   * 投注區為空時：按馬會常見 DOM 結構新建 .bet-line（無需手動模板）。
   * 結構對齊 bet.hkjc.com #betslip-panel 內 rc-bet-line。
   */
  function createBetLineElement(poolZh, venueCode, raceNo, selectionLabel) {
    const line = document.createElement("div");
    line.className = "bet-line rc-bet-line bet-line-collapse";

    const title = document.createElement("div");
    title.className = "title";
    const titleText = document.createElement("div");
    titleText.innerHTML = `${poolZh}  <span>|</span> ${formatBetLineRaceTitle(venueCode, raceNo)}`;
    const removeBtn = document.createElement("div");
    removeBtn.className = "switch-btn-icon open-btn-icon";
    removeBtn.setAttribute("role", "button");
    removeBtn.setAttribute("aria-label", "移除注項");
    title.append(titleText, removeBtn);

    const betTypeCol = document.createElement("div");
    betTypeCol.className = "bet-type-col small-bet-type-col";

    const contentL = document.createElement("div");
    contentL.className = "collapse-content-l";

    const betlineCheckbox = document.createElement("div");
    betlineCheckbox.className = "betline-checkbox";
    const checkboxContainer = document.createElement("div");
    checkboxContainer.className = "checkbox-container size-20 checkbox-racing";
    checkboxContainer.style.cssText =
      "--size: 20px; --width: 20px; --height: 20px; --background: #173e96;";
    const cbInput = document.createElement("input");
    cbInput.type = "checkbox";
    cbInput.value = "";
    const cbSpan = document.createElement("span");
    cbSpan.style.border = "1px solid rgb(153, 153, 153)";
    checkboxContainer.append(cbInput, cbSpan);
    const guoguan = document.createElement("div");
    guoguan.textContent = "過關";
    betlineCheckbox.append(checkboxContainer, guoguan);

    const collapseBetline = document.createElement("div");
    collapseBetline.className = "collapse-betline";
    collapseBetline.textContent = selectionLabel;

    contentL.append(betlineCheckbox, guoguan);

    const contentR = document.createElement("div");
    contentR.className = "collapse-content-r";
    const unitbet = document.createElement("div");
    unitbet.className = "unitbet-input";
    const dollar = document.createElement("span");
    dollar.textContent = "$";
    const stakeInput = document.createElement("input");
    stakeInput.type = "text";
    stakeInput.inputMode = "numeric";
    stakeInput.autocomplete = "off";
    stakeInput.maxLength = 10;
    stakeInput.className = "OfInnerInput";
    stakeInput.style.fontSize = "15px";
    unitbet.append(dollar, stakeInput);
    contentR.append(unitbet);

    betTypeCol.append(contentL, collapseBetline, contentR);
    line.append(title, betTypeCol);
    return line;
  }

  function buildBetLineElement(poolZh, venueCode, raceNo, selectionLabel) {
    const label = String(selectionLabel ?? "").trim() ? `${String(selectionLabel).trim()} ` : "";
    const template =
      findTemplateBetLine(poolZh === "連贏" ? "連贏" : "獨贏") || findTemplateBetLine("獨贏") || findTemplateBetLine("連贏");
    if (template) {
      const line = cloneBetLineFromTemplate(template);
      setBetLineHeader(line, poolZh, venueCode, raceNo);
      const collapse = line.querySelector(".collapse-betline");
      if (collapse) collapse.textContent = label;
      return line;
    }
    return createBetLineElement(poolZh, venueCode, raceNo, label);
  }

  function setBetLineHeader(line, poolZh, venueCode, raceNo) {
    const titleInner = line.querySelector(".title > div");
    if (titleInner) {
      titleInner.innerHTML = `${poolZh}  <span>|</span> ${formatBetLineRaceTitle(venueCode, raceNo)}`;
    }
    const collapse = line.querySelector(".collapse-betline");
    return collapse;
  }

  function appendBetLineToPanel(line) {
    const panel = document.querySelector("#betslip-panel");
    if (!panel) throw new Error("NO_BETSLIP_PANEL");
    panel.appendChild(line);
    line.dataset.racepluginInjected = "direct";
    line.dispatchEvent(new CustomEvent("change", { bubbles: true }));
  }

  function removeRacepluginInjectedLines() {
    let removed = 0;
    for (const line of getBetLines()) {
      if (line.dataset.racepluginInjected === "direct") {
        line.remove();
        removed += 1;
      }
    }
    if (removed > 0) notifyBetSlipChanged();
    return removed;
  }

  /** P4：投注區已開且場次一致時，可嘗試 Direct Panel（最快） */
  function canUseDirectPanelSync(payload, raceNo, targetUrl) {
    if (payload?.preferDirectPanel === false) return false;
    if (!document.querySelector("#betslip-panel")) return false;
    const wantRace = Number(raceNo);
    if (!Number.isFinite(wantRace) || wantRace < 1) return false;
    const domRace = getCurrentRaceNoFromDom();
    if (domRace != null && domRace !== wantRace) return false;
    const wantVenue = String(
      payload?.venueCode ?? parseHkjcRacePath(targetUrl)?.venue ?? ""
    )
      .trim()
      .toUpperCase();
    const domVenue = getCurrentVenueFromDom();
    if (wantVenue && domVenue && domVenue !== wantVenue) return false;
    return true;
  }

  function appendWinLineToPanel(raceNo, venueCode, horse) {
    const h = String(horse ?? "").trim();
    const line = buildBetLineElement("獨贏", venueCode, raceNo, h);
    appendBetLineToPanel(line);
    return { line, matcher: (l) => betLineMatchesHorse(l, h) };
  }

  function appendPlaLineToPanel(raceNo, venueCode, horse) {
    const h = String(horse ?? "").trim();
    const line = buildBetLineElement("位置", venueCode, raceNo, h);
    appendBetLineToPanel(line);
    return { line, matcher: (l) => isPlaBetLine(l) && betLineMatchesHorse(l, h) };
  }

  function appendQinPairLineToPanel(raceNo, venueCode, h1, h2) {
    const line = buildBetLineElement("連贏", venueCode, raceNo, `${h1} + ${h2}`);
    appendBetLineToPanel(line);
    const matcher = qinPairLineMatcher(h1, h2);
    return { line, matcher };
  }

  function appendQplPairLineToPanel(raceNo, venueCode, h1, h2) {
    const line = buildBetLineElement("位置Q", venueCode, raceNo, `${h1} + ${h2}`);
    appendBetLineToPanel(line);
    const matcher = qplPairLineMatcher(h1, h2);
    return { line, matcher };
  }

  function appendQinBankerDragLineToPanel(raceNo, venueCode, batch) {
    const { banker, legs } = batch;
    const legLabel = legs.map((h) => String(Number(h))).join(" + ");
    const line = buildBetLineElement("連贏", venueCode, raceNo, `${banker}>${legLabel}`);
    appendBetLineToPanel(line);
    const matcher = (l) => isQinBankerBetLine(l) && betLineMatchesBankerDrag(l, banker, legs);
    return { line, matcher };
  }

  function appendQplBankerDragLineToPanel(raceNo, venueCode, batch) {
    const { banker, legs } = batch;
    const legLabel = legs.map((h) => String(Number(h))).join(" + ");
    const line = buildBetLineElement("位置Q", venueCode, raceNo, `${banker}>${legLabel}`);
    appendBetLineToPanel(line);
    const matcher = (l) => isQplBankerBetLine(l) && betLineMatchesBankerDrag(l, banker, legs);
    return { line, matcher };
  }

  function notifyBetSlipChanged() {
    const panel = document.querySelector("#betslip-panel");
    if (!panel) return;
    panel.dispatchEvent(new CustomEvent("change", { bubbles: true }));
    const scroll = document.querySelector('[data-testid="bet_placeBetList_scrollView"]');
    if (scroll) scroll.dispatchEvent(new Event("scroll", { bubbles: true }));
  }

  /**
   * P4：僅操作 #betslip-panel 注入行 → P2 統一慢填額 → P0 總額驗收；不點左側選馬。
   */
  async function applySlipDirectPanel(payload, winFinal, plaFinal, qinFinal, qplFinal, raceNo, venueCode) {
    const panel = document.querySelector("#betslip-panel");
    if (!panel) throw new Error("NO_BETSLIP_PANEL");

    const errors = [];
    let added = 0;
    const slipBaseline = captureSlipBaseline();
    const slipAnchor = getBetLines().length;
    const fillQueue = [];
    const slipOpts = { alwaysAdd: true };

    if (winFinal.length) {
      const { toAdd } = partitionWinItemsForSync(winFinal, slipOpts);
      for (const it of toAdd) {
        try {
          const { line, matcher } = appendWinLineToPanel(raceNo, venueCode, it.combo);
          fillQueue.push(stakeFillEntry(line, it.stakePerLine, matcher));
          added += 1;
        } catch (e) {
          errors.push({ combo: it.combo, type: "獨贏", error: String(e?.message || e) });
        }
      }
    }

    if (plaFinal.length) {
      const { toAdd } = partitionPlaItemsForSync(plaFinal, slipOpts);
      for (const it of toAdd) {
        try {
          const { line, matcher } = appendPlaLineToPanel(raceNo, venueCode, it.combo);
          fillQueue.push(stakeFillEntry(line, it.stakePerLine, matcher));
          added += 1;
        } catch (e) {
          errors.push({ combo: it.combo, type: "位置", error: String(e?.message || e) });
        }
      }
    }

    if (qinFinal.length) {
      const { toAdd } = partitionQinItemsForSync(qinFinal, slipOpts);
      const { singles, batches } = partitionQinBankerBatches(toAdd);
      const { batches: syncBatches, extraSingles } = expandBankerBatchesForSync(batches);
      for (const batch of syncBatches) {
        try {
          const stake = resolveBankerBatchStake(batch.items);
          if (stake == null) throw new Error("HKJC_BANKER_DUTCH_UNEQUAL");
          const { line, matcher } = appendQinBankerDragLineToPanel(raceNo, venueCode, batch);
          fillQueue.push(stakeFillEntry(line, stake, matcher));
          added += batch.items.length;
        } catch (e) {
          for (const it of batch.items) {
            errors.push({ combo: it.combo, type: "連贏", error: String(e?.message || e) });
          }
        }
      }
      for (const it of [...singles, ...extraSingles]) {
        const pair = parseQinCombo(it.combo);
        if (!pair) {
          errors.push({ combo: it.combo, type: "連贏", error: "INVALID_QIN_COMBO" });
          continue;
        }
        try {
          const { line, matcher } = appendQinPairLineToPanel(raceNo, venueCode, pair[0], pair[1]);
          fillQueue.push(stakeFillEntry(line, it.stakePerLine, matcher));
          added += 1;
        } catch (e) {
          errors.push({ combo: it.combo, type: "連贏", error: String(e?.message || e) });
        }
      }
    }

    if (qplFinal.length) {
      const { toAdd } = partitionQplItemsForSync(qplFinal, slipOpts);
      const { singles, batches } = partitionQinBankerBatches(toAdd);
      const { batches: syncBatches, extraSingles } = expandBankerBatchesForSync(batches);
      for (const batch of syncBatches) {
        try {
          const stake = resolveBankerBatchStake(batch.items);
          if (stake == null) throw new Error("HKJC_BANKER_DUTCH_UNEQUAL");
          const { line, matcher } = appendQplBankerDragLineToPanel(raceNo, venueCode, batch);
          fillQueue.push(stakeFillEntry(line, stake, matcher));
          added += batch.items.length;
        } catch (e) {
          for (const it of batch.items) {
            errors.push({ combo: it.combo, type: "位置Q", error: String(e?.message || e) });
          }
        }
      }
      for (const it of [...singles, ...extraSingles]) {
        const pair = parseQinCombo(it.combo);
        if (!pair) {
          errors.push({ combo: it.combo, type: "位置Q", error: "INVALID_QPL_COMBO" });
          continue;
        }
        try {
          const { line, matcher } = appendQplPairLineToPanel(raceNo, venueCode, pair[0], pair[1]);
          fillQueue.push(stakeFillEntry(line, it.stakePerLine, matcher));
          added += 1;
        } catch (e) {
          errors.push({ combo: it.combo, type: "位置Q", error: String(e?.message || e) });
        }
      }
    }

    if (fillQueue.length) {
      try {
        await fillStakeEntriesPhase2(fillQueue, slipAnchor);
      } catch (e) {
        errors.push({ combo: "", type: "", error: String(e?.code || e?.message || e) });
      }
    }

    notifyBetSlipChanged();

    if (errors.length === 0 && added > 0) {
      try {
        await verifySyncStakeTotalsIfNeeded(
          payload,
          slipBaseline,
          [...winFinal, ...plaFinal, ...qinFinal, ...qplFinal],
          qinFinal,
          qplFinal
        );
      } catch (e) {
        errors.push({ combo: "", type: "", error: String(e?.code || e?.message || e) });
      }
    }

    const syncedItems = [...winFinal, ...plaFinal, ...qinFinal, ...qplFinal];
    const skipGrandTotalVerify = shouldSkipGrandTotalVerify(payload, qinFinal, qplFinal);
    return {
      ok: errors.length === 0,
      added,
      skipped: 0,
      updated: 0,
      mode: "direct-slip-two-phase",
      appendOnly: true,
      skipGrandTotalVerify,
      winAdded: winFinal.length - errors.filter((e) => e.type === "獨贏").length,
      qinAdded: qinFinal.length - errors.filter((e) => e.type === "連贏").length,
      qplAdded: qplFinal.length - errors.filter((e) => e.type === "位置Q").length,
      stakeVerify: buildStakeVerifyForSync(
        payload,
        syncedItems,
        slipBaseline,
        qinFinal,
        qplFinal
      ),
      errors: errors.length ? errors : undefined,
    };
  }

  async function addQinBankerSinglePair(raceNo, banker, leg, stake, opts = {}) {
    const b = String(Number(banker));
    const l = String(Number(leg));
    const r = resolveWpqRaceNo(raceNo);

    if (!opts.poolReady) {
      await ensureQinPoolTab({ soft: true });
    } else if (!isWpqPoolReadyInUi() || !wpqSubTypeIs("QIN")) {
      await ensureQinPoolTab({ soft: false });
    }
    if (!opts.raceSettled) await ensureRaceReadyIfNeeded(r, { maxMs: 2500 });

    await uncheckWinExcept(raceNo, []);
    await uncheckQinTableForRace(raceNo, "QIN", opts);
    await sleep(isCrossAlupPage() ? 60 : 40);

    const bCb = findQinBankerCheckbox(r, b, "QIN");
    const lCb = findQinLegFootCheckbox(r, l, "QIN");
    if (!bCb || !lCb || !isCheckboxVisible(bCb) || !isCheckboxVisible(lCb)) {
      throw new Error(`MISSING_QIN_CHECKBOX:${b}-${l}`);
    }

    await setCheckboxChecked(bCb, true, 16);
    await setCheckboxChecked(lCb, true, 16);

    const waitOpts = { quick: Boolean(opts.poolReady), maxMs: opts.poolReady ? 2400 : 3200 };
    if (!(await waitWpqBankerSingleLegSelected(r, b, l, "QIN", waitOpts))) {
      throw new Error("HKJC_INSUFFICIENT_SELECTION:qin-banker");
    }

    const slipBefore = getBetLines().length;
    const matcher = qinPairLineMatcher(Number(b), Number(l));
    await appendPairToSlipAndFill(matcher, stake, slipBefore);
    return { added: 1 };
  }

  async function addQplBankerSinglePair(raceNo, banker, leg, stake, opts = {}) {
    const b = String(Number(banker));
    const l = String(Number(leg));
    const r = resolveWpqRaceNo(raceNo);

    await ensureWpqPoolReady({ soft: false });
    await ensureWpqSubType("QPL", { soft: false });
    if (!opts.raceSettled) await ensureRaceReadyIfNeeded(r, { maxMs: 2500 });

    await uncheckWinExcept(raceNo, []);
    await uncheckQinTableForRace(raceNo, "QPL", opts);
    await sleep(isCrossAlupPage() ? 60 : 40);

    const bCb = findQinBankerCheckbox(r, b, "QPL");
    const lCb = findQinLegFootCheckbox(r, l, "QPL");
    if (!bCb || !lCb || !isCheckboxVisible(bCb) || !isCheckboxVisible(lCb)) {
      throw new Error(`MISSING_QPL_CHECKBOX:${b}-${l}`);
    }

    await setCheckboxChecked(bCb, true, 16);
    await setCheckboxChecked(lCb, true, 16);

    const waitOpts = { quick: Boolean(opts.poolReady), maxMs: opts.poolReady ? 2400 : 3200 };
    if (!(await waitWpqBankerSingleLegSelected(r, b, l, "QPL", waitOpts))) {
      throw new Error("HKJC_INSUFFICIENT_SELECTION:qpl-banker");
    }

    const slipBefore = getBetLines().length;
    const matcher = qplPairLineMatcher(Number(b), Number(l));
    await appendPairToSlipAndFill(matcher, stake, slipBefore);
    return { added: 1 };
  }

  async function addQinPair(raceNo, combo, stake, opts = {}) {
    const pair = parseQinCombo(combo);
    if (!pair) throw new Error(`INVALID_QIN_COMBO:${combo}`);
    const [h1, h2] = pair;
    const r = resolveWpqRaceNo(raceNo);
    const useBox = opts.boxMode !== false;

    if (!opts.poolReady) {
      await ensureQinPoolTab({ soft: true });
    } else if (!isWpqPoolReadyInUi() || !wpqSubTypeIs("QIN")) {
      await ensureQinPoolTab({ soft: false });
    }
    if (!opts.raceSettled) await ensureRaceReadyIfNeeded(r, { maxMs: 2500 });

    if (useBox) {
      if (!opts.skipBoxPrep) {
        await prepareQinBoxPairSync(raceNo, { maxMs: opts.poolReady ? 2800 : 3200 });
      } else {
        await ensureWpqBoxBetMode();
        await ensureWpqRaceTableReady(r, { maxMs: 1800 });
        await sleep(isCrossAlupPage() ? 36 : 24);
      }
    }

    await uncheckWinExcept(raceNo, []);

    const slipBefore = getBetLines().length;
    const matcher = qinPairLineMatcher(h1, h2);

    if (useBox) {
      const sel = await selectWpqBoxPair(raceNo, h1, h2, "QIN", {
        maxMs: opts.poolReady ? 4800 : 5600,
        poolReady: opts.poolReady,
        skipInitialClear: opts.skipInitialClear,
      });
      if (!sel.ok) throw new Error(sel.code || "HKJC_INSUFFICIENT_SELECTION:qin");
      await completePairSlipStake(matcher, stake, slipBefore);
      await uncheckQinTableForRace(raceNo, "QIN", opts);
      await uncheckAllWpqBankers(raceNo, "QIN");
      return pairSlipResult();
    }

    await clearWpqPairSelection(raceNo, h1, h2, "QIN", opts);

    const waitOpts = { quick: Boolean(opts.poolReady), maxMs: opts.poolReady ? 1800 : 2600 };
    let lastErr = null;

    if (await clickQbPairCell("QIN", h1, h2)) {
      await requireWpqPairSelected(r, h1, h2, "QIN", waitOpts);
      try {
        await completePairSlipStake(matcher, stake, slipBefore);
        return pairSlipResult();
      } catch (e) {
        lastErr = e;
      }
    }

    const cb1 = findQinLegFootCheckbox(r, h1, "QIN");
    const cb2 = findQinLegFootCheckbox(r, h2, "QIN");
    if (!cb1 || !cb2 || !isCheckboxVisible(cb1) || !isCheckboxVisible(cb2)) {
      if (lastErr) throw lastErr;
      throw new Error(`MISSING_QIN_CHECKBOX:${h1}-${h2}`);
    }

    await setCheckboxChecked(cb1, true, 14);
    await setCheckboxChecked(cb2, true, 14);
    await requireWpqPairSelected(r, h1, h2, "QIN", waitOpts);

    try {
      await completePairSlipStake(matcher, stake, slipBefore);
      return pairSlipResult();
    } catch (e) {
      if (lastErr) throw lastErr;
      throw e;
    }
  }

  async function addQplPair(raceNo, combo, stake, opts = {}) {
    const pair = parseQinCombo(combo);
    if (!pair) throw new Error(`INVALID_QPL_COMBO:${combo}`);
    const [h1, h2] = pair;
    const r = resolveWpqRaceNo(raceNo);

    if (!wpqSubTypeIs("QPL")) {
      await ensureQplPoolTab({ soft: false });
    } else if (!opts.poolReady) {
      await ensureQplPoolTab({ soft: true });
    }
    if (!opts.raceSettled) await ensureRaceReadyIfNeeded(r, { maxMs: 2500 });

    if (opts.boxMode !== false) {
      await ensureWpqBoxBetMode();
    }

    await uncheckWinExcept(raceNo, []);

    const slipBefore = getBetLines().length;
    const matcher = qplPairLineMatcher(h1, h2);

    if (opts.boxMode !== false) {
      const sel = await selectWpqBoxPair(raceNo, h1, h2, "QPL", {
        maxMs: opts.poolReady ? 4200 : 5000,
        poolReady: opts.poolReady,
      });
      if (!sel.ok) throw new Error(sel.code || "HKJC_INSUFFICIENT_SELECTION:qpl");
      await completePairSlipStake(matcher, stake, slipBefore);
      await uncheckQinTableForRace(raceNo, "QPL", opts);
      await uncheckAllWpqBankers(raceNo, "QPL");
      return pairSlipResult();
    }

    await clearWpqPairSelection(raceNo, h1, h2, "QPL", opts);

    const waitOpts = { quick: Boolean(opts.poolReady), maxMs: opts.poolReady ? 1800 : 2600 };
    let lastErr = null;

    if (await clickQbPairCell("QPL", h1, h2)) {
      await requireWpqPairSelected(r, h1, h2, "QPL", waitOpts);
      try {
        await completePairSlipStake(matcher, stake, slipBefore);
        return pairSlipResult();
      } catch (e) {
        lastErr = e;
      }
    }

    const cb1 = findQinLegCheckbox(r, h1, "QPL");
    const cb2 = findQinLegCheckbox(r, h2, "QPL");
    if (!cb1 || !cb2 || !isCheckboxVisible(cb1) || !isCheckboxVisible(cb2)) {
      if (lastErr) throw lastErr;
      throw new Error(`MISSING_QPL_CHECKBOX:${h1}-${h2}`);
    }

    await setCheckboxChecked(cb1, true, 14);
    await setCheckboxChecked(cb2, true, 14);
    await requireWpqPairSelected(r, h1, h2, "QPL", waitOpts);

    try {
      await completePairSlipStake(matcher, stake, slipBefore);
      return pairSlipResult();
    } catch (e) {
      if (lastErr) throw lastErr;
      throw e;
    }
  }

  /**
   * 半自動：切到正確場次 → 勾選 → 填投注計算機 → 點「添加到投注區」（與人手一致）。
   */
  async function applySlipViaUserClicks(
    payload,
    winFinal,
    plaFinal,
    qinFinal,
    qplFinal,
    raceNo,
    venueCode,
    targetUrl
  ) {
    let syncPrep = buildSyncPrepState(Number(raceNo));
    try {
      syncPrep = await prepareHkjcUiForSync(
        payload,
        winFinal,
        plaFinal,
        qinFinal,
        qplFinal,
        raceNo,
        venueCode,
        targetUrl
      );
    } catch (e) {
      if (e?.code === "PAGE_MISMATCH") {
        return pageMismatchPayload(
          e.expectedUrl || targetUrl,
          e.expectedRace ?? raceNo,
          e.expected,
          e.actual
        );
      }
      throw e;
    }

    const errors = [];
    let added = 0;
    let skipped = 0;
    let updated = 0;
    const clickOpts = { alwaysAdd: true };
    const slipBaseline = captureSlipBaseline();

    if (winFinal.length) {
      const wr = await addWinHorsesBatch(raceNo, winFinal, venueCode, clickOpts);
      added += wr.added || 0;
      skipped += wr.skipped || 0;
      updated += wr.updated || 0;
      if (Array.isArray(wr.errors)) errors.push(...wr.errors);
    }

    if (plaFinal.length) {
      const pr = await addPlaHorsesBatch(raceNo, plaFinal, venueCode, clickOpts);
      added += pr.added || 0;
      skipped += pr.skipped || 0;
      updated += pr.updated || 0;
      if (Array.isArray(pr.errors)) errors.push(...pr.errors);
    }

    if (qinFinal.length) {
      const { toAdd, toUpdate, skipped: qSkip } = partitionQinItemsForSync(qinFinal, clickOpts);
      skipped += qSkip;
      for (const u of toUpdate) {
        await fillStakeOnLine(u.line, u.stake);
        updated += 1;
      }
      if (toAdd.length) {
        if (!syncPrep.qinSubTypeReady) {
          await ensureQinPoolTab({ soft: syncPrep.wpqReady });
        } else if (!isWpqPoolReadyInUi() || !wpqSubTypeIs("QIN")) {
          await ensureQinPoolTab({ soft: false });
        }
        const r = resolveWpqRaceNo(raceNo);
        if (!syncPrep.raceSettled) {
          await ensureRaceReadyIfNeeded(r, { maxMs: 2500 });
        }
        await ensureWpqRaceTableReady(r, { maxMs: syncPrep.raceSettled ? 1800 : 3000 });
        const { singles, batches } = partitionQinBankerBatches(toAdd);
        const { batches: syncBatches, extraSingles } = expandBankerBatchesForSync(batches);
        const qinSinglesList = [...singles, ...extraSingles];
        let bankerBetModeReady = syncPrep.qinBankerModeReady;
        const batchOpts = {
          poolReady: true,
          raceSettled: true,
          betModeReady: bankerBetModeReady,
        };
        if (qinSinglesList.length) {
          await prepareQinBoxPairSync(raceNo, { maxMs: 3000 });
        }
        for (const batch of syncBatches) {
          try {
            const qr = await addQinBankerDrag(raceNo, batch, {
              ...batchOpts,
              betModeReady: bankerBetModeReady,
            });
            bankerBetModeReady = true;
            added += qr?.added || 0;
          } catch (e) {
            for (const it of batch.items) {
              errors.push({ combo: it.combo, type: "連贏", error: String(e?.message || e) });
            }
          }
        }
        if (syncBatches.length && qinSinglesList.length) {
          await prepareQinBoxPairSync(raceNo, { maxMs: 2400 });
        }
        for (let qi = 0; qi < qinSinglesList.length; qi++) {
          const it = qinSinglesList[qi];
          try {
            const pairOpts = {
              ...batchOpts,
              /** 連贏「2-4」格式一律走複式腳欄勾選 */
              boxMode: true,
              skipInitialClear: qi > 0,
              skipBoxPrep: true,
            };
            const qr = await addQinPair(raceNo, it.combo, it.stakePerLine, pairOpts);
            if (qr?.skipped) skipped += 1;
            else added += qr?.added || 1;
          } catch (e) {
            errors.push({ combo: it.combo, type: "連贏", error: String(e?.message || e) });
          }
        }
        if (qinSinglesList.length || syncBatches.length) {
          await uncheckQinTableForRace(raceNo, "QIN", { quick: true });
          await uncheckAllWpqBankers(raceNo, "QIN");
        }
      }
    }

    if (qplFinal.length) {
      const { toAdd, toUpdate, skipped: qSkip } = partitionQplItemsForSync(qplFinal, clickOpts);
      skipped += qSkip;
      for (const u of toUpdate) {
        await fillStakeOnLine(u.line, u.stake);
        updated += 1;
      }
      if (toAdd.length) {
        if (!syncPrep.qplSubTypeReady) {
          await ensureQplPoolTab({ soft: syncPrep.wpqReady });
        } else if (!isWpqPoolReadyInUi() || !wpqSubTypeIs("QPL")) {
          await ensureQplPoolTab({ soft: false });
        }
        const r = resolveWpqRaceNo(raceNo);
        if (!syncPrep.raceSettled) {
          await ensureRaceReadyIfNeeded(r, { maxMs: 2500 });
        }
        await ensureWpqRaceTableReady(r, { maxMs: syncPrep.raceSettled ? 1800 : 3000 });
        const { singles, batches } = partitionQinBankerBatches(toAdd);
        const { batches: syncBatches, extraSingles } = expandBankerBatchesForSync(batches);
        const qplSinglesList = [...singles, ...extraSingles];
        const qplBatchOpts = { poolReady: true, raceSettled: true };
        if (qplSinglesList.length) {
          const switchedBox = await ensureWpqBoxBetMode();
          if (switchedBox) await sleep(100);
        }
        for (const batch of syncBatches) {
          try {
            const qr = await addQplBankerDrag(raceNo, batch, qplBatchOpts);
            added += qr?.added || 0;
          } catch (e) {
            for (const it of batch.items) {
              errors.push({ combo: it.combo, type: "位置Q", error: String(e?.message || e) });
            }
          }
        }
        if (syncBatches.length && qplSinglesList.length) {
          const switchedBox = await ensureWpqBoxBetMode();
          if (switchedBox) await sleep(120);
        }
        for (let qi = 0; qi < qplSinglesList.length; qi++) {
          const it = qplSinglesList[qi];
          try {
            const pairOpts = {
              ...qplBatchOpts,
              boxMode: true,
              skipInitialClear: qi > 0,
            };
            const qr = await addQplPair(raceNo, it.combo, it.stakePerLine, pairOpts);
            if (qr?.skipped) skipped += 1;
            else added += qr?.added || 1;
          } catch (e) {
            errors.push({ combo: it.combo, type: "位置Q", error: String(e?.message || e) });
          }
        }
        if (qplSinglesList.length || syncBatches.length) {
          await uncheckQinTableForRace(raceNo, "QPL", { quick: true });
          await uncheckAllWpqBankers(raceNo, "QPL");
        }
      }
    }

    if (errors.length === 0 && added > 0) {
      try {
        await verifySyncStakeTotalsIfNeeded(
          payload,
          slipBaseline,
          [...winFinal, ...plaFinal, ...qinFinal, ...qplFinal],
          qinFinal,
          qplFinal
        );
      } catch (e) {
        errors.push({
          combo: "",
          type: "",
          error: String(e?.code || e?.message || e),
        });
      }
    }

    const syncedItems = [...winFinal, ...plaFinal, ...qinFinal, ...qplFinal];
    const skipGrandTotalVerify = shouldSkipGrandTotalVerify(payload, qinFinal, qplFinal);
    syncDebug(
      `同步结束 added=${added} skipped=${skipped} errors=${errors.length} 投注区=${getBetLines().length}行`
    );
    return withSyncTrace({
      ok: errors.length === 0,
      added,
      skipped,
      updated,
      mode: "semi-auto-click-two-phase",
      appendOnly: true,
      skipGrandTotalVerify,
      winAdded: winFinal.length - errors.filter((e) => e.type === "獨贏").length,
      qinAdded: qinFinal.length - errors.filter((e) => e.type === "連贏").length,
      qplAdded: qplFinal.length - errors.filter((e) => e.type === "位置Q").length,
      stakeVerify: buildStakeVerifyForSync(
        payload,
        syncedItems,
        slipBaseline,
        qinFinal,
        qplFinal
      ),
      errors: errors.length ? errors : undefined,
    });
  }

  async function applySlip(payload) {
    setSyncDebug(payload?.syncDebug !== false);
    if (syncDebugOn) syncTraceLog.length = 0;

    const raceNo = Number(payload?.raceNo);
    const targetUrl = String(payload?.url || "");
    const winItems = (Array.isArray(payload?.winItems) ? payload.winItems : []).filter((it) =>
      isWinType(it?.type)
    );
    const plaItems = (Array.isArray(payload?.plaItems) ? payload.plaItems : []).filter((it) =>
      isPlaType(it?.type)
    );
    const qinItems = (Array.isArray(payload?.qinItems) ? payload.qinItems : []).filter((it) =>
      isQinType(it?.type)
    );
    const qplItems = (Array.isArray(payload?.qplItems) ? payload.qplItems : []).filter((it) =>
      isQplType(it?.type)
    );
    /** 僅在無分欄位時讀 items，避免與 popup 重複欄位導致同步兩遍 */
    const legacy = Array.isArray(payload?.items) ? payload.items : [];
    if (!winItems.length && !plaItems.length && !qinItems.length && !qplItems.length && legacy.length) {
      for (const it of legacy) {
        if (isWinType(it?.type)) winItems.push(it);
        else if (isPlaType(it?.type)) plaItems.push(it);
        else if (isQinType(it?.type)) qinItems.push(it);
        else if (isQplType(it?.type)) qplItems.push(it);
      }
    }

    /** 同組合同金額才去重；同馬/同組合不同金額保留多條 */
    const dedupeItems = (list) => {
      const seen = new Set();
      const out = [];
      for (const it of list) {
        const key = `${it.type}|${it.combo}|${normalizeStakeTen(it.stakePerLine)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(it);
      }
      return out;
    };
    let winFinal = dedupeItems(winItems);
    let plaFinal = dedupeItems(plaItems);
    let qinFinal = dedupeItems(qinItems);
    let qplFinal = dedupeItems(qplItems);
    ({ winFinal, plaFinal, qinFinal, qplFinal } = filterFinalsBySyncScope(
      payload?.syncScope,
      winFinal,
      plaFinal,
      qinFinal,
      qplFinal
    ));

    if (!Number.isFinite(raceNo) || raceNo < 1) {
      return { ok: false, error: "INVALID_RACE_NO" };
    }
    if (!winFinal.length && !plaFinal.length && !qinFinal.length && !qplFinal.length) {
      return { ok: false, error: "NO_SYNC_ITEMS" };
    }

    const venueCode = String(payload?.venueCode ?? parseHkjcRacePath(targetUrl)?.venue ?? "").trim();

    syncDebug(`开始同步 v${SCRIPT_VERSION}`, {
      race: raceNo,
      venue: venueCode,
      win: winFinal.length,
      pla: plaFinal.length,
      qin: qinFinal.length,
      qpl: qplFinal.length,
      url: targetUrl,
    });

    if (payload.slipOnly === true) {
      return withSyncTrace(
        await applySlipDirectPanel(payload, winFinal, plaFinal, qinFinal, qplFinal, raceNo, venueCode)
      );
    }

    /** 預設走官網 5 步點擊；僅 preferDirectPanel===true 時才嘗試 Direct Panel */
    const directEligible =
      payload.preferDirectPanel === true &&
      canUseDirectPanelSync(payload, raceNo, targetUrl) &&
      !qinFinal.length &&
      !qplFinal.length;
    if (directEligible) {
      try {
        const direct = await applySlipDirectPanel(
          payload,
          winFinal,
          plaFinal,
          qinFinal,
          qplFinal,
          raceNo,
          venueCode
        );
        if (direct.ok && direct.added > 0) {
          direct.mode = "direct-slip-primary";
          return direct;
        }
        if ((direct.added || 0) > 0) {
          direct.mode = "direct-slip-primary-partial";
          return direct;
        }
        removeRacepluginInjectedLines();
      } catch {
        removeRacepluginInjectedLines();
      }
    }

    const clickRes = await applySlipViaUserClicks(
      payload,
      winFinal,
      plaFinal,
      qinFinal,
      qplFinal,
      raceNo,
      venueCode,
      targetUrl
    );
    if (clickRes.error === "PAGE_MISMATCH") return withSyncTrace(clickRes);
    if (clickRes.added > 0 || clickRes.ok) return clickRes;

    if (
      payload.allowDirectFallback === true &&
      payload.strictSamePage === false &&
      document.querySelector("#betslip-panel")
    ) {
      try {
        const direct = await applySlipDirectPanel(
          payload,
          winFinal,
          plaFinal,
          qinFinal,
          qplFinal,
          raceNo,
          venueCode
        );
        direct.mode = "direct-slip-fallback";
        direct.clickErrors = clickRes.errors;
        return direct;
      } catch {
        /* 保留點擊路徑錯誤 */
      }
    }
    return withSyncTrace(clickRes);
  }
})();
