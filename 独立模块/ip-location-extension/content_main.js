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
    let url = args[0]?.url || args[0] || '';

    // 【新增性能优化点】：在开启净化时，从源头改大 page_size 参数，让 B 站一次性返回 30 条数据。
    // 这样即便被过滤掉一半，剩下的也足够撑满屏幕，绝不会引起瀑布流断流。
    if (typeof url === 'string' && isPureEnabled() && url.includes('web-interface/wbi/index/top/feed/rcmd')) {
      try {
        const urlObj = new URL(url, window.location.origin);
        urlObj.searchParams.set('page_size', '30');
        args[0] = urlObj.toString();
      } catch (e) {}
    }

    const response = await originalFetch(...args);

    if (typeof url === 'string' && isPureEnabled()) {
      // 首页瀑布流数据流
      if (url.includes('web-interface/wbi/index/top/feed/rcmd')) {
        try {
          const clone = response.clone();
          const json = await clone.json();
          if (json?.data?.item) {
            // 洗数：只保留纯正 UGC 视频内容，抹去一切杂质
            json.data.item = json.data.item.filter(item => {
              // 防御：深度过滤赛事、广告角标以及非普通视频的goto类型
              let reason = typeof item.rcmd_reason === 'string' ? item.rcmd_reason : (item.rcmd_reason?.content || '');
              let badge = typeof item.badge === 'string' ? item.badge : (item.badge?.text || item.badge_info?.text || '');
              if (reason.includes('赛事') || reason.includes('广告') || badge.includes('赛事') || badge.includes('广告')) {
                return false;
              }
              return item.goto === 'av' || item.goto === 'vertical';
            });

            // 【核心修复】：如果洗完数后，这一页剩下的有效视频少于 8 个（容易导致高度不足断流）
            // 在异步微任务里向 window 发送一个 scroll 事件，无感唤醒 B 站底层的加载器去请求下一页
            if (json.data.item.length < 8) {
              queueMicrotask(() => {
                window.dispatchEvent(new Event('scroll'));
              });
            }
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
            json.data = json.data.filter(item => {
              let reason = typeof item.rcmd_reason === 'string' ? item.rcmd_reason : (item.rcmd_reason?.content || '');
              let badge = typeof item.badge === 'string' ? item.badge : (item.badge?.text || item.badge_info?.text || '');
              if (reason.includes('赛事') || reason.includes('广告') || badge.includes('赛事') || badge.includes('广告')) {
                return false;
              }
              return !item.program && !item.ad_info && !['live', 'opus'].includes(item.goto);
            });
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
                resData.data.item = resData.data.item.filter(item => {
                  let reason = typeof item.rcmd_reason === 'string' ? item.rcmd_reason : (item.rcmd_reason?.content || '');
                  let badge = typeof item.badge === 'string' ? item.badge : (item.badge?.text || item.badge_info?.text || '');
                  if (reason.includes('赛事') || reason.includes('广告') || badge.includes('赛事') || badge.includes('广告')) {
                    return false;
                  }
                  return item.goto === 'av' || item.goto === 'vertical';
                });
                
                // 同样的 XHR 兜底补货判定
                if (resData.data.item.length < 8) {
                  queueMicrotask(() => { window.dispatchEvent(new Event('scroll')); });
                }
              } else if (Array.isArray(resData?.data)) {
                resData.data = resData.data.filter(item => {
                  let reason = typeof item.rcmd_reason === 'string' ? item.rcmd_reason : (item.rcmd_reason?.content || '');
                  let badge = typeof item.badge === 'string' ? item.badge : (item.badge?.text || item.badge_info?.text || '');
                  if (reason.includes('赛事') || reason.includes('广告') || badge.includes('赛事') || badge.includes('广告')) {
                    return false;
                  }
                  return !item.program && !item.ad_info && !['live', 'opus'].includes(item.goto);
                });
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

    // A. 注入评论组件 IP
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
          // 额外防御：如果检测到里面含有“赛事”或“广告”这类非正常视频角标，也判定为需要阻断
          if (!shouldBlock) {
            const hasBadgeNode = card.querySelector('.bili-video-card__info--creative-badge, .bili-video-card__badge');
            if (hasBadgeNode) {
              shouldBlock = true;
            } else {
              // 匹配包含“赛事”、“广告”的角标文本，通常角标包含 badge、reason、tag 等类名（兜底页面缓存/SSR加载的元素）
              const badgeNodes = card.querySelectorAll('[class*="badge"], [class*="reason"], [class*="tag"]');
              for (let j = 0; j < badgeNodes.length; j++) {
                const className = badgeNodes[j].getAttribute('class') || '';
                // 防止误伤带有这类类名的标题和作者名
                if (className.includes('title') || className.includes('author') || className.includes('name')) {
                  continue; 
                }
                const text = badgeNodes[j].textContent || '';
                if (text.includes('赛事') || text.includes('广告')) {
                  shouldBlock = true;
                  break;
                }
              }
            }
          }

          card.setAttribute('data-bili-card-type', shouldBlock ? 'pure-blocked' : 'normal');
        }
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

    // 全站统合的 Mutation 队列监视
    const observer = new MutationObserver((mutations) => {
      let shouldSchedule = false;
      for (let i = 0; i < mutations.length; i++) {
        const addedNodes = mutations[i].addedNodes;
        for (let j = 0; j < addedNodes.length; j++) {
          const node = addedNodes[j];
          if (node && node.nodeType === 1) {
            const tag = node.localName;

            if (tag === 'bili-comment-user-info') {
              pendingComments.add(node);
              shouldSchedule = true;
            } else {
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