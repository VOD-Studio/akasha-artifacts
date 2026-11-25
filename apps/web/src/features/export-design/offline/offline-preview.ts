import { getMessages, type Locale } from '@/shared/i18n'
import player from './offline-player.js?raw'
import { previewMessages } from './offline-preview-messages'

/**
 * data 和可信帧模板中的 JSON 都由打包器转义 `<`，作者内容不能结束脚本标签。
 * 不传脚本时，从当前目录的 assets 加载经典脚本，可在 file:// 下直接打开。
 */
export function offlinePage(
  data: string,
  framesScript: string | undefined,
  locale: Locale,
): string {
  const { t, dir } = getMessages(previewMessages, locale)
  const labels = JSON.stringify({
    overview: t('总览'),
    ungrouped: t('未分组'),
    empty: t('此页面没有画板。'),
    opening: t('正在打开…'),
    content: t('画板内容：{title}'),
    go: t('前往 {title}'),
    error: t('无法打开画板：{error}'),
    unreachable: t('当前画板无法跳转到该目标。'),
  }).replaceAll('<', '\\u003c')
  const scripts =
    framesScript === undefined
      ? '<script src="assets/runtime.js"></script><script src="assets/player.js"></script>'
      : `<script>${framesScript}</script><script>${player}</script>`
  return `<!doctype html>
<html lang="${locale}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${t('离线预览')}</title><style>
body{margin:0;font:15px system-ui,sans-serif;color:#171717;background:#f5f5f5}
header{position:sticky;top:0;background:white;padding:.75rem 1rem;border-bottom:1px solid #d4d4d4;display:flex;align-items:center;gap:.65rem;flex-wrap:wrap}
h1{font-size:1rem;margin:0;overflow-wrap:anywhere}label,select,button{max-inline-size:100%}select,button{font:inherit}nav{display:flex;gap:.4rem;flex-wrap:wrap}
main{padding:1rem;display:grid;justify-items:center}iframe{box-sizing:border-box;max-width:100%;border:1px solid #d4d4d4;background:white}
#status:empty{display:none}</style></head><body>
<header><h1 dir="auto"></h1><span>${t('离线预览')}</span>
<label hidden>${t('页面')} <select id="page"></select></label>
<label>${t('画板')} <select id="board"></select></label>
<nav aria-label="${t('跳转画板')}"></nav><span id="status" role="status"></span></header>
<main></main>
<script type="application/json" id="akasha-offline-data">${data}</script>
<script type="application/json" id="akasha-offline-labels">${labels}</script>
${scripts}</body></html>`
}
