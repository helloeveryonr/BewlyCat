/**
 * 页面主环境层：全站【数据流劫持过滤层】 + 高性能 IP 组件挂载
 */
(function () {
  if (window.__BILI_ULTIMATE_MAIN_INJECTED__) return;
  window.__BILI_ULTIMATE_MAIN_INJECTED__ = true;

  const BADGE_STYLE = 'display:inline-block;margin-left:6px;padding:1px 5px;font-size:11px;font-weight:600;color:#000000;background:#89ddf0;border-radius:3px;line-height:1.4;vertical-align:middle;';
  const NON_VIDEO_KEYWORDS = ['live.bilibili.com', '/bangumi/play', '/cheese/play', 'manga.bilibili.com', 'cm.bilibili.com', '/opus/', '/read/'];

  function isPureEnabled() {
    return document.documentElement.getAttribute('data-bili-pure-status') === 'on';
  }

  // ==================== [核心 1: 数据层接口洗数 (彻底解决补货掉帧)] ====================
  
  // 1. 拦截原生 Fetch（用于首页最新版瀑布流推荐）
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch(...args);
    const url = args[0]?.url || args[0] || '';

    if (typeof url === 'string' && isPureEnabled()) {
      // 首页瀑布流数据流
      if (url.includes('web-interface/wbi/index/top/feed/rcmd')) {
        try {
          const clone = response.clone();
          const json = await clone.json();
          if (json?.data?.item) {
            // 洗数：只保留纯正 UGC 视频内容，抹去一切杂质
            json.data.item = json.data.item.filter(item => 
              item.goto === 'av' || item.goto === 'vertical' || 
              !['live', 'ad', 'bangumi', 'cheese', 'opus', 'cm', 'game'].includes(item.goto)
            );
          }
          return new Response(JSON.stringify(json), { status: response.status, statusText: response.statusText, headers: response.headers });
        } catch (e) {}
      }
      // 播放页关联推荐数据流
      if (url.includes('web-interface/wbi/archive/related')) {
        try {
          const clone = response.clone();
          const json = await clone.json();
          if (Array.isArray(json?.data)) {
            json.data = json.data.filter(item => !item.program && !item.ad_info && !['live', 'opus'].includes(item.goto));
          }
          return new Response(JSON.stringify(json), { status: response.status, statusText: response.statusText, headers: response.headers });
        } catch (e) {}
      }
    }
    return response;
  };

  // 2. 拦截旧版或兜底用 XMLHttpRequest
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(method, url, ...args) {
    this._url = url;
    return originalOpen.call(this, method, url, ...args);
  };
  XMLHttpRequest.prototype.send = function(...args) {
    const self = this;
    const onreadystatechange = this.onreadystatechange;
    if (onreadystatechange && typeof self._url === 'string' && isPureEnabled()) {
      this.onreadystatechange = function(...stateArgs) {
        if (self.readyState === 4 && self.status === 200) {
          if (self._url.includes('web-interface/wbi/index/top/feed/rcmd') || self._url.includes('web-interface/wbi/archive/related')) {
            try {
              let resData = JSON.parse(self.responseText);
              if (resData?.data?.item) {
                resData.data.item = resData.data.item.filter(item => item.goto === 'av' || item.goto === 'vertical' || !['live', 'ad', 'bangumi', 'cheese', 'opus', 'cm', 'game'].includes(item.goto));
              } else if (Array.isArray(resData?.data)) {
                resData.data = resData.data.filter(item => !item.program && !item.ad_info && !['live', 'opus'].includes(item.goto));
              }
              Object.defineProperty(self, 'responseText', { value: JSON.stringify(resData), configurable: true });
              Object.defineProperty(self, 'response', { value: JSON.stringify(resData), configurable: true });
            } catch (e) {}
          }
        }
        return onreadystatechange.apply(self, stateArgs);
      };
    }
    return originalSend.apply(this, args);
  };

  // ==================== [核心 2: 极致微任务 IP 挂载 + 物理 DOM 逃逸打标] ====================
  function getLocationString(replyItem) {
    const location = replyItem?.reply_control?.location;
    if (!location) return null;
    return location.replace(/^IP属地[：:\s]*/u, '').trim() || null;
  }

  function createLocationBadge(text) {
    const badge = document.createElement('span');
    badge.className = 'ip-location-badge';
    badge.textContent = text;
    badge.style.cssText = BADGE_STYLE;
    return badge;
  }

  function patchComponent(constructor) {
    if (!constructor?.prototype || constructor.__IP_PATCHED__) return;
    constructor.__IP_PATCHED__ = true;
    const originalUpdate = constructor.prototype.update;
    if (typeof originalUpdate !== 'function') return;

    constructor.prototype.update = function (...args) {
      const result = originalUpdate.apply(this, args);
      try {
        const root = this.shadowRoot;
        if (!root) return result;

        if (document.documentElement.getAttribute('data-bili-ip-status') !== 'on') {
          root.querySelector('.ip-location-badge')?.remove();
          delete this.__LAST_IP__;
          return result;
        }

        const locationString = getLocationString(this.data);
        if (this.__LAST_IP__ === locationString) return result;
        this.__LAST_IP__ = locationString;

        let badge = root.querySelector('.ip-location-badge');
        if (!locationString) {
          badge?.remove();
          return result;
        }

        if (!badge) {
          const userNameEl = root.querySelector('#user-name');
          if (userNameEl) {
            badge = createLocationBadge(locationString);
            userNameEl.insertAdjacentElement('afterend', badge);
          }
        } else {
          badge.textContent = locationString;
        }
      } catch (e) {}
      return result;
    };
  }

  const pendingComments = new Set();
  const pendingCards = new Set();
  let isMicrotaskScheduled = false;

  function processQueue() {
    isMicrotaskScheduled = false;

    // A. 注入评论组件 IP (添加全面空安全防御性校验)
    if (typeof pendingComments !== 'undefined' && pendingComments && pendingComments.size > 0) {
      const ctor = window.customElements.get('bili-comment-user-info');
      if (ctor) {
        patchComponent(ctor);
        pendingComments.clear();
      } else {
        for (const el of pendingComments) {
          if (el && el.constructor) patchComponent(el.constructor);
        }
        pendingComments.clear();
      }
    }

    // B. 局部 HTML 缓存逃逸内容的兜底检查
    if (typeof pendingCards !== 'undefined' && pendingCards && pendingCards.size > 0) {
      for (const card of pendingCards) {
        if (card && card.setAttribute && !card.hasAttribute('data-bili-card-type')) {
          const anchors = card.getElementsByTagName('a');
          let shouldBlock = false;
          for (let i = 0; i < anchors.length; i++) {
            const href = anchors[i].href;
            if (href && NON_VIDEO_KEYWORDS.some(k => href.includes(k))) {
              shouldBlock = true;
              break;
            }
          }
          card.setAttribute('data-bili-card-type', shouldBlock ? 'pure-blocked' : 'normal');
        }
      }
      pendingCards.clear();

      // ==========================================
      // 【这里是唯一新增的代码】：只修补视频太少不断流的问题
      // ==========================================
      if (isPureEnabled()) {
        // 给 CSS 引擎 50ms 隐藏卡片重新计算高度的时间
        setTimeout(() => {
          const scrollHeight = document.documentElement.scrollHeight;
          const clientHeight = window.innerHeight;
          
          // 判定：如果页面总高度连一屏半都不到（被干掉的视频太多了）
          if (scrollHeight <= clientHeight * 1.5) {
            // 策略 1: 看看页面底部的官方“加载更多/换一换”按钮在不在，在就直接帮你点一下
            const rollBtn = document.querySelector('.roll-btn, .feed-roll-btn, .primary-btn-instance');
            if (rollBtn) rollBtn.click();
            
            // 策略 2: 派发全局滚动事件，唤醒 B站官方绑定在 window 上的懒加载代码
            window.dispatchEvent(new Event('scroll'));
            
            // 策略 3: 物理微弱震荡（滚1像素再回来），专治部分基于 IntersectionObserver 的顽固卡死
            window.scrollBy(0, 1);
            window.scrollBy(0, -1);
          }
        }, 50);
      }
      // ==========================================
    }
  }

  function init() {
    if (window.customElements) {
      const originalDefine = window.customElements.define.bind(window.customElements);
      window.customElements.define = function (name, constructor) {
        if (name === 'bili-comment-user-info' && typeof constructor === 'function') patchComponent(constructor);
        return originalDefine(name, constructor);
      };
      const existing = window.customElements.get('bili-comment-user-info');
      if (existing) patchComponent(existing);
    }

    // 全站统合的 Mutation 队列监视
    const observer = new MutationObserver((mutations) => {
      let shouldSchedule = false;
      for (let i = 0; i < mutations.length; i++) {
        const addedNodes = mutations[i].addedNodes;
        for (let j = 0; j < addedNodes.length; j++) {
          const node = addedNodes[j];
          // 确保是普通 HTML 元素节点
          if (node && node.nodeType === 1) {
            const tag = node.localName;

            if (tag === 'bili-comment-user-info') {
              pendingComments.add(node);
              shouldSchedule = true;
            } else {
              // 关键修复点：不要直接取 className，用 getAttribute('class') 确保拿出来的一定是纯 String
              const cls = node.getAttribute && node.getAttribute('class');
              if (typeof cls === 'string' && cls) {
                if (cls.includes('card') || cls.includes('bili-video-card') || cls.includes('feed-card')) {
                  pendingCards.add(node);
                  shouldSchedule = true;
                }
              }
            }
          }
        }
      }
      if (shouldSchedule && !isMicrotaskScheduled) {
        isMicrotaskScheduled = true;
        queueMicrotask(processQueue);
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();