import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { build } from 'esbuild'
import { spawn } from 'node:child_process'

await rm('dist', { recursive: true, force: true })
await mkdir('dist/client/assets', { recursive: true })

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node24',
  packages: 'external',
  sourcemap: true,
})

await build({
  entryPoints: ['src/client/main.tsx'],
  outfile: 'dist/client/assets/app.js',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2024',
  minify: true,
  jsx: 'automatic',
  assetNames: '[name]-[hash]',
  loader: {
    '.ttf': 'file',
    '.woff': 'file',
    '.woff2': 'file',
  },
})

await writeFile('dist/client/index.html', `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light dark">
  <title>Trajectory Viewer</title>
  <link rel="stylesheet" href="/assets/app.css">
</head>
<body><div id="root"></div><script type="module" src="/assets/app.js"></script></body>
</html>
`)

await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [
    'node_modules/typescript/bin/tsc', '--project', 'tsconfig.build.json',
  ], { stdio: 'inherit' })
  child.once('error', reject)
  child.once('exit', code => code === 0 ? resolve() : reject(new Error(`tsc exited with ${code}`)))
})

const declaration = await readFile('dist/index.d.ts', 'utf8')
if (!declaration.includes('TrajectoryViewerRuntime')) throw new Error('public declaration is missing TrajectoryViewerRuntime')
