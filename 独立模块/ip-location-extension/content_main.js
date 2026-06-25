/**
 * 页面主环境层：全站【数据流劫持过滤层】 + 高性能 IP 组件挂载 + 原生 WBI 联动流控器
 */
(function () {
  if (window.__BILI_ULTIMATE_MAIN_INJECTED__) return;
  window.__BILI_ULTIMATE_MAIN_INJECTED__ = true;

  const BADGE_STYLE = 'display:inline-block;margin-left:6px;padding:1px 5px;font-size:11px;font-weight:600;color:#000000;background:#89ddf0;border-radius:3px;line-height:1.4;vertical-align:middle;';
  const NON_VIDEO_KEYWORDS = ['live.bilibili.com', '/bangumi/play', '/cheese/play', 'manga.bilibili.com', 'cm.bilibili.com', '/opus/', '/read/'];

  function isPureEnabled() {
    return document.documentElement.getAttribute('data-bili-pure-status') === 'on';
  }

  // ==================== [核心 1: 数据层接口精准洗数] ====================
  
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

  // 【借鉴 BewlyCat 思路】：高性能自动化填屏流控函数
  function autoFillScreenFlow() {
    if (!isPureEnabled()) return;
    
    // 给浏览器留出 100ms 释放隐藏 DOM 后的排版高度
    setTimeout(() => {
      const scrollHeight = document.documentElement.scrollHeight;
      const clientHeight = document.documentElement.clientHeight;
      
      // 如果当前内容总高度连 1.5 屏都不到，或者当前滚动条已经接近死锁触底
      if (scrollHeight <= clientHeight * 1.5 || window.innerHeight + window.scrollY >= scrollHeight - 650) {
        // 1. 触发一次标准 scroll 事件，唤醒 B 站挂载在 window 上的无限加载监听
        window.dispatchEvent(new Event('scroll'));
        
        // 2. 物理微位移：向下轻微滚动 1 像素再弹回，彻底激活组件内部的 IntersectionObserver
        window.scrollBy(0, 1);
        window.scrollBy(0, -1);
      }
    }, 100);
  }

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
          card.setAttribute('data-bili-card-type', shouldBlock ? 'pure-blocked' : 'normal');
        }
      }
      pendingCards.clear();

      // 【核心调用】：DOM 裁剪隐藏完成后，立即检查屏幕是否被填满，不饱满则立刻命令 B 站脚本自动加载下页
      autoFillScreenFlow();
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