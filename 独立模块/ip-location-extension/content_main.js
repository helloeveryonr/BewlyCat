/**
 * 页面主环境层：全站【数据流劫持过滤层】 + 高性能 IP 组件挂载
 */
(function () {
  if (window.__BILI_ULTIMATE_MAIN_INJECTED__) return;
  window.__BILI_ULTIMATE_MAIN_INJECTED__ = true;

  const BADGE_STYLE = 'display:inline-block;margin-left:6px;padding:1px 5px;font-size:11px;font-weight:600;color:#000000;background:#89ddf0;border-radius:3px;line-height:1.4;vertical-align:middle;';
  const NON_VIDEO_KEYWORDS = ['live.bilibili.com', '/bangumi/play', '/cheese/play', 'manga.bilibili.com', 'cm.bilibili.com', '/opus/', '/read/'];
  const BLOCKED_BADGES = new Set(['赛事', '广告', '课堂', '剧集', '纪录片', '专题']);

  function isPureEnabled() {
    return document.documentElement.getAttribute('data-bili-pure-status') === 'on';
  }

  // ==================== [核心 1: 数据层接口洗数 (最高效的前置拦截)] ====================
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch(...args);
    const url = args[0]?.url || args[0] || '';

    if (typeof url === 'string' && isPureEnabled()) {
      // 首页瀑布流推荐数据
      if (url.includes('web-interface/wbi/index/top/feed/rcmd')) {
        try {
          const clone = response.clone();
          const json = await clone.json();
          if (json?.data?.item) {
            // 极致清洗：只保留纯正 UGC 视频，强力排除赛事、广告、课堂等 badge 干扰
            json.data.item = json.data.item.filter(item => {
              if (item.goto !== 'av' && item.goto !== 'vertical') return false;
              if (item.badge && BLOCKED_BADGES.has(item.badge.trim())) return false;
              return !['live', 'ad', 'bangumi', 'cheese', 'opus', 'cm', 'game', 'special', 'picture'].includes(item.goto);
            });
          }
          return new Response(JSON.stringify(json), { status: response.status, statusText: response.statusText, headers: response.headers });
        } catch (e) {}
      }
      // 播放页关联推荐数据
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

  // 拦截旧版或兜底用 XMLHttpRequest
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
                resData.data.item = resData.data.item.filter(item => {
                  if (item.goto !== 'av' && item.goto !== 'vertical') return false;
                  if (item.badge && BLOCKED_BADGES.has(item.badge.trim())) return false;
                  return !['live', 'ad', 'bangumi', 'cheese', 'opus', 'cm', 'game', 'special', 'picture'].includes(item.goto);
                });
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

  // ==================== [核心 2: 极致微任务 IP 挂载 + 高性能物理 DOM 逃逸打标] ====================
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

    // A. 注入评论区 IP
    if (pendingComments.size > 0) {
      const ctor = window.customElements.get('bili-comment-user-info');
      if (ctor) {
        patchComponent(ctor);
      } else {
        for (const el of pendingComments) {
          if (el?.constructor) patchComponent(el.constructor);
        }
      }
      pendingComments.clear();
    }

    // B. 高性能物理 DOM 过滤层 (利用原生选择器避开大面积 DOM 遍历)
    if (pendingCards.size > 0) {
      for (const card of pendingCards) {
        if (!card.setAttribute || card.hasAttribute('data-bili-card-type')) continue;

        let shouldBlock = false;

        // 1. 快速检查卡片内部链接
        const firstAnchor = card.querySelector('a');
        if (firstAnchor && firstAnchor.href) {
          const href = firstAnchor.href;
          if (NON_VIDEO_KEYWORDS.some(k => href.includes(k))) {
            shouldBlock = true;
          }
        }

        // 2. 极致性能：针对特殊角标（如图片中的“赛事”）进行原生 O(1) 选择器命中
        if (!shouldBlock) {
          const badgeEl = card.querySelector('.bili-video-card__info--creative-badge, .bili-video-card__badge, .badge-item, .bili-video-card__mask-badge');
          if (badgeEl && BLOCKED_BADGES.has(badgeEl.textContent.trim())) {
            shouldBlock = true;
          }
        }

        card.setAttribute('data-bili-card-type', shouldBlock ? 'pure-blocked' : 'normal');
      }
      pendingCards.clear();
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

    // 统合 Mutation 队列监视
    const observer = new MutationObserver((mutations) => {
      let shouldSchedule = false;
      const len = mutations.length;
      for (let i = 0; i < len; i++) {
        const addedNodes = mutations[i].addedNodes;
        const nodeLen = addedNodes.length;
        for (let j = 0; j < nodeLen; j++) {
          const node = addedNodes[j];
          if (node && node.nodeType === 1) {
            const tag = node.localName;
            if (tag === 'bili-comment-user-info') {
              pendingComments.add(node);
              shouldSchedule = true;
            } else {
              const cls = node.getAttribute && node.getAttribute('class');
              if (typeof cls === 'string' && cls && (cls.includes('card') || cls.includes('bili-video-card') || cls.includes('feed-card'))) {
                pendingCards.add(node);
                shouldSchedule = true;
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