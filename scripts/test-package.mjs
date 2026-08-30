import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import crossSpawn from 'cross-spawn'

const packageName = '@cofy-x/dsh-console-trajectory'
const runtimePackages = [
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-commands',
  '@deepseek-ai/dsh-session',
  '@deepseek-ai/dsh-session-query',
]

function run(command, args, cwd = process.cwd()) {
  return new Promise((resolve, reject) => {
    const child = crossSpawn(command, args, { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.once('error', reject)
    child.once('exit', code => resolve({ code, stdout, stderr }))
  })
}

function succeeded(label, result) {
  assert.equal(result.code, 0, `${label} failed:\n${result.stdout}\n${result.stderr}`)
}

const manifest = JSON.parse(await readFile('package.json', 'utf8'))
assert.equal(manifest.name, packageName)
assert.equal(manifest.engines?.node, '>=24')
assert.equal(manifest.publishConfig?.access, 'public')
assert.deepEqual(manifest.dsh?.compatibility, {
  minimum: '0.1.1-rc.2',
  maximumTested: '0.1.2-alpha.1',
})
for (const name of runtimePackages) {
  assert.equal(manifest.dependencies?.[name], undefined, `${name} must not ship as a runtime dependency`)
  assert.ok(manifest.devDependencies?.[name], `${name} must be available for development`)
  assert.ok(manifest.peerDependencies?.[name], `${name} must be declared as a host peer`)
  assert.equal(manifest.peerDependenciesMeta?.[name]?.optional, true, `${name} must be an optional peer`)
}
for (const name of runtimePackages.filter(name => name !== '@deepseek-ai/cordis')) {
  assert.equal(
    manifest.peerDependencies[name],
    `>=${manifest.dsh.compatibility.minimum} <=${manifest.dsh.compatibility.maximumTested}`,
    `${name} must stay inside the audited DSH compatibility window`,
  )
  assert.equal(manifest.devDependencies[name], manifest.dsh.compatibility.minimum)
}

const temporaryRoot = await mkdtemp(join(tmpdir(), 'dsh-console-trajectory-package-'))
try {
  const packed = await run('npm', ['pack', '--json', '--silent', '--pack-destination', temporaryRoot])
  succeeded('npm pack', packed)
  const [result] = JSON.parse(packed.stdout)
  assert.equal(result.name, packageName)
  assert.equal(result.version, manifest.version)
  const paths = result.files.map(file => file.path)
  for (const path of paths) {
    assert.match(path, /^(?:LICENSE|README\.md|THIRD_PARTY_NOTICES\.md|UPSTREAM\.md|cordis\.patch\.yml|package\.json|dist\/)/u)
    assert.ok(!path.endsWith('.map'), `source map leaked into tarball: ${path}`)
    assert.ok(!/(?:^|\/)(?:tests?|coverage|\.git|\.github|node_modules)(?:\/|$)/u.test(path), `repository artifact leaked into tarball: ${path}`)
  }

  const tarball = join(temporaryRoot, result.filename)
  const extracted = await run('tar', ['-xzf', tarball, '-C', temporaryRoot])
  succeeded('tarball extraction', extracted)
  const textFiles = paths.filter(path => /\.(?:css|d\.ts|html|js|json|md|yml)$/u.test(path))
  const sensitive = /(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:api[_-]?key|password|private[_-]?key)\s*[:=]\s*["'][^"']{8,})/iu
  for (const path of textFiles) {
    const content = await readFile(join(temporaryRoot, 'package', path), 'utf8')
    assert.doesNotMatch(content, sensitive, `possible sensitive content in ${path}`)
  }

  const consumer = join(temporaryRoot, 'consumer')
  await mkdir(consumer)
  const installed = await run('npm', [
    'install', '--ignore-scripts', '--package-lock=false', '--omit=optional', '--no-audit', '--no-fund', tarball,
  ], consumer)
  succeeded('tarball installation', installed)
  const installedManifest = JSON.parse(await readFile(join(consumer, 'node_modules', '@cofy-x', 'dsh-console-trajectory', 'package.json'), 'utf8'))
  assert.equal(installedManifest.version, manifest.version)
  for (const name of runtimePackages) {
    const installedRuntime = join(consumer, 'node_modules', ...name.split('/'), 'package.json')
    await assert.rejects(readFile(installedRuntime, 'utf8'), { code: 'ENOENT' })
  }
} finally {
  await rm(temporaryRoot, { recursive: true, force: true })
}

console.log(`verified ${packageName}@${manifest.version} tarball and isolated install`)
