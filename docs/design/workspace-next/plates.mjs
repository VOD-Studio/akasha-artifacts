import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'

// 图板是静态稿；按钮、滑杆和音乐控件都是图形，不执行操作。
const W = 1440,
  H = 880
const ink = '#202420',
  sub = '#616962',
  muted = '#788178',
  line = '#D9DED8',
  paper = '#FFFFFF',
  field = '#F2F4F0',
  ground = '#E9ECE7',
  teal = '#176759',
  leaf = '#D9EAE2',
  orange = '#E68B69'
const sans = "'Helvetica Neue',Arial,'PingFang SC','Hiragino Sans GB','Noto Sans CJK SC',sans-serif"
const esc = (s) =>
  String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
const r = (x, y, w, h, c, rx = 0, stroke = 'none', sw = 1) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${c}" stroke="${stroke}" stroke-width="${sw}"/>`
const p = (d, fill = 'none', stroke = 'none', sw = 1) =>
  `<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round" stroke-linecap="round"/>`
const ln = (a, b, c, d, color = line, w = 1) => p(`M${a} ${b}L${c} ${d}`, 'none', color, w)
const ci = (x, y, n, fill, stroke = 'none', w = 1) =>
  `<circle cx="${x}" cy="${y}" r="${n}" fill="${fill}" stroke="${stroke}" stroke-width="${w}"/>`
const txt = (x, y, s, size = 15, color = ink, opt = {}) =>
  `<text x="${x}" y="${y}" font-family="${opt.mono ? 'Menlo,Consolas,monospace' : sans}" font-size="${size}" font-weight="${opt.weight ?? 400}" text-anchor="${opt.anchor ?? 'start'}" fill="${color}"${opt.rtl ? ' direction="rtl" unicode-bidi="embed"' : ''}>${esc(s)}</text>`
const g = (x, y, body, k = 1) => `<g transform="translate(${x} ${y}) scale(${k})">${body}</g>`
const mount = (x, y, w, h, vw, vh, body) =>
  `<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="0 0 ${vw} ${vh}" overflow="hidden">${body}</svg>`
const mid = { anchor: 'middle' },
  end = { anchor: 'end' },
  bold = { weight: 650 }
const glyphs = {
  back: 'm14 5-7 7 7 7',
  down: 'm6 9 6 6 6-6',
  next: 'm9 6 6 6-6 6',
  close: 'm6 6 12 12M18 6 6 18',
  plus: 'M12 4v16M4 12h16',
  search: 'M16 10a6 6 0 1 1-12 0 6 6 0 0 1 12 0Zm-2 5 6 6',
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  expand: 'M15 3h6v6m0-6-7 7M9 21H3v-6m0 6 7-7',
  tune: 'M3 7h4m6 0h8M3 17h10m6 0h2M13 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  pause: 'M8 5v14M16 5v14',
  play: 'm7 4 13 8-13 8Z',
  pointer: 'm5 3 15 9-7 1-3 7z',
  hand: 'M7 13V7q0-3 3-2V4q1-2 3 0v5-6q2-2 3 0v6-4q3-1 3 2v6q0 7-6 8-4 0-7-4L3 12q1-2 4 1Z',
  text: 'M3 5V3h18v2M12 3v18m-4 0h8',
  box: 'M4 4h16v16H4z',
  pen: 'M4 16 16 4l4 4L8 20l-5 1z',
  comment: 'M4 4h16v12H9l-5 4z',
  panel: 'M3 4h18v16H3zM15 4v16',
  check: 'm4 12 5 5 11-12',
  volume: 'M3 9h4l6-5v16l-6-5H3zM16 9q3 3 0 6',
  code: 'm8 6-6 6 6 6m8-12 6 6-6 6',
  folder: 'M3 5h6l3 3h9v12H3z',
  retry: 'M20 10a8 8 0 1 0 0 5M20 4v6h-6',
  note: 'M4 3h16v12l-6 6H4zM14 21v-6h6',
  share: 'M12 15V2m-5 5 5-5 5 5M4 12v9h16v-9',
  music: 'M8 17V5l11-2v12M4 18q1-4 5-2 0 4-5 4zM15 16q1-4 5-2 0 4-5 4z',
  sound: 'M3 10v4m4-8v12m5-16v20m5-17v14m4-9v4',
}
const ic = (n, x, y, s = 18, c = sub) =>
  g(x, y, p(glyphs[n], 'none', c, n === 'pause' ? 3 : 1.65), s / 24)
function pill(x, y, w, s, { dark = false, fill = paper, stroke = line, icon } = {}) {
  return (
    r(x, y, w, 34, dark ? ink : fill, 8, dark ? ink : stroke) +
    (icon ? ic(icon, x + 10, y + 9, 16, dark ? paper : sub) : '') +
    txt(x + w / 2 + (icon ? 9 : 0), y + 22, s, 14, dark ? paper : ink, mid)
  )
}
function brand(x, y) {
  return g(
    x,
    y,
    r(0, 0, 25, 25, ink, 6) +
      p('m5 17 6-12h3l6 12h-3l-2-4h-6l-2 4z', '#DDEADF') +
      ln(11, 11, 14, 11, ink, 1.5),
  )
}
// 原创的海岸录音封面；相同作品在库、画板、全屏及导出之间保留同一视觉身份。
function shore(variant = 0) {
  const sets = [
    ['#B8D3C2', '#91B9AB', '#467E78', '#203E42', '#EE975F'],
    ['#D4BEAC', '#E6A98C', '#A52F29', '#502F32', '#FBDE9C'],
    ['#ADB8D0', '#A2AED1', '#4C547E', '#242D49', '#F6C3AD'],
  ]
  const [sky, water, ridge, deep, sun] = sets[variant]
  let s =
    r(0, 0, 300, 260, sky) +
    ci(219, 67, 28, sun) +
    p('M0 123 43 105 69 107 102 84 145 119 183 112 213 102 255 118 300 109V150H0Z', ridge) +
    r(0, 138, 300, 122, water)
  for (let i = 0; i < 24; i++) {
    const x = (i * 67) % 304,
      y = 145 + i * 4
    s += ln(x, y, x + 12 + ((i * 7) % 33), y, i % 3 === 0 ? '#E3E9CF' : ridge, 1)
  }
  return (
    s +
    p(
      'M0 199 39 182 62 183 98 156 113 160 141 189 161 192 196 217 243 220 284 243 300 239V260H0Z',
      deep,
    ) +
    p('M78 166 80 130 87 130 92 167Z', '#EFE5CC') +
    r(80, 124, 7, 7, sun) +
    p('M78 124l6-7 6 7Z', deep) +
    txt(15, 23, 'TIDELINE    /    FIELD RECORDINGS', 8, deep, { mono: true })
  )
}
function transport(x, y, w, { active = true } = {}) {
  return g(
    x,
    y,
    ln(0, 0, w, 0, '#798C8A', 2) +
      ln(0, 0, w * 0.39, 0, '#E9EFE9', 2) +
      ci(w * 0.39, 0, 3, '#E9EFE9') +
      txt(0, 16, '01:42', 9, '#B8CAC3', { mono: true }) +
      txt(w, 16, '04:18', 9, '#B8CAC3', { ...end, mono: true }) +
      ic('back', 54, 31, 16, '#E4EBE4') +
      ci(w / 2, 39, 18, '#E6EBE2') +
      ic(active ? 'pause' : 'play', w / 2 - 8, 31, 16, ink) +
      ic('next', w - 70, 31, 16, '#E4EBE4'),
  )
}
function mini(y) {
  return g(
    12,
    y,
    r(0, 0, 276, 44, '#E3E9DF', 10) +
      mount(5, 5, 34, 34, 300, 260, shore()) +
      txt(48, 18, '北堤，五点四十', 12, ink, bold) +
      txt(48, 33, '潮间带 / VOL. 03', 9, sub) +
      ci(231, 22, 12, ink) +
      ic('pause', 225, 16, 12, paper) +
      ic('next', 251, 14, 15),
  )
}
const lyrics = ['潮声经过石阶', '天亮以前靠岸', '风把盐留在袖口', '灯塔还醒着', '我们听见远处的船'],
  en = [
    'Tide across the steps',
    'Ashore before the dawn',
    'Salt stays on my sleeve',
    'The light is still awake',
    'A ship beyond the bay',
  ]
function phone(kind) {
  let s = ''
  if (kind === 'article' || kind === 'queue') {
    s =
      r(0, 0, 300, 650, '#FBF9F1') +
      txt(18, 34, '潮间带', 14, ink, bold) +
      txt(282, 34, 'FIELD NOTES', 9, sub, { ...end, mono: true }) +
      ln(18, 49, 282, 49) +
      txt(17, 99, '北堤，', 37, ink, bold) +
      txt(17, 141, '五点四十', 37, ink, bold) +
      txt(18, 170, '听觉手记   /   第 03 期', 11, sub) +
      mount(18, 193, 264, 204, 300, 260, shore()) +
      txt(18, 438, '落潮后的第一段录音', 18, ink, bold) +
      txt(18, 468, '走过石阶时，潮水刚刚退去。', 14, sub) +
      txt(18, 493, '把耳机递给你，是风先到。', 14, sub) +
      mini(586)
    if (kind === 'queue')
      s +=
        r(0, 0, 300, 650, '#203A3538') +
        r(0, 309, 300, 368, '#FAFBF4', 20) +
        r(128, 321, 44, 4, '#CCD3CC', 2) +
        txt(18, 365, '接下来', 23, ink, bold) +
        ['北堤，五点四十', '摆渡人的收音机', '渔市第一盏灯']
          .map((a, i) =>
            g(
              17,
              384 + 69 * i,
              mount(0, 0, 45, 46, 300, 260, shore(i)) +
                txt(60, 19, a, 15, ink, bold) +
                txt(60, 38, ['北岸 / 海边', '南渡 / 舢板', '早市 / 旧港'][i], 11, sub) +
                ic(i ? 'next' : 'sound', 245, 15, 15, teal) +
                ln(0, 56, 264, 56),
            ),
          )
          .join('')
  } else {
    s =
      r(0, 0, 300, 650, '#213B40') +
      ic('down', 16, 18, 16, '#D7E2DD') +
      txt(150, 32, '潮间带  /  VOL. 03', 11, '#D7E2DD', mid) +
      ic('share', 264, 17, 15, '#D7E2DD')
    if (kind === 'cover')
      s +=
        mount(17, 78, 266, 263, 300, 260, shore()) +
        txt(19, 386, '北堤，五点四十', 26, '#F2EEDF', bold) +
        txt(19, 414, '阿禾  /  沿岸录音', 14, '#B8C8C3') +
        ln(20, 452, 68, 452, orange, 3) +
        txt(20, 479, '03     COASTAL TAPE', 10, '#C7D6D0', { mono: true })
    else
      s +=
        mount(18, 59, 42, 42, 300, 260, shore()) +
        txt(70, 76, '北堤，五点四十', 14, '#EBEEE4', bold) +
        txt(70, 96, '阿禾', 11, '#B8C8C3') +
        lyrics
          .map(
            (a, i) =>
              txt(
                19,
                153 + i * 72,
                a,
                i === 2 ? 25 : 18,
                i === 2 ? '#F7F1D9' : '#92A9A6',
                i === 2 ? bold : {},
              ) + txt(20, 174 + i * 72, en[i], 11, i === 2 ? '#D8DFCE' : '#91A3A2'),
          )
          .join('')
    s += transport(19, 533, 262)
  }
  return s
}
const boardNames = [
  'X1 · 迷你条展开与收起',
  'X2 · 封面与歌词切换',
  'X3 · 歌词逐行',
  'D4 · 播放队列',
]
const kinds = ['article', 'cover', 'lyrics', 'queue']
function board(i, x, y, w, selected = false) {
  const h = (w * 844) / 390,
    cap = i === 1 || i === 2 ? 'tune' : i === 3 ? 'play' : null
  return (
    txt(x, y - 12, boardNames[i], 14, selected ? teal : sub, selected ? bold : {}) +
    (cap ? ic(cap, x + w - 43, y - 26, 17) : '') +
    ic('expand', x + w - 20, y - 26, 17) +
    r(x - 1, y - 1, w + 2, h + 2, selected ? teal : line, 1) +
    mount(x, y, w, h, 300, 650, phone(kinds[i])) +
    (selected
      ? [
          [-3, -3],
          [w - 3, -3],
          [-3, h - 3],
          [w - 3, h - 3],
        ]
          .map(([a, b]) => r(x + a, y + b, 6, 6, paper, 0, teal))
          .join('')
      : '')
  )
}
const title = '潮间带 · 播放器设计'
function header() {
  return (
    r(0, 0, W, 54, paper) +
    ln(0, 54, W, 54) +
    brand(16, 14) +
    txt(58, 34, title, 16, ink, bold) +
    ic('down', 218, 21, 14) +
    ic('comment', 1135, 18, 19) +
    txt(1158, 33, '2', 12, sub) +
    pill(1190, 10, 73, '分享') +
    pill(1274, 10, 100, '会话', { icon: 'panel' }) +
    ci(1404, 27, 14, '#D6E3D9') +
    txt(1404, 32, '禾', 13, ink, mid)
  )
}
function dock(cx = W / 2) {
  const a = ['pointer', 'hand', 'text', 'box', 'note', 'pen', 'comment']
  return g(
    cx - 139,
    817,
    r(0, 2, 278, 43, '#D2D7D0', 10) +
      r(0, 0, 278, 43, paper, 10, line) +
      a
        .map(
          (n, i) =>
            (i === 0 ? r(7, 6, 32, 31, leaf, 6) : '') +
            ic(n, 14 + 38 * i, 12, 19, i === 0 ? teal : sub),
        )
        .join(''),
  )
}
function stage(inspect = false) {
  const w = 245
  return (
    r(0, 0, W, H, ground) +
    pill(18, 71, 143, '演进与动效', { icon: 'grid' }) +
    pill(inspect ? 917 : 1328, 71, 92, '64%') +
    txt(59, 155, '动效', 32, ink, bold) +
    [0, 1, 2, 3].map((i) => board(i, 62 + i * 298, 210, w, inspect && i === 1)).join('') +
    dock(inspect ? 680 : W / 2) +
    header()
  )
}
const parts = ['属性', '源码', '调参']
const side = 1042,
  sw = W - side
function sideTabs(tab) {
  return (
    r(side, 54, sw, H - 54, paper) +
    ln(side, 54, side, H) +
    parts
      .map((n, i) =>
        g(
          side + 14 + i * 63,
          67,
          (i === tab ? r(0, 0, 56, 31, leaf, 7) : '') +
            txt(28, 21, n, 15, i === tab ? teal : sub, { ...mid, weight: i === tab ? 650 : 450 }),
        ),
      )
      .join('') +
    ic('close', W - 39, 73, 17) +
    ln(side, 108, W, 108)
  )
}
function tree() {
  const names = [
    'D4 · 面板 · 播放列表',
    'D5 · 沉浸模式',
    'C1 · 组件',
    'C2 · 文章嵌入卡片',
    'X1 · 迷你条展开为全屏、收起',
    'X2 · 封面与歌词左右切换',
  ]
  return (
    names
      .map((n, i) =>
        g(
          side + 12,
          124 + i * 30,
          (i === 5 ? r(0, -1, sw - 24, 29, '#E7ECE6', 7) : '') +
            ic(i === 5 ? 'down' : 'next', 8, 5, 14) +
            txt(32, 20, '#', 16, muted) +
            txt(57, 20, n, 14, i === 5 ? ink : sub, i === 5 ? bold : {}),
        ),
      )
      .join('') + ln(side, 315, W, 315)
  )
}
function input(y, label, val, unit = '', chip) {
  const x = side + 20,
    fx = side + 149
  return (
    txt(x, y + 23, label, 14, sub) +
    r(fx, y, sw - 169, 34, field, 6) +
    (chip ? r(fx + 8, y + 7, 20, 20, chip, 4, line) : '') +
    txt(fx + (chip ? 38 : 12), y + 23, val, 15) +
    txt(W - 33, y + 23, unit, 13, muted, end)
  )
}
function segment(y, label, a, b, chosen, disabled = false) {
  const x = side + 149,
    w = sw - 169
  return (
    txt(side + 20, y + 23, label, 14, sub) +
    r(x, y, w, 34, field, 6) +
    (!disabled ? r(x + (chosen ? w / 2 : 0) + 2, y + 2, w / 2 - 4, 30, paper, 5, line) : '') +
    txt(x + w * 0.25, y + 22, a, 14, disabled ? '#9BA29B' : ink, mid) +
    txt(x + w * 0.75, y + 22, b, 14, disabled ? '#9BA29B' : ink, mid)
  )
}
function properties() {
  return (
    stage(true) +
    sideTabs(0) +
    tree() +
    txt(side + 20, 353, '画板', 17, ink, bold) +
    input(371, '宽度', '390', 'px') +
    input(413, '高度', '844', 'px') +
    segment(457, '打印模式', '流式', '固定', 1) +
    segment(499, '纸型', 'Letter', 'A4', 0, true) +
    ln(side, 557, W, 557) +
    txt(side + 20, 594, '外观', 17, ink, bold) +
    input(613, '背景', '#FFFFFF', '', '#FFFFFF') +
    input(655, '圆角', '0', 'px') +
    ln(side, 715, W, 715) +
    txt(side + 20, 753, '布局辅助线', 17, ink, bold) +
    ic('plus', W - 45, 735, 20)
  )
}
function source() {
  const sample = [
    '<article data-ak-block="cover">',
    '  <header>潮间带 / VOL. 03</header>',
    '  <h1>北堤，五点四十</h1>',
    '  <p>阿禾 / 沿岸录音</p>',
    '</article>',
  ]
  return (
    stage(true) +
    sideTabs(1) +
    tree() +
    txt(side + 20, 355, '画板源码', 18, ink, bold) +
    txt(W - 20, 355, '固定快照', 12, sub, end) +
    txt(side + 20, 384, 'X2 · 封面与歌词切换', 14, sub) +
    r(side + 14, 411, sw - 28, 177, '#F1F4EF', 8) +
    sample
      .map(
        (a, i) =>
          txt(side + 26, 445 + i * 27, String(i + 1), 11, muted, { mono: true }) +
          txt(side + 53, 445 + i * 27, a, 12, i === 2 ? teal : ink, { mono: true }),
      )
      .join('') +
    pill(side + 18, 618, 164, '打开整份源码编辑器', { icon: 'code' })
  )
}
function tweaks() {
  const x = side + 20
  return (
    stage(true) +
    sideTabs(2) +
    txt(x, 151, '封面与歌词', 22, ink, bold) +
    txt(x, 181, 'X2 · 当前画板', 14, sub) +
    ln(side, 210, W, 210) +
    txt(x, 248, '切换动效', 16, ink, bold) +
    txt(x, 291, '切换时长', 15) +
    txt(W - 25, 291, '420 ms', 14, sub, end) +
    ln(x, 317, W - 28, 317, line, 4) +
    ln(x, 317, side + 184, 317, teal, 4) +
    ci(side + 184, 317, 7, paper, teal, 2) +
    segment(352, '封面色温', '冷调', '暖调', 1) +
    txt(x, 441, '显示歌词译文', 15) +
    r(W - 65, 423, 41, 24, teal, 12) +
    ci(W - 36, 435, 8, paper) +
    ln(side, 484, W, 484) +
    pill(x, 508, 103, '恢复默认')
  )
}
function review() {
  let s =
    stage() +
    r(0, 0, 326, H, paper) +
    ln(326, 0, 326, H) +
    brand(17, 15) +
    txt(55, 34, '设计会话', 16, ink, bold) +
    ic('panel', 288, 18, 18) +
    ln(0, 55, 326, 55) +
    txt(24, 96, '今天', 13, muted) +
    r(42, 132, 258, 66, field, 13) +
    txt(57, 159, '封面切到歌词时，', 15) +
    txt(57, 182, '保留底部的播放位置。', 15) +
    txt(24, 257, '阿禾', 14, teal, bold) +
    txt(24, 289, '过渡稿在 X2。播放队列单独', 16) +
    txt(24, 315, '放在 D4，便于一起看。', 16) +
    pill(24, 345, 138, '定位到 X2', { icon: 'expand' }) +
    r(17, 767, 292, 79, paper, 12, line) +
    txt(34, 802, '继续讨论设计…', 15, muted) +
    ic('plus', 32, 816, 17) +
    ic('share', 273, 815, 19)
  return (
    s +
    ci(628, 407, 13, '#F3B74D') +
    txt(628, 412, '1', 12, ink, mid) +
    r(1015, 75, 405, 225, paper, 12, line) +
    txt(1037, 111, '批注', 20, ink, bold) +
    txt(1096, 111, '2', 13, sub) +
    ic('close', 1383, 93, 18) +
    ln(1015, 131, 1420, 131) +
    ci(1049, 163, 12, '#F3B74D') +
    txt(1049, 167, '1', 11, ink, mid) +
    txt(1071, 169, '阿禾', 15, ink, bold) +
    txt(1038, 208, '歌词出现后保留当前播放进度。', 16) +
    txt(1038, 254, 'X2 · 封面与歌词切换', 13, sub)
  )
}
function play() {
  return (
    r(0, 0, W, H, '#DDE2DA') +
    r(0, 0, W, 54, paper) +
    ln(0, 54, W, 54) +
    ic('back', 18, 18, 18) +
    txt(47, 34, '返回画布', 15) +
    txt(W / 2, 34, 'D4 · 播放队列', 16, ink, { ...mid, ...bold }) +
    pill(1287, 10, 132, '退出试玩  Esc') +
    mount(544, 95, 352, 748, 300, 650, phone('queue'))
  )
}
function createDesign() {
  return (
    library() +
    r(0, 0, W, H, '#25302844') +
    r(402, 117, 636, 642, paper, 16) +
    txt(434, 172, '新建设计', 27, ink, bold) +
    ic('close', 982, 145, 21) +
    ln(402, 198, 1038, 198) +
    txt(434, 240, '项目', 14, sub) +
    pill(434, 254, 178, 'Studio FM', { icon: 'folder' }) +
    txt(742, 240, '执行设计的 Agent', 14, sub) +
    pill(742, 254, 209, 'Claude Code', { icon: 'code' }) +
    txt(434, 344, '设计简报', 16, ink, bold) +
    r(434, 361, 571, 131, paper, 8, line) +
    txt(451, 398, '给《潮间带》做一款听海录音的小播放器。', 18) +
    txt(451, 432, '先看文章内的迷你条，再看封面和歌词。', 18) +
    txt(434, 543, '参考图', 15, sub) +
    mount(434, 557, 109, 67, 300, 146, coverArt(0)) +
    txt(559, 597, '沿岸录音 · 封面', 15) +
    ic('close', 702, 582, 15) +
    ln(402, 658, 1038, 658) +
    pill(769, 684, 83, '取消') +
    pill(865, 684, 141, '开始设计', { dark: true })
  )
}
function sharing() {
  return (
    stage() +
    r(0, 0, W, H, '#25302844') +
    r(435, 165, 570, 525, paper, 16) +
    txt(468, 223, '分享设计', 26, ink, bold) +
    ic('close', 949, 197, 21) +
    ln(435, 253, 1005, 253) +
    txt(468, 297, '链接范围', 15, sub) +
    pill(468, 314, 156, '画板 D4', { fill: leaf, stroke: teal }) +
    pill(634, 314, 156, '整份设计') +
    txt(468, 396, '打开方式', 15, sub) +
    pill(468, 411, 156, '试玩', { icon: 'play' }) +
    txt(468, 495, '权限', 15, sub) +
    pill(468, 510, 156, '可查看') +
    txt(693, 495, '版本', 15, sub) +
    pill(693, 510, 156, '固定为 v3') +
    ln(435, 586, 1005, 586) +
    txt(468, 644, 'Studio FM · Cloud Hub', 14, sub) +
    pill(814, 620, 158, '创建分享链接', { dark: true })
  )
}
function delivery() {
  return (
    stage() +
    r(0, 0, W, H, '#25302844') +
    r(428, 159, 584, 524, paper, 15) +
    txt(459, 210, '导出设计', 25, ink, bold) +
    ic('close', 964, 189, 19) +
    ln(428, 232, 1012, 232) +
    txt(460, 272, '范围', 15, sub) +
    pill(461, 291, 180, '当前画板', { fill: leaf, stroke: teal }) +
    pill(651, 291, 180, '整份设计') +
    txt(460, 372, '格式', 15, sub) +
    ['PNG 图像', 'PDF 文档', 'HTML 压缩包']
      .map((a, i) =>
        g(
          463,
          393 + i * 49,
          ci(9, 9, 8, paper, i === 1 ? teal : line, 2) +
            (i === 1 ? ci(9, 9, 4, teal) : '') +
            txt(31, 15, a, 15),
        ),
      )
      .join('') +
    ln(428, 568, 1012, 568) +
    txt(460, 618, 'X2 · 封面与歌词切换', 14, sub) +
    pill(855, 598, 126, '导出 PDF', { dark: true })
  )
}
const vocabulary = {
  zh: [
    '制品库',
    '最近设计',
    '搜索制品',
    '最近',
    '收藏',
    '项目',
    '创建设计',
    '潮间带 · 播放器',
    '岩间步道',
    '夜班指南',
    '听海图集',
    '渡口时刻',
    '岸线地图',
  ],
  de: [
    'Bibliothek',
    'Letzte Entwürfe',
    'Designs suchen',
    'Zuletzt',
    'Favoriten',
    'Projekte',
    'Design erstellen',
    '潮间带 · 播放器',
    '岩间步道',
    '夜班指南',
    '听海图集',
    '渡口时刻',
    '岸线地图',
  ],
  ar: [
    'المكتبة',
    'أحدث التصاميم',
    'ابحث عن تصميم',
    'الأخيرة',
    'المفضّلة',
    'المشاريع',
    'إنشاء تصميم',
    '潮间带 · 播放器',
    '岩间步道',
    '夜班指南',
    '听海图集',
    '渡口时刻',
    '岸线地图',
  ],
}
function coverArt(i) {
  const bgs = ['#C4D9CB', '#E6A992', '#ACB6C7', '#B5C5CB', '#F3D3A0', '#C4C49D']
  let s = r(0, 0, 300, 146, bgs[i])
  if (i === 0 || i === 3)
    s +=
      mount(124, -34, 178, 194, 300, 260, shore(i === 3 ? 2 : 0)) +
      txt(15, 36, i === 0 ? 'TIDELINE' : 'LOW TIDE', 13, ink, { mono: true }) +
      txt(14, 102, i === 0 ? '潮 间 带' : '听　海', 27, ink, bold)
  else if (i === 1 || i === 5) {
    for (let j = 0; j < 12; j++)
      s += p(
        `M${-20 + j * 15} 150Q${56 + j * 13} ${40 - j * 3} ${156 + j * 14} ${76 - j * 2}T320 ${18 + j * 5}`,
        'none',
        i === 1 ? '#713E32' : '#505A3E',
        1.2,
      )
    s += txt(18, 39, i === 1 ? '岭线 / 01' : '海岸线', 19, ink, bold)
  } else
    s +=
      ci(210, 73, 58, i === 2 ? '#333E62' : '#E2AF64') +
      ci(210, 73, 40, i === 2 ? '#808BA7' : '#795D42') +
      ci(210, 73, 8, bgs[i]) +
      txt(16, 35, i === 2 ? 'NIGHT SHIFT' : 'FERRY', 13, ink, { mono: true }) +
      txt(17, 111, i === 2 ? '夜班' : '06:40', 33, ink, bold)
  return s
}
function library(lang = 'zh') {
  const v = vocabulary[lang],
    rtl = lang === 'ar',
    locale = { zh: 'zh-CN', de: 'de-DE', ar: 'ar-EG' }[lang]
  const px = (x, w = 0) => (rtl ? W - x - w : x)
  const t = (x, y, s, z = 15, col = ink, opt = {}) => txt(px(x), y, s, z, col, { ...opt, rtl })
  const b = (x, y, w, h, c, rx = 0, st = 'none') => r(px(x, w), y, w, h, c, rx, st)
  const date = new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date('2026-11-23T12:00:00Z'))
  let s =
    r(0, 0, W, H, '#FAFBF8') +
    b(0, 0, 221, H, '#F1F3EE') +
    ln(px(221), 0, px(221), H) +
    brand(px(22, 25), 24) +
    t(62, 43, 'Akasha', 19, ink, bold) +
    t(24, 101, v[0], 13, sub) +
    b(14, 122, 194, 39, leaf, 8) +
    t(32, 149, v[3], 16, teal, bold) +
    t(32, 196, v[4], 15) +
    t(24, 268, v[5], 13, sub) +
    t(32, 313, 'Studio FM', 16) +
    t(260, 89, v[1], 34, ink, bold) +
    b(1090, 52, 170, 36, paper, 8, line) +
    t(1104, 76, v[2], 14, sub) +
    b(1272, 52, 143, 36, ink, 8) +
    t(1285, 76, v[6], 14, paper) +
    ln(px(260), 128, px(1407), 128)
  for (let i = 0; i < 6; i++) {
    const x = 260 + (i % 3) * 387,
      y = 163 + Math.floor(i / 3) * 286
    s +=
      r(px(x, 349), y, 349, 174, paper, 6, line) +
      mount(px(x, 349) + 1, y + 1, 347, 172, 300, 146, coverArt(i)) +
      txt(rtl ? px(x) : x, y + 207, v[7 + i], 19, ink, rtl ? { ...bold, ...end } : bold) +
      t(x, y + 232, `${date} · Studio FM`, 13, sub)
  }
  return s
}
function scale() {
  let s =
    r(0, 0, W, H, ground) +
    header() +
    pill(20, 73, 161, '录音档案', { icon: 'grid' }) +
    txt(56, 157, '录音档案', 31, ink, bold) +
    txt(225, 155, '1,000', 16, sub, { mono: true }) +
    pill(1124, 74, 283, '查找画板    #0512', { icon: 'search' })
  for (let i = 0; i < 1000; i++) {
    const x = 55 + (i % 40) * 27,
      y = 207 + Math.floor(i / 40) * 21
    const k = (Math.floor(i / 40) + Math.floor((i % 40) / 8)) % 4,
      cols = ['#B7C7BD', '#C4BBA9', '#BBC6CE', '#CFB3A8']
    s += r(x, y, 20, 14, cols[k], 1, i === 511 ? teal : 'none', i === 511 ? 3 : 1)
    if (i === 511) s += ci(x + 10, y + 7, 3, teal)
  }
  return (
    s +
    r(1159, 183, 253, 276, paper, 9, line) +
    mount(1174, 200, 222, 150, 300, 260, shore()) +
    txt(1176, 390, '北堤晨讯', 20, ink, bold) +
    txt(1176, 417, '#0512', 13, sub, { mono: true }) +
    ic('expand', 1372, 383, 17) +
    dock()
  )
}
function states() {
  const names = ['首次加载', '首次使用', '未找到结果', '单板失败']
  let s = r(0, 0, W, H, ground)
  for (let i = 0; i < 4; i++) {
    const x = 44 + (i % 2) * 700,
      y = 52 + Math.floor(i / 2) * 401
    let b =
      r(0, 0, 650, 318, paper, 10, line) +
      txt(24, 43, i === 3 ? 'X2 · 封面与歌词切换' : '制品库', 18, ink, bold) +
      ln(0, 65, 650, 65)
    if (i === 0) {
      for (let j = 0; j < 3; j++) {
        const a = 22 + j * 205
        b +=
          r(a, 91, 184, 98, field, 5) +
          r(a, 207, 120 - j * 11, 13, '#E3E8E1', 5) +
          r(a, 233, 75, 9, field, 4)
      }
    } else {
      if (i === 2) b += pill(20, 78, 142, '海盐录音', { icon: 'search' })
      b +=
        ic(['', 'folder', 'search', 'retry'][i], 309, i === 2 ? 133 : 107, 29, teal) +
        txt(
          325,
          i === 2 ? 196 : 173,
          ['', '还没有设计', '未找到匹配的制品', '画板加载失败'][i],
          20,
          ink,
          { ...mid, ...bold },
        ) +
        pill(254, i === 2 ? 218 : 198, 142, ['', '创建设计', '清除筛选', '重新加载'][i], {
          dark: i === 1,
        })
    }
    s += txt(x, y, names[i], 16, sub) + g(x, y + 17, b)
  }
  return s
}
const groups = [
  [
    'studio',
    '工作区与检查器',
    [
      ['overview', '同页动效总览', () => stage()],
      ['properties', '选中画板 · 属性', properties],
      ['code', '选中画板 · 源码', source],
      ['tweaks', '作品专属调参', tweaks],
    ],
  ],
  [
    'journey',
    '从创建到交付',
    [
      ['library', '制品库', () => library()],
      ['create', '新建设计与参考图', createDesign],
      ['review', '会话与批注', review],
      ['play', '显式试玩', play],
      ['share', '分享指定画板与版本', sharing],
      ['export', '导出单张画板', delivery],
    ],
  ],
  [
    'quality',
    '状态、规模与语言',
    [
      ['states', '加载、空与失败', states],
      ['density', '单页千板定位', scale],
      ['de', '长译文 · 德语', () => library('de')],
      ['ar', '双向排版 · 阿拉伯语', () => library('ar')],
    ],
  ],
]
const out = resolve(process.argv[2] ?? '.artifacts/workspace-next')
await mkdir(out, { recursive: true })
const pages = [],
  boards = []
for (const [pageId, name, items] of groups) {
  pages.push({ id: pageId, title: name, includeSharedBoards: false })
  for (const [i, [id, label, draw]] of items.entries()) {
    const lang = { de: 'de-DE', ar: 'ar-EG' }[id] ?? 'zh-CN'
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xml:lang="${lang}" role="img" aria-labelledby="title"><title id="title" xml:lang="zh-CN">${esc(label)}</title>${draw()}</svg>`
    await writeFile(join(out, id + '.svg'), svg)
    boards.push({
      id,
      title: label,
      pageId,
      position: { x: (i % 2) * (W + 100), y: Math.floor(i / 2) * (H + 110) },
      viewport: { width: W, height: H },
      html: svg,
    })
  }
}
await writeFile(
  join(out, 'workspace.artboard.json'),
  JSON.stringify({
    title: 'Akasha · 设计工作区实施稿',
    columns: 2,
    pages,
    boards,
    showFlows: false,
    handDrawnFlows: false,
    flows: [],
  }),
)
console.log(`${pages.length} 个页面，${boards.length} 张独立静态图板`)
