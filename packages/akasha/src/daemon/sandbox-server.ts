import fs from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
}

export interface SandboxServerOptions {
  host: string
  port: number
  shellOrigins: readonly string[]
  sandboxDir?: string
}

// 独立 Origin 沙盒静态服务器：严格下发隔离 CSP（connect-src 'none'、frame-ancestors 仅外壳 origin），
// 杜绝不可信 AI 生成代码外传数据或被第三方页面嵌套。
export async function startSandboxServer(options: SandboxServerOptions) {
  const frameAncestors = options.shellOrigins.join(' ')
  const csp = [
    "default-src 'none'",
    "script-src 'self' blob:",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'none'",
    `frame-ancestors ${frameAncestors}`,
  ].join('; ')

  const resolvedDir = options.sandboxDir ? path.resolve(options.sandboxDir) : undefined

  const server = http.createServer((req, res) => {
    res.setHeader('Content-Security-Policy', csp)
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'no-referrer')
    // 不带 allow-same-origin 的 iframe 具有不透明源 "null"，其加载同站 ES Module (<script type="module">)
    // 需放行静态只读资源的 CORS 读取；安全边界仍由 frame-ancestors 与 connect-src 'none' 严格保障。
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405)
      res.end('Method Not Allowed')
      return
    }

    const reqPath = (req.url ?? '/').split('?')[0] ?? '/'
    if (resolvedDir && fs.existsSync(resolvedDir)) {
      const rel = reqPath === '/' ? 'index.html' : reqPath.replace(/^\/+/, '')
      const target = path.resolve(resolvedDir, rel)
      const isInside = target === resolvedDir || target.startsWith(`${resolvedDir}${path.sep}`)
      if (isInside && fs.existsSync(target) && fs.statSync(target).isFile()) {
        const ext = path.extname(target).toLowerCase()
        res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] ?? 'application/octet-stream' })
        if (req.method === 'HEAD') {
          res.end()
        } else {
          fs.createReadStream(target).pipe(res)
        }
        return
      }
      const fallback = path.join(resolvedDir, 'index.html')
      if (fs.existsSync(fallback)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(fs.readFileSync(fallback))
        return
      }
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(
      '<!doctype html><html><head><meta charset="utf-8"><title>Akasha Sandbox</title></head><body><div id="root">Akasha Sandbox Runtime Ready</div></body></html>',
    )
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port, options.host, () => resolve())
  })

  const actualPort = (server.address() as AddressInfo).port

  const close = async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve())
      if (typeof server.closeAllConnections === 'function') {
        server.closeAllConnections()
      }
    })
  }

  return {
    server,
    port: actualPort,
    origin: `http://${options.host}:${actualPort}`,
    csp,
    close,
  }
}
