/**
 * 隔离沙盒层：精准网格重构（仅在主页执行弹性拉伸，播放页仅作隐形除痕）
 */
(function() {
  function sync() {
    chrome.storage.local.get({ enableIp: true, enablePure: true }, (res) => {
      document.documentElement.setAttribute('data-bili-ip-status', res.enableIp ? 'on' : 'off');
      document.documentElement.setAttribute('data-bili-pure-status', res.enablePure ? 'on' : 'off');
    });
  }
  sync();
  chrome.storage.onChanged.addListener(sync);

  const style = document.createElement('style');
  style.textContent = `
    /* ==================== 1. 【主页专属】极致自适应弹性放大网格 ==================== */
    html[data-bili-pure-status="on"] .bilibili-header + .bili-layout .bili-grid,
    html[data-bili-pure-status="on"] .feed-card-body,
    html[data-bili-pure-status="on"] .recommend-container__list,
    html[data-bili-pure-status="on"] .rcmd-box {
      display: grid !important;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)) !important;
      gap: 20px !important;
    }

    /* ==================== 2. 【播放页专属】无损级自然靠拢补位 ==================== */
    html[data-bili-pure-status="on"] .next-play-last-wrapper,
    html[data-bili-pure-status="on"] .rec-list {
      display: flex !important;
      flex-direction: column !important;
      gap: 12px !important;
    }

    /* ==================== 3. 全局强力防御层（隐藏各种静态逃逸组件 + 额外特定硬标签过滤） ==================== */
    html[data-bili-pure-status="on"] [data-bili-card-type=\"pure-blocked\"],
    html[data-bili-pure-status="on"] #bili_live_recom,
    html[data-bili-pure-status="on"] .pop-live-small-list,
    html[data-bili-pure-status="on"] .video-page-special-card-small,
    html[data-bili-pure-status="on"] .reply-notice-wrapper,
    html[data-bili-pure-status="on"] .ad-report,
    html[data-bili-pure-status="on"] .banner-card,
    html[data-bili-pure-status="on"] .bili-video-card:has(a[href*="live.bilibili.com"]),
    html[data-bili-pure-status="on"] .bili-video-card:has(a[href*="/bangumi/play"]),
    /* 精准硬核捕获带有特定渲染角标的干扰卡片并执行底层硬隐藏 */
    html[data-bili-pure-status="on"] .bili-video-card:has(.bili-video-card__info--creative-badge),
    html[data-bili-pure-status="on"] .bili-video-card:has(.bili-video-card__badge) {
      display: none !important;
    }
  `;
  (document.head || document.documentElement).appendChild(style);
})();