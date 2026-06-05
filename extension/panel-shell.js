/**
 * 在首屏渲染前判斷承載方式：側邊欄（類 MetaMask）或獨立小窗，以便 CSS 使用全高佈局。
 */
(() => {
  const root = document.documentElement;

  function useDetachedLayout() {
    root.classList.add("detached-window-root");
  }

  async function detectSidePanel() {
    try {
      if (chrome?.runtime?.getContexts) {
        const contexts = await chrome.runtime.getContexts({ contextTypes: ["SIDE_PANEL"] });
        if (contexts.length > 0) {
          root.classList.add("side-panel-root");
          return true;
        }
      }
    } catch {
      /* ignore */
    }
    return false;
  }

  void (async () => {
    const isSide = await detectSidePanel();
    if (isSide) return;
    if (window.innerWidth >= 520 || window.innerHeight >= 640) {
      useDetachedLayout();
    }
  })();
})();
