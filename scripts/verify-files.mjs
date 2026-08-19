import { readdir } from "node:fs/promises"
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { join } from "node:path"

const require = createRequire(import.meta.url)
const adapter = require.resolve("@vercel/next/dist/adapter/index.js")

const build = spawnSync("next", ["build"], {
  env: { ...process.env, NEXT_ADAPTER_PATH: adapter },
  stdio: ["ignore", "ignore", "inherit"],
  shell: true,
})
if (build.status !== 0) process.exit(build.status ?? 1)

const walk = async (path, found = []) => {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const next = join(path, entry.name)
    if (entry.name.endsWith(".func")) found.push(next)
    else if (entry.isDirectory()) await walk(next, found)
  }
  return found
}

const funcs = (await walk(join(".next", "output", "functions", "api"))).sort()

console.log(`\nfunction directories written for 4 route handlers: ${funcs.length}\n`)
for (const f of funcs) {
  console.log(`  ${f}${f.endsWith(".rsc.func") ? "   <- unreachable duplicate" : ""}`)
}
console.log("")
