/** 將 popup 的注單同步請求轉發至 bet.hkjc.com 分頁的 content script */
const HKJC_ORIGIN = "https://bet.hkjc.com";
/** 與 content-hkjc.js 的 SCRIPT_VERSION 保持一致；不符則強制重新注入 */
const HKJC_CONTENT_SCRIPT_VERSION = 44;
const PANEL_PAGE = "popup.html";

/** 類 MetaMask：點工具欄圖標打開 Chrome 右側邊欄，不遮擋馬會頁中央 */
async function initSidePanel() {
  if (!chrome.sidePanel?.setPanelBehavior) return;
  try {
    await chrome.sidePanel.setOptions({ path: PANEL_PAGE, enabled: true });
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (e) {
    console.warn("[raceplugin] sidePanel init:", e);
  }
}

/** 寬屏獨立窗（原 popup 800×600 佈局）；可拖到馬會頁右側，不遮擋主頁 */
const WIDE_PANEL_WIDTH = 880;
const WIDE_PANEL_HEIGHT = 820;

async function openDetachedPanelWindow(width = WIDE_PANEL_WIDTH, height = WIDE_PANEL_HEIGHT) {
  const panelUrl = chrome.runtime.getURL(PANEL_PAGE);
  const wins = await chrome.windows.getAll({ windowTypes: ["popup"] });
  for (const w of wins) {
    if (!w.id) continue;
    const tabs = await chrome.tabs.query({ windowId: w.id });
    if (tabs.some((t) => t.url === panelUrl)) {
      await chrome.windows.update(w.id, { focused: true, width, height });
      return;
    }
  }
  await chrome.windows.create({
    url: panelUrl,
    type: "popup",
    width,
    height,
    focused: true,
  });
}

chrome.runtime.onInstalled.addListener(() => {
  void initSidePanel();
});
chrome.runtime.onStartup.addListener(() => {
  void initSidePanel();
});
void initSidePanel();

chrome.action.onClicked.addListener((tab) => {
  if (chrome.sidePanel?.open && tab?.id != null) {
    void chrome.sidePanel.open({ tabId: tab.id }).catch(() => openDetachedPanelWindow());
    return;
  }
  void openDetachedPanelWindow();
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "OPEN_WIDE_PANEL") {
    void openDetachedPanelWindow(msg.width, msg.height)
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }));
    return true;
  }
  if (msg?.type === "OPEN_HKJC_TAB") {
    void (async () => {
      const targetUrl = String(msg.payload?.url || "").trim();
      if (!targetUrl.startsWith(HKJC_ORIGIN)) {
        sendResponse({ ok: false, error: "INVALID_URL" });
        return;
      }
      sendResponse(
        await openHkjcTabIfMissing(targetUrl, { activateTab: Boolean(msg.payload?.activateTab) })
      );
    })().catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }));
    return true;
  }
  if (msg?.type !== "SYNC_TO_HKJC") return false;
  void handleSyncToHkjc(msg.payload)
    .then(sendResponse)
    .catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }));
  return true;
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 解析 /ch/racing/{segment}/{date}/{venue}/{race}
 * segment 可為 wp、wpq（連贏/位置Q）、cross_alup 等，同步時不比對 segment。
 */
function parseHkjcRacePath(url) {
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

/** 同日、同馬場、同場次即可（wp / wpq 視為同一場） */
function urlsMatchRace(tabUrl, targetUrl) {
  const a = parseHkjcRacePath(tabUrl || "");
  const b = parseHkjcRacePath(targetUrl || "");
  return Boolean(
    a && b && a.date === b.date && a.venue === b.venue && String(a.race) === String(b.race)
  );
}

function urlsMatchMeeting(tabUrl, targetUrl) {
  const a = parseHkjcRacePath(tabUrl || "");
  const b = parseHkjcRacePath(targetUrl || "");
  return Boolean(a && b && a.date === b.date && a.venue === b.venue);
}

function isHkjcBetUrl(url) {
  return typeof url === "string" && url.startsWith(HKJC_ORIGIN);
}

function waitForTabComplete(tabId, timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();

    const listener = (id, info) => {
      if (id !== tabId) return;
      if (info.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      } else if (Date.now() - started > timeoutMs) {
        chrome.tabs.onUpdated.removeListener(listener);
        reject(new Error("TAB_LOAD_TIMEOUT"));
      }
    };

    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) {
        chrome.tabs.onUpdated.removeListener(listener);
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (tab?.status === "complete" && isHkjcBetUrl(tab.url)) {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    });
  });
}

async function waitForHkjcUrl(tabId, targetUrl, timeoutMs = 45000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const tab = await chrome.tabs.get(tabId);
    if (isHkjcBetUrl(tab.url)) return tab;
    await sleep(300);
  }
  throw new Error("TAB_LOAD_TIMEOUT");
}

function urlsMatchSameDay(tabUrl, targetUrl) {
  const a = parseHkjcRacePath(tabUrl || "");
  const b = parseHkjcRacePath(targetUrl || "");
  return Boolean(a && b && a.date === b.date);
}

/** 嚴格同頁：優先使用已與目標場次一致的 bet.hkjc.com 分頁，不自動改 URL */
async function findHkjcTabForSync(targetUrl, activateTab) {
  const tabs = await chrome.tabs.query({ url: `${HKJC_ORIGIN}/*` });
  const onOrigin = tabs.filter((t) => isHkjcBetUrl(t.url));
  const raceReady = onOrigin.filter((t) => parseHkjcRacePath(t.url));
  const matched = raceReady.find((t) => urlsMatchRace(t.url, targetUrl));
  if (matched?.id) {
    if (activateTab) await chrome.tabs.update(matched.id, { active: true });
    return { tab: matched, pageMatch: true };
  }
  const meetingMatched = raceReady.find((t) => urlsMatchMeeting(t.url, targetUrl));
  if (meetingMatched?.id) {
    if (activateTab) await chrome.tabs.update(meetingMatched.id, { active: true });
    return { tab: meetingMatched, pageMatch: false, meetingMatch: true };
  }
  const sameDay = raceReady.find((t) => urlsMatchSameDay(t.url, targetUrl));
  if (sameDay?.id) {
    if (activateTab) await chrome.tabs.update(sameDay.id, { active: true });
    return { tab: sameDay, pageMatch: false, sameDayMatch: true };
  }
  const preferred = onOrigin.find((t) => t.active) || onOrigin[0] || tabs[0];
  if (preferred?.id) return { tab: preferred, pageMatch: false };
  return { tab: null, pageMatch: false };
}

function pageMismatchResponse(tab, targetUrl, payload) {
  const expected = parseHkjcRacePath(targetUrl);
  const actual = parseHkjcRacePath(tab?.url || "");
  return {
    ok: false,
    error: "PAGE_MISMATCH",
    expectedUrl: targetUrl,
    tabUrl: tab?.url || "",
    expectedRace: Number(payload?.raceNo),
    expected,
    actual,
  };
}

async function clearHkjcContentFlags(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        delete window.__racepluginHkjc_v1;
        delete window.__racepluginHkjcContent;
        delete window.__racepluginHkjcOnMessage;
      },
    });
  } catch {
    /* 頁面尚未可腳本化時忽略 */
  }
}

async function injectHkjcContentScript(tabId) {
  await clearHkjcContentFlags(tabId);
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content-hkjc.js"],
  });
}

async function pingContentScript(tabId) {
  try {
    const pong = await chrome.tabs.sendMessage(tabId, { type: "HKJC_PING" });
    return Boolean(pong?.ok && Number(pong.v) === HKJC_CONTENT_SCRIPT_VERSION);
  } catch {
    return false;
  }
}

/** 確保分頁已載入且 content script 為最新版（必要時程式化注入） */
async function ensureHkjcContentScript(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (!isHkjcBetUrl(tab.url)) return false;

  if (await pingContentScript(tabId)) return true;

  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      await injectHkjcContentScript(tabId);
    } catch {
      /* 可能仍在載入 */
    }
    await sleep(400 + attempt * 150);
    if (await pingContentScript(tabId)) return true;
  }
  return false;
}

async function sendToContent(tabId, payload) {
  const ready = await ensureHkjcContentScript(tabId);
  if (!ready) throw new Error("CONTENT_SCRIPT_UNAVAILABLE");

  try {
    return await chrome.tabs.sendMessage(tabId, { type: "HKJC_APPLY_SLIP", payload });
  } catch (e) {
    const msg = String(e?.message || e);
    if (/receiving end does not exist|could not establish connection/i.test(msg)) {
      await injectHkjcContentScript(tabId);
      await sleep(500);
      return await chrome.tabs.sendMessage(tabId, { type: "HKJC_APPLY_SLIP", payload });
    }
    throw e;
  }
}

/** 若尚無 bet.hkjc.com 分頁則新建（與「同步到馬會」相同策略，不搶焦點） */
async function openHkjcTabIfMissing(targetUrl, options = {}) {
  const activateTab = Boolean(options.activateTab);
  const { tab } = await findHkjcTabForSync(targetUrl, activateTab);
  if (tab?.id) {
    return { ok: true, opened: false, tabId: tab.id, tabUrl: tab.url || "" };
  }
  const newTab = await chrome.tabs.create({ url: targetUrl, active: activateTab });
  await waitForTabComplete(newTab.id);
  await waitForHkjcUrl(newTab.id, targetUrl);
  return { ok: true, opened: true, tabId: newTab.id, tabUrl: targetUrl };
}

async function handleSyncToHkjc(payload) {
  const targetUrl = String(payload?.url || "").trim();
  if (!targetUrl.startsWith(HKJC_ORIGIN)) {
    return { ok: false, error: "INVALID_URL" };
  }

  /** 預設不切換分頁，避免搶焦點導致擴展 popup 自動關閉 */
  const activateTab = Boolean(payload?.activateHkjcTab);
  const strictSamePage = payload?.strictSamePage !== false;

  let { tab, pageMatch } = await findHkjcTabForSync(targetUrl, activateTab);

  if (!tab?.id) {
    if (payload?.openHkjcIfMissing !== false) {
      const opened = await openHkjcTabIfMissing(targetUrl, { activateTab });
      tab = await chrome.tabs.get(opened.tabId);
      pageMatch = true;
    } else {
      return { ok: false, error: "NO_HKJC_TAB", expectedUrl: targetUrl };
    }
  }

  /** 僅日期不同時拒絕；馬場／場次交由 content 點 #venue_* / #raceno_N（不清投注區） */
  if (strictSamePage && !urlsMatchSameDay(tab.url, targetUrl)) {
    return pageMismatchResponse(tab, targetUrl, payload);
  }

  if (activateTab && tab.id) {
    await chrome.tabs.update(tab.id, { active: true });
  }

  const path = parseHkjcRacePath(targetUrl);
  const sameRace = urlsMatchRace(tab.url, targetUrl);
  const sameMeeting = urlsMatchMeeting(tab.url, targetUrl);
  const settleMs = path?.segment === "cross_alup" ? 800 : sameRace ? 100 : sameMeeting ? 350 : 600;
  await sleep(settleMs);
  const result = await sendToContent(tab.id, payload);
  return result ?? { ok: false, error: "EMPTY_RESPONSE" };
}
