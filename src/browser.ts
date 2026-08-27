import { spawn } from 'node:child_process'

const SECRET_ENV = /(?:api[_-]?key|token|secret|password|credential|private[_-]?key)/iu

export function sanitizedEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(source).filter(([name]) => !SECRET_ENV.test(name)))
}

export async function openLocalBrowser(url: string, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('browser open aborted')
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open'
  const args = process.platform === 'win32' ? ['/d', '/s', '/c', 'start', '', url] : [url]
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      env: sanitizedEnvironment(),
      stdio: 'ignore',
      windowsHide: true,
    })
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}
