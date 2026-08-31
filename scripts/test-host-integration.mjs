import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import crossSpawn from 'cross-spawn'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const consoleRoot = resolve(process.env.DSH_CONSOLE_ROOT ?? join(root, '..', 'dsh-console'))
const consolePackage = resolve(process.env.DSH_CONSOLE_PACKAGE_ROOT ?? join(consoleRoot, 'apps', 'cli'))
const trajectoryPackage = resolve(process.env.DSH_TRAJECTORY_PACKAGE_ROOT ?? root)
const dshBin = resolve(process.env.DSH_BIN ?? join(consoleRoot, 'node_modules', '.bin', 'dsh'))
const fakePlugin = pathToFileURL(join(consoleRoot, 'scripts', 'fixtures', 'dsh-integration', 'fake-llm.mjs')).href
const probePlugin = pathToFileURL(join(root, 'scripts', 'fixtures', 'host-integration-probe.mjs')).href

async function run(command, args, options) {
  return new Promise((resolvePromise, reject) => {
    const child = crossSpawn(command, args, {
      ...options,
      signal: AbortSignal.timeout(45_000),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk })
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk })
    child.once('error', reject)
    child.once('close', (code, signal) => { resolvePromise({ code, signal, stdout, stderr }) })
  })
}

const trajectoryManifest = JSON.parse(await readFile(join(trajectoryPackage, 'package.json'), 'utf8'))
const consoleManifest = JSON.parse(await readFile(join(consolePackage, 'package.json'), 'utf8'))
assert.equal(trajectoryManifest.dependencies['@deepseek-ai/cordis'], undefined)
assert.equal(consoleManifest.dependencies['@deepseek-ai/cordis'], undefined)

const temporaryRoot = await mkdtemp(join(tmpdir(), 'dsh-console-trajectory-integration-'))
try {
  const home = join(temporaryRoot, '.dsh')
  const profileDir = join(home, 'profiles', 'trajectory-integration')
  const packageScope = join(profileDir, 'node_modules', '@cofy-x')
  const resultFile = join(temporaryRoot, 'result.json')
  await mkdir(packageScope, { recursive: true })
  await symlink(consolePackage, join(packageScope, 'dsh-console'), process.platform === 'win32' ? 'junction' : 'dir')
  await symlink(trajectoryPackage, join(packageScope, 'dsh-console-trajectory'), process.platform === 'win32' ? 'junction' : 'dir')
  await writeFile(join(profileDir, 'package.json'), JSON.stringify({
    name: 'dsh-profile-trajectory-integration',
    private: true,
    dependencies: {
      '@cofy-x/dsh-console': consoleManifest.version,
      '@cofy-x/dsh-console-trajectory': trajectoryManifest.version,
    },
    dsh: { profile: { bundles: [
      '@deepseek-ai/dsh-base',
      '@cofy-x/dsh-console',
      '@cofy-x/dsh-console-trajectory',
    ] } },
  }, undefined, 2))
  await writeFile(join(profileDir, 'cordis.patch.yml'), [
    '- id: dsh-console-runner',
    '  disabled: true',
    '- id: session-title-llm',
    '  disabled: true',
    '- insert:',
    '    - id: dsh-console-trajectory-integration-fake-llm',
    `      name: '${fakePlugin}'`,
    '    - id: dsh-console-trajectory-integration-probe',
    `      name: '${probePlugin}'`,
    '',
  ].join('\n'))

  const result = await run(dshBin, ['--profile', 'trajectory-integration'], {
    cwd: temporaryRoot,
    env: {
      ...process.env,
      DSH_HOME: home,
      DSH_AGENTS_HOME: join(temporaryRoot, '.agents'),
      DSH_TELEMETRY_DISABLED: '1',
      DSH_TRAJECTORY_INTEGRATION_RESULT: resultFile,
      DEEPSEEK_API_KEY: 'keyless-integration-no-network-call',
    },
  })
  assert.equal(result.code, 0, `host integration exited ${result.code} (${result.signal})\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`)
  const observed = JSON.parse(await readFile(resultFile, 'utf8'))
  assert.equal(observed.frontendStatus, 200)
  assert.equal(observed.initialSnapshotStatus, 200)
  assert.equal(observed.historyStatus, 200)
  assert.equal(observed.missingStatus, 404)
  assert.equal(observed.liveEvent, true)
  assert.match(observed.viewerUrl, /^http:\/\/127\.0\.0\.1:\d+\/trajectory\//u)
  assert.ok(observed.initialSessions.some(session => session.id === 'dsh-console-trajectory-first' && session.live))
  assert.ok(observed.sessions.some(session => session.id === 'dsh-console-trajectory-first' && !session.live))
  assert.ok(observed.sessions.some(session => session.id === 'dsh-console-trajectory-second' && session.live && session.current))
} finally {
  await rm(temporaryRoot, { recursive: true, force: true })
}

console.log('verified Console + trajectory host integration and clean process exit')
