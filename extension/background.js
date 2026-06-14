/** 將 popup 的注單同步請求轉發至 bet.hkjc.com 分頁的 content script */
const HKJC_ORIGIN = "https://bet.hkjc.com";
/** 與 content-hkjc.js 的 SCRIPT_VERSION 保持一致；不符則強制重新注入 */
const HKJC_CONTENT_SCRIPT_VERSION = 95;
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
  if (msg?.type === "VERIFY_HKJC_STAKE") {
    void handleVerifyHkjcStake(msg.payload)
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }));
    return true;
  }
  if (msg?.type === "HKJC_MAIN_WORLD_OP") {
    const tabId = _sender?.tab?.id;
    if (!tabId) {
      sendResponse({ ok: false, error: "NO_TAB" });
      return false;
    }
    void executeMainWorldDomOp(tabId, msg.op)
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }));
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
  if (!a?.date || !b?.date) return true;
  return a.date === b.date;
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
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: () => {
        delete window.__racepluginMainBridgeInstalled;
      },
    });
  } catch {
    /* 頁面尚未可腳本化時忽略 */
  }
}

function runRacepluginMainWorldDomOp(op) {
  function pointerClick(target) {
    if (!target) return;
    try {
      target.scrollIntoView({ block: "nearest", inline: "nearest" });
    } catch {
      /* ignore */
    }
    const rect = target.getBoundingClientRect();
    const x = rect.left + Math.min(Math.max(rect.width / 2, 1), Math.max(rect.width - 1, 1));
    const y = rect.top + Math.min(Math.max(rect.height / 2, 1), Math.max(rect.height - 1, 1));
    const base = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: x,
      clientY: y,
      button: 0,
      buttons: 1,
    };
    try {
      target.dispatchEvent(
        new PointerEvent("pointerdown", {
          ...base,
          pointerId: 1,
          pointerType: "mouse",
          isPrimary: true,
        })
      );
    } catch {
      /* ignore */
    }
    target.dispatchEvent(new MouseEvent("mousedown", base));
    try {
      target.dispatchEvent(
        new PointerEvent("pointerup", {
          ...base,
          pointerId: 1,
          pointerType: "mouse",
          isPrimary: true,
        })
      );
    } catch {
      /* ignore */
    }
    target.dispatchEvent(new MouseEvent("mouseup", base));
    target.dispatchEvent(new MouseEvent("click", base));
  }

  function resetTracker(input) {
    const tracker = input?._valueTracker;
    if (tracker) {
      try {
        tracker.setValue(String(input.value ?? ""));
      } catch {
        /* ignore */
      }
    }
  }

  function reactSetInput(input, value) {
    const desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
    if (!desc?.set) return false;
    resetTracker(input);
    desc.set.call(input, String(value));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  function reactTypeInput(input, value) {
    const desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
    if (!desc?.set) return "";
    const text = String(value ?? "").replace(/[^\d]/g, "");
    try {
      input.focus();
      pointerClick(input);
      input.select?.();
    } catch {
      /* ignore */
    }
    resetTracker(input);
    desc.set.call(input, "");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    let acc = "";
    for (const ch of text) {
      const code = ch.charCodeAt(0);
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: ch,
          code: `Digit${ch}`,
          keyCode: code,
          which: code,
          bubbles: true,
          cancelable: true,
        })
      );
      acc += ch;
      resetTracker(input);
      desc.set.call(input, acc);
      try {
        input.dispatchEvent(
          new InputEvent("input", {
            bubbles: true,
            cancelable: true,
            data: ch,
            inputType: "insertText",
          })
        );
      } catch {
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
      input.dispatchEvent(
        new KeyboardEvent("keyup", {
          key: ch,
          code: `Digit${ch}`,
          keyCode: code,
          which: code,
          bubbles: true,
          cancelable: true,
        })
      );
    }
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return String(input.value ?? "").replace(/[^\d]/g, "");
  }

  function getReactProps(node) {
    if (!node || typeof node !== "object") return null;
    const key = Object.keys(node).find((k) => k.startsWith("__reactProps$"));
    return key ? node[key] : null;
  }

  /** 直接调用 React onInput/onChange/onBlur，比 focus-blur 更易更新 slip 状态 */
  function reactInputCommit(input, value, opts = {}) {
    const text = String(value ?? "").replace(/[^\d]/g, "");
    if (!input) return { ok: false, error: "NO_INPUT" };
    reactTypeInput(input, text);
    const props = getReactProps(input);
    const ev = {
      target: input,
      currentTarget: input,
      type: "input",
      bubbles: true,
      cancelable: true,
      preventDefault: () => {},
      stopPropagation: () => {},
    };
    if (props?.onInput) {
      try {
        props.onInput(ev);
      } catch {
        /* ignore */
      }
    }
    if (props?.onChange) {
      try {
        props.onChange({ ...ev, type: "change" });
      } catch {
        /* ignore */
      }
    }
    if (opts.blur !== false) {
      try {
        input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      } catch {
        /* ignore */
      }
      if (props?.onBlur) {
        try {
          props.onBlur({ ...ev, type: "blur" });
        } catch {
          /* ignore */
        }
      }
      try {
        input.blur();
      } catch {
        /* ignore */
      }
    }
    return { ok: true, hadProps: Boolean(props), value: text };
  }

  if (op?.type === "react-input-commit") {
    const input =
      (op.inputId ? document.getElementById(op.inputId) : null) ||
      (op.tempId ? document.getElementById(op.tempId) : null);
    if (!input) return { ok: false, error: "NO_INPUT" };
    return reactInputCommit(input, op.value, { blur: op.blur !== false });
  }

  if (op?.type === "calc-add-sequence") {
    const input = op.inputId ? document.getElementById(op.inputId) : null;
    const addBtn = op.addId ? document.getElementById(op.addId) : null;
    if (!input || !addBtn) return { ok: false, error: "NO_CALC_OR_ADD" };
    try {
      input.scrollIntoView({ block: "nearest", inline: "nearest" });
    } catch {
      /* ignore */
    }
    input.focus();
    input.click();
    try {
      addBtn.scrollIntoView({ block: "nearest", inline: "nearest" });
    } catch {
      /* ignore */
    }
    addBtn.click();
    return { ok: true };
  }

  if (op?.type === "focus-blur-retype") {
    const input = op.inputId ? document.getElementById(op.inputId) : null;
    const outside = op.outsideId ? document.getElementById(op.outsideId) : null;
    if (!input) return { ok: false, error: "NO_INPUT" };
    const text = String(op.value ?? "").replace(/[^\d]/g, "");
    reactTypeInput(input, text);
    if (outside) {
      pointerClick(outside);
    } else {
      try {
        input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      } catch {
        /* ignore */
      }
      input.blur();
    }
    return { ok: true, value: String(input.value ?? "").replace(/[^\d]/g, "") };
  }

  if (op?.type === "focus-blur") {
    const input = op.inputId ? document.getElementById(op.inputId) : null;
    const outside = op.outsideId ? document.getElementById(op.outsideId) : null;
    if (!input) return { ok: false, error: "NO_INPUT" };
    try {
      input.scrollIntoView({ block: "nearest", inline: "nearest" });
    } catch {
      /* ignore */
    }
    input.focus();
    pointerClick(input);
    if (outside) {
      pointerClick(outside);
    } else {
      input.blur();
    }
    return { ok: true };
  }

  const el = op?.tempId ? document.getElementById(op.tempId) : null;
  if (!el) return { ok: false, error: "NO_ELEMENT" };

  function resetTracker(input) {
    const tracker = input?._valueTracker;
    if (tracker) {
      try {
        tracker.setValue(String(input.value ?? ""));
      } catch {
        /* ignore */
      }
    }
  }

  function reactSetInput(input, value) {
    const desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
    if (!desc?.set) return false;
    resetTracker(input);
    desc.set.call(input, String(value));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  function reactTypeInput(input, value) {
    const desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
    if (!desc?.set) return "";
    const text = String(value ?? "").replace(/[^\d]/g, "");
    try {
      input.focus();
      input.click();
      input.select?.();
    } catch {
      /* ignore */
    }
    resetTracker(input);
    desc.set.call(input, "");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    let acc = "";
    for (const ch of text) {
      const code = ch.charCodeAt(0);
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: ch,
          code: `Digit${ch}`,
          keyCode: code,
          which: code,
          bubbles: true,
          cancelable: true,
        })
      );
      acc += ch;
      resetTracker(input);
      desc.set.call(input, acc);
      try {
        input.dispatchEvent(
          new InputEvent("input", {
            bubbles: true,
            cancelable: true,
            data: ch,
            inputType: "insertText",
          })
        );
      } catch {
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
      input.dispatchEvent(
        new KeyboardEvent("keyup", {
          key: ch,
          code: `Digit${ch}`,
          keyCode: code,
          which: code,
          bubbles: true,
          cancelable: true,
        })
      );
    }
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return String(input.value ?? "").replace(/[^\d]/g, "");
  }

  function reactCommitInput(input) {
    try {
      input.focus();
    } catch {
      /* ignore */
    }
    const base = { bubbles: true, cancelable: true };
    input.dispatchEvent(
      new KeyboardEvent("keydown", { ...base, key: "Enter", code: "Enter", keyCode: 13, which: 13 })
    );
    input.dispatchEvent(
      new KeyboardEvent("keyup", { ...base, key: "Enter", code: "Enter", keyCode: 13, which: 13 })
    );
    input.dispatchEvent(new Event("change", { bubbles: true }));
    try {
      input.blur();
    } catch {
      /* ignore */
    }
  }

  function reactInsertTextInput(input, value) {
    const text = String(value ?? "").replace(/[^\d]/g, "");
    try {
      input.focus();
      input.click();
      input.select?.();
    } catch {
      /* ignore */
    }
    const tracker = input?._valueTracker;
    if (tracker) {
      try {
        tracker.setValue(String(input.value ?? ""));
      } catch {
        /* ignore */
      }
    }
    let inserted = false;
    try {
      inserted = document.execCommand("insertText", false, text);
    } catch {
      inserted = false;
    }
    if (!inserted) return reactTypeInput(input, text);
    try {
      input.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          cancelable: true,
          data: text,
          inputType: "insertText",
        })
      );
    } catch {
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return String(input.value ?? "").replace(/[^\d]/g, "");
  }

  function reactClick(target) {
    try {
      target.scrollIntoView({ block: "nearest", inline: "nearest" });
    } catch {
      /* ignore */
    }
    try {
      target.click();
    } catch {
      const base = { bubbles: true, cancelable: true, view: window };
      target.dispatchEvent(new MouseEvent("click", base));
    }
  }

  if (op.type === "set-input") {
    reactSetInput(el, op.value);
    return { ok: true, value: String(el.value ?? "") };
  }
  if (op.type === "type-input") {
    const value = reactTypeInput(el, op.value);
    return { ok: true, value };
  }
  if (op.type === "commit-input") {
    reactCommitInput(el);
    return { ok: true, value: String(el.value ?? "") };
  }
  if (op.type === "insert-text") {
    const value = reactInsertTextInput(el, op.value);
    return { ok: true, value };
  }
  if (op.type === "click") {
    reactClick(el);
    return { ok: true };
  }
  return { ok: false, error: "UNKNOWN_OP" };
}

async function executeMainWorldDomOp(tabId, op) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: runRacepluginMainWorldDomOp,
    args: [op],
  });
  return result?.result ?? { ok: false, error: "EMPTY_RESULT" };
}

function installRacepluginMainWorldBridge() {
  if (window.__racepluginMainBridgeInstalled) return;
  window.__racepluginMainBridgeInstalled = true;

  function reactSetInput(el, value) {
    const desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
    if (!desc?.set) return false;
    const tracker = el._valueTracker;
    if (tracker) {
      try {
        tracker.setValue(el.value);
      } catch {
        /* ignore */
      }
    }
    desc.set.call(el, String(value));
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  function reactTypeInput(el, value) {
    const desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
    if (!desc?.set) return "";
    const text = String(value ?? "").replace(/[^\d]/g, "");
    try {
      el.focus();
      el.click();
      el.select?.();
    } catch {
      /* ignore */
    }
    const tracker = el._valueTracker;
    if (tracker) {
      try {
        tracker.setValue(el.value);
      } catch {
        /* ignore */
      }
    }
    desc.set.call(el, "");
    el.dispatchEvent(new Event("input", { bubbles: true }));
    let acc = "";
    for (const ch of text) {
      const code = ch.charCodeAt(0);
      el.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: ch,
          code: `Digit${ch}`,
          keyCode: code,
          which: code,
          bubbles: true,
          cancelable: true,
        })
      );
      acc += ch;
      if (tracker) {
        try {
          tracker.setValue(el.value);
        } catch {
          /* ignore */
        }
      }
      desc.set.call(el, acc);
      try {
        el.dispatchEvent(
          new InputEvent("input", {
            bubbles: true,
            cancelable: true,
            data: ch,
            inputType: "insertText",
          })
        );
      } catch {
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }
      el.dispatchEvent(
        new KeyboardEvent("keyup", {
          key: ch,
          code: `Digit${ch}`,
          keyCode: code,
          which: code,
          bubbles: true,
          cancelable: true,
        })
      );
    }
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return String(el.value ?? "").replace(/[^\d]/g, "");
  }

  function reactCommitInput(el) {
    try {
      el.focus();
    } catch {
      /* ignore */
    }
    const base = { bubbles: true, cancelable: true };
    el.dispatchEvent(
      new KeyboardEvent("keydown", { ...base, key: "Enter", code: "Enter", keyCode: 13, which: 13 })
    );
    el.dispatchEvent(
      new KeyboardEvent("keyup", { ...base, key: "Enter", code: "Enter", keyCode: 13, which: 13 })
    );
    el.dispatchEvent(new Event("change", { bubbles: true }));
    try {
      el.blur();
    } catch {
      /* ignore */
    }
  }

  function reactInsertTextInput(el, value) {
    const text = String(value ?? "").replace(/[^\d]/g, "");
    try {
      el.focus();
      el.click();
      el.select?.();
    } catch {
      /* ignore */
    }
    const tracker = el._valueTracker;
    if (tracker) {
      try {
        tracker.setValue(String(el.value ?? ""));
      } catch {
        /* ignore */
      }
    }
    let inserted = false;
    try {
      inserted = document.execCommand("insertText", false, text);
    } catch {
      inserted = false;
    }
    if (!inserted) return reactTypeInput(el, text);
    try {
      el.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          cancelable: true,
          data: text,
          inputType: "insertText",
        })
      );
    } catch {
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return String(el.value ?? "").replace(/[^\d]/g, "");
  }

  function reactClick(el) {
    try {
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
    } catch {
      /* ignore */
    }
    try {
      el.click();
    } catch {
      el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    }
  }

  function getReactProps(node) {
    if (!node || typeof node !== "object") return null;
    const key = Object.keys(node).find((k) => k.startsWith("__reactProps$"));
    return key ? node[key] : null;
  }

  function reactInputCommit(input, value, opts = {}) {
    const text = String(value ?? "").replace(/[^\d]/g, "");
    if (!input) return false;
    reactTypeInput(input, text);
    const props = getReactProps(input);
    const ev = {
      target: input,
      currentTarget: input,
      type: "input",
      bubbles: true,
      cancelable: true,
      preventDefault: () => {},
      stopPropagation: () => {},
    };
    if (props?.onInput) {
      try {
        props.onInput(ev);
      } catch {
        /* ignore */
      }
    }
    if (props?.onChange) {
      try {
        props.onChange({ ...ev, type: "change" });
      } catch {
        /* ignore */
      }
    }
    if (opts.blur !== false) {
      try {
        input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      } catch {
        /* ignore */
      }
      if (props?.onBlur) {
        try {
          props.onBlur({ ...ev, type: "blur" });
        } catch {
          /* ignore */
        }
      }
      try {
        input.blur();
      } catch {
        /* ignore */
      }
    }
    return true;
  }

  document.addEventListener("raceplugin-main-set-input", (ev) => {
    const { tempId, value, type } = ev.detail || {};
    const el = tempId ? document.getElementById(tempId) : null;
    if (!el) return;
    if (type === "react-input-commit") reactInputCommit(el, value);
    else if (type === "type-input") reactTypeInput(el, value);
    else if (type === "insert-text") reactInsertTextInput(el, value);
    else if (type === "commit-input") reactCommitInput(el);
    else reactSetInput(el, value);
  });

  document.addEventListener("raceplugin-main-click", (ev) => {
    const { tempId } = ev.detail || {};
    const el = tempId ? document.getElementById(tempId) : null;
    if (el) reactClick(el);
  });

  const MAIN_OP_ATTR = "data-raceplugin-main-op";
  const handleMainOp = (raw) => {
    if (!raw) return;
    let op;
    try {
      op = JSON.parse(raw);
    } catch {
      return;
    }
    const el = op.tempId ? document.getElementById(op.tempId) : null;
    if (!el) return;
    if (op.type === "set-input") reactSetInput(el, op.value);
    else if (op.type === "react-input-commit") reactInputCommit(el, op.value, { blur: op.blur !== false });
    else if (op.type === "type-input") reactTypeInput(el, op.value);
    else if (op.type === "commit-input") reactCommitInput(el);
    else if (op.type === "insert-text") reactInsertTextInput(el, op.value);
    else if (op.type === "click") reactClick(el);
  };

  new MutationObserver((records) => {
    for (const r of records) {
      if (r.type !== "attributes" || r.attributeName !== MAIN_OP_ATTR) continue;
      const raw = document.documentElement.getAttribute(MAIN_OP_ATTR);
      document.documentElement.removeAttribute(MAIN_OP_ATTR);
      handleMainOp(raw);
    }
  }).observe(document.documentElement, { attributes: true, attributeFilter: [MAIN_OP_ATTR] });
}

async function injectHkjcContentScript(tabId) {
  await clearHkjcContentFlags(tabId);
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: installRacepluginMainWorldBridge,
    });
  } catch {
    /* 頁面尚未可腳本化時忽略 */
  }
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

async function navigateHkjcTabToUrl(tabId, targetUrl) {
  await chrome.tabs.update(tabId, { url: targetUrl });
  await waitForTabComplete(tabId);
  await waitForHkjcUrl(tabId, targetUrl);
  await ensureHkjcContentScript(tabId);
  const path = parseHkjcRacePath(targetUrl);
  await sleep(path?.segment === "cross_alup" ? 1400 : 850);
  return chrome.tabs.get(tabId);
}

async function sendToContent(tabId, payload) {
  const maxAttempts = 3;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const ready = await ensureHkjcContentScript(tabId);
    if (!ready) throw new Error("CONTENT_SCRIPT_UNAVAILABLE");

    try {
      return await chrome.tabs.sendMessage(tabId, { type: "HKJC_APPLY_SLIP", payload });
    } catch (e) {
      const msg = String(e?.message || e);
      const retriable =
        /receiving end does not exist|could not establish connection|back\/forward cache|message channel is closed/i.test(
          msg
        );
      if (!retriable || attempt >= maxAttempts - 1) throw e;
      await sleep(700 + attempt * 350);
      await ensureHkjcContentScript(tabId);
    }
  }
  throw new Error("CONTENT_SCRIPT_UNAVAILABLE");
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

async function handleVerifyHkjcStake(payload) {
  const targetUrl = String(payload?.url || "").trim();
  if (!targetUrl.startsWith(HKJC_ORIGIN)) {
    return { ok: false, error: "INVALID_URL" };
  }
  const { tab } = await findHkjcTabForSync(targetUrl, false);
  if (!tab?.id) {
    return { ok: false, error: "NO_HKJC_TAB", expectedUrl: targetUrl };
  }
  const ready = await ensureHkjcContentScript(tab.id);
  if (!ready) {
    return { ok: false, error: "CONTENT_SCRIPT_UNAVAILABLE" };
  }
  try {
    const result = await chrome.tabs.sendMessage(tab.id, {
      type: "HKJC_VERIFY_STAKE",
      payload,
    });
    return result ?? { ok: false, error: "EMPTY_RESPONSE" };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
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

  /** 分页 URL 与目标场次不一致时，由 background 整页导航（content 内 assign 会断开消息通道） */
  if (tab?.id && targetUrl && !urlsMatchRace(tab.url, targetUrl)) {
    try {
      tab = await navigateHkjcTabToUrl(tab.id, targetUrl);
    } catch {
      return pageMismatchResponse(tab, targetUrl, payload);
    }
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
