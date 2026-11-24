const bundle = JSON.parse(document.getElementById('akasha-offline-data').textContent)
const title = document.querySelector('h1')
const picker = document.querySelector('select')
const routes = document.querySelector('nav')
const frame = document.querySelector('iframe')
const status = document.getElementById('status')
const boards = new Map(bundle.boards.map((board) => [board.id, board]))
let current

function show(board) {
  current = board
  picker.value = board.id
  status.textContent = '正在打开…'
  frame.title = `画板内容：${board.title}`
  frame.width = board.width
  frame.height = board.height
  frame.style.borderRadius = `${board.boardAppearance?.cornerRadius ?? 0}px`
  frame.srcdoc =
    bundle.frameStart + JSON.stringify(board).replaceAll('<', '\\u003c') + bundle.frameEnd
  routes.replaceChildren()
  for (const flow of bundle.flows) {
    if (flow.from !== board.id) continue
    const next = boards.get(flow.to)
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = flow.label || `前往 ${next.title}`
    button.addEventListener('click', () => show(next))
    routes.append(button)
  }
}

window.addEventListener('message', ({ source, origin, data }) => {
  if (source !== frame.contentWindow || origin !== 'null' || !data) return
  if (data.type === 'akasha.offline.ready') status.textContent = ''
  if (data.type === 'akasha.offline.error' && typeof data.message === 'string') {
    status.textContent = `无法打开画板：${data.message.slice(0, 600)}`
  }
  if (data.type === 'akasha.offline.exit') picker.focus()
  if (data.type !== 'akasha.offline.navigate' || typeof data.target !== 'string') return
  const canGo = bundle.flows.find(
    ({ from, to }) =>
      from === current.id && (to === data.target || boards.get(to).legacyId === data.target),
  )
  if (canGo) show(boards.get(canGo.to))
  else status.textContent = '当前画板无法跳转到该目标。'
})

title.textContent = `${bundle.title} · v${bundle.version}`
document.title = title.textContent
for (const board of boards.values()) picker.add(new Option(board.title, board.id))
picker.addEventListener('change', () => show(boards.get(picker.value)))
show(boards.values().next().value)
