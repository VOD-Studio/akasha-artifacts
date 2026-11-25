const bundle = JSON.parse(document.getElementById('akasha-offline-data').textContent)
const labels = JSON.parse(document.getElementById('akasha-offline-labels').textContent)
const title = document.querySelector('h1')
const pagePicker = document.getElementById('page')
const boardPicker = document.getElementById('board')
const routes = document.querySelector('nav')
const stage = document.querySelector('main')
const status = document.getElementById('status')
const boards = new Map(bundle.boards.map((board) => [board.id, board]))
let currentPage
let frame
let current

function navigate(id) {
  if (currentPage && !currentPage.boardIds.includes(id)) {
    const destination = bundle.pages.find((page) => page.boardIds.includes(id))
    if (destination) selectPage(destination, id)
    return
  }
  show(boards.get(id))
}

function show(board) {
  current = board
  routes.replaceChildren()
  if (!board) {
    frame = undefined
    stage.replaceChildren()
    status.textContent = labels.empty
    return
  }
  boardPicker.value = board.id
  status.textContent = labels.opening
  // 每次打开都换浏览上下文，迟到的旧帧消息不能驱动新画板。
  frame = document.createElement('iframe')
  frame.setAttribute('sandbox', 'allow-scripts')
  frame.referrerPolicy = 'no-referrer'
  frame.title = labels.content.replace('{title}', () => board.title)
  frame.width = board.width
  frame.height = board.height
  frame.style.borderRadius = `${board.boardAppearance?.cornerRadius ?? 0}px`
  const boardJson = JSON.stringify(board).replaceAll('<', '\\u003c')
  frame.srcdoc = offlineFrames.frameStart + boardJson + offlineFrames.frameEnd
  stage.replaceChildren(frame)
  for (const flow of bundle.flows) {
    if (flow.from !== board.id) continue
    const next = boards.get(flow.to)
    if (!next) continue
    const button = document.createElement('button')
    button.type = 'button'
    button.dir = 'auto'
    button.textContent = flow.label || labels.go.replace('{title}', () => next.title)
    button.addEventListener('click', () => navigate(next.id))
    routes.append(button)
  }
}

function addOption(picker, text, value) {
  const option = new Option(text, value)
  option.dir = 'auto'
  picker.add(option)
}

function selectPage(page, id) {
  currentPage = page
  if (page) pagePicker.value = page.id
  boardPicker.replaceChildren()
  for (const boardId of page?.boardIds ?? boards.keys()) {
    const board = boards.get(boardId)
    if (board) addOption(boardPicker, board.title, board.id)
  }
  boardPicker.disabled = boardPicker.options.length === 0
  show(boards.get(id ?? boardPicker.value))
}

window.addEventListener('message', ({ source, origin, data }) => {
  if (!source || source !== frame?.contentWindow || origin !== 'null' || !data) return
  if (data.type === 'akasha.offline.ready') status.textContent = ''
  if (data.type === 'akasha.offline.error' && typeof data.message === 'string') {
    status.textContent = labels.error.replace('{error}', () => data.message.slice(0, 600))
  }
  if (data.type === 'akasha.offline.exit') boardPicker.focus()
  if (data.type !== 'akasha.offline.navigate' || typeof data.target !== 'string') return
  const canGo = bundle.flows.find(
    ({ from, to }) =>
      from === current.id && (to === data.target || boards.get(to)?.legacyId === data.target),
  )
  if (canGo) navigate(canGo.to)
  else status.textContent = labels.unreachable
})

title.textContent = `${bundle.title} · v${bundle.version}`
document.title = title.textContent
for (const page of bundle.pages) {
  let name = page.title
  if (page.id === '') name = page.title === '未分组' ? labels.ungrouped : labels.overview
  addOption(pagePicker, name, page.id)
}
pagePicker.parentElement.hidden = bundle.pages.length === 0
pagePicker.addEventListener('change', () => selectPage(bundle.pages[pagePicker.selectedIndex]))
boardPicker.addEventListener('change', () => show(boards.get(boardPicker.value)))
selectPage(bundle.pages[0])
