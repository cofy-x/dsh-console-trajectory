import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { LazyWebServer } from './lazy-webserver.js'
import type { ViewerServerHandle } from './runtime.js'

const CLIENT_ROOT = fileURLToPath(new URL('./client/', import.meta.url))
const TRAJECTORY_PATH = /^\/trajectory\/[^/]+\/?$/
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
}

export function registerTrajectoryFrontend(server: LazyWebServer): () => void {
  return server.registerFallback(async (request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405); response.end(); return }
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
    const file = TRAJECTORY_PATH.test(pathname)
      ? join(CLIENT_ROOT, 'index.html')
      : /^\/assets\/[a-zA-Z0-9._-]+$/.test(pathname)
        ? join(CLIENT_ROOT, pathname.slice(1))
        : undefined
    if (file === undefined) { response.writeHead(404); response.end(); return }
    try {
      const body = await readFile(file)
      response.writeHead(200, {
        'cache-control': file.endsWith('index.html') ? 'no-store' : 'public, max-age=31536000, immutable',
        'content-type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream',
        'x-content-type-options': 'nosniff',
      })
      response.end(request.method === 'HEAD' ? undefined : body)
    } catch { response.writeHead(404); response.end() }
  })
}

export async function startTrajectoryServer(server: LazyWebServer, signal: AbortSignal): Promise<ViewerServerHandle> {
  if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('viewer startup aborted')
  try {
    const port = await server.listen()
    if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('viewer startup aborted')
    return Object.freeze({ origin: `http://127.0.0.1:${port}`, dispose: async () => { await server.close() } })
  } catch (error) { await server.close(); throw error }
}
