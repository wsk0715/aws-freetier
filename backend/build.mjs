import { rmSync } from 'node:fs'

import { build } from 'esbuild'

const FUNCTIONS = ['receive', 'worker', 'history', 'ops', 'query']

rmSync('dist', { recursive: true, force: true })

await Promise.all(
  FUNCTIONS.map((name) =>
    build({
      entryPoints: [`src/${name}/handler.ts`],
      outfile: `dist/${name}/index.js`,
      bundle: true,
      platform: 'node',
      target: 'node22',
      format: 'cjs',
      sourcemap: false,
      minify: false,
    }),
  ),
)

console.log(`함수 ${FUNCTIONS.length}개를 dist/에 빌드했다`)
