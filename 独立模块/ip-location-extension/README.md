# Bilibili 评论 IP 地理位置显示扩展

一个独立的轻量级扩展模块，可在 Bilibili 评论区无缝显示用户 IP 属地。

## 功能特点
- **完全独立**：独立于主包逻辑，采用注入主环境（MAIN world）技术。
- **高性能**：通过精准劫持 B 站原生的 `bili-comment-user-info` 自定义 Web Component，配合 `MutationObserver` 确保在任何动态加载（如滚动翻页、展开回复）的情况下标签都能实时准确显示。
- **无感适配**：完美兼容 `BewlyCat` 及其它美化插件。

## 目录结构
- `manifest.json` - 扩展配置文件（配置主环境执行环境）
- `content.js` - 地理位置核心拦截与 DOM 操作脚本
