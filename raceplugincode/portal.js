/**
 * 官網風格控制台：同步下方「快速投注設定」內由舊版腳本寫入的會員欄位。
 * 購買記錄：優先讀 chrome.storage.local「mf007_portal_purchases」，否則依目前通行證摘要推斷列示。
 */
(function () {
  const SITE = "https://www.moneyflow007.com";
  const LOGIN = SITE + "/Login";
  const PURCHASE_STORAGE = "mf007_portal_purchases";

  const FIELD_MAP = [
    ["dd_custid", "portal-custid"],
    ["dd_email", "portal-email"],
    ["dd_expire", "portal-raceday-pass"],
    ["qb_expire", "portal-smart-pass"],
    ["scdd_expire", "portal-os-raceday"],
    ["scqb_expire", "portal-os-smart"],
  ];

  function syncFromLegacy() {
    FIELD_MAP.forEach(function (pair) {
      var src = document.getElementById(pair[0]);
      var dst = document.getElementById(pair[1]);
      if (!dst) return;
      var v = src && (src.textContent || "").trim();
      dst.textContent = v || "—";
    });
  }

  function bindPromo() {
    var btn = document.getElementById("portal-redeem");
    var input = document.getElementById("portal-promo");
    if (!btn || !input) return;
    btn.addEventListener("click", function () {
      var code = (input.value || "").trim();
      var url = code ? LOGIN + "?promo=" + encodeURIComponent(code) : LOGIN;
      chrome.tabs.create({ url: url });
    });
  }

  function bindLogout() {
    var portalBtn = document.getElementById("portal-logout");
    if (!portalBtn) return;
    portalBtn.addEventListener("click", function () {
      var legacy = document.getElementById("logout-btn");
      if (legacy) {
        legacy.click();
      } else {
        chrome.tabs.create({ url: LOGIN });
      }
    });
  }

  function escapeHtml(s) {
    var d = document.createElement("div");
    d.textContent = s == null ? "" : String(s);
    return d.innerHTML;
  }

  function rowFromPassText(plan, text) {
    if (!text || text === "—") return null;
    var dateM = text.match(/\d{4}-\d{2}-\d{2}/);
    var amtM = text.match(/HK\$\s*[\d,]+/i);
    var expiry = dateM ? dateM[0] : text.indexOf("已過期") >= 0 ? "已過期" : "—";
    var amount = amtM ? amtM[0].replace(/\s/g, "") : "—";
    if (expiry === "—" && amount === "—" && !/付費|次|通行|版|剩餘/.test(text)) return null;
    return { plan: plan, expiry: expiry, amount: amount };
  }

  function buildFallbackPurchaseRows() {
    var rows = [];
    var pairs = [
      ["聰明投注通行證", "portal-smart-pass"],
      ["賽馬日通行證", "portal-raceday-pass"],
      ["海外 · 賽馬日通行證", "portal-os-raceday"],
      ["海外 · 聰明投注通行證", "portal-os-smart"],
    ];
    pairs.forEach(function (p) {
      var el = document.getElementById(p[1]);
      var t = el ? (el.textContent || "").trim() : "";
      var r = rowFromPassText(p[0], t);
      if (r) rows.push(r);
    });
    return rows.slice(0, 10);
  }

  function renderPurchaseTable() {
    var tbody = document.getElementById("portal-purchase-tbody");
    var emptyEl = document.getElementById("portal-purchase-empty");
    if (!tbody || !emptyEl) return;

    tbody.innerHTML = "";
    emptyEl.hidden = true;

    chrome.storage.local.get([PURCHASE_STORAGE], function (result) {
      var stored = result[PURCHASE_STORAGE];
      var rows =
        Array.isArray(stored) && stored.length
          ? stored.slice(0, 10).map(function (r) {
              return {
                plan: r.plan || "—",
                expiry: r.expiry || "—",
                amount: r.amount || "—",
              };
            })
          : buildFallbackPurchaseRows();

      if (!rows.length) {
        emptyEl.hidden = false;
        emptyEl.textContent =
          "暫無購買記錄。請於官網帳戶內查看完整訂單，或先於下方「快速投注設定與登入」登入以同步通行證摘要。";
        return;
      }

      rows.forEach(function (r) {
        var tr = document.createElement("tr");
        tr.innerHTML =
          "<td>" +
          escapeHtml(r.plan) +
          "</td><td>" +
          escapeHtml(r.expiry) +
          "</td><td class=\"mf007-purchase-amt\">" +
          escapeHtml(r.amount) +
          "</td>";
        tbody.appendChild(tr);
      });
    });
  }

  function bindBetEntry() {
    var bet = document.getElementById("portal-open-bet");
    var speed = document.getElementById("portal-open-speedbet");
    if (bet) {
      bet.addEventListener("click", function () {
        chrome.tabs.create({ url: "https://bet.hkjc.com/" });
      });
    }
    if (speed) {
      speed.addEventListener("click", function () {
        chrome.tabs.create({ url: "https://speedbet.hkjc.com/" });
      });
    }
  }

  function bindPurchaseToggle() {
    var btn = document.getElementById("portal-purchase-toggle");
    var panel = document.getElementById("portal-purchase-panel");
    if (!btn || !panel) return;

    btn.addEventListener("click", function () {
      var open = panel.hidden;
      if (open) {
        panel.hidden = false;
        btn.setAttribute("aria-expanded", "true");
        renderPurchaseTable();
      } else {
        panel.hidden = true;
        btn.setAttribute("aria-expanded", "false");
      }
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    syncFromLegacy();
    setInterval(syncFromLegacy, 450);
    bindPromo();
    bindLogout();
    bindBetEntry();
    bindPurchaseToggle();
  });
})();
