import { createRequire } from "node:module"

const require = createRequire(import.meta.url)

// Default to the local probe adapter, which only reports what Next.js passes to onBuildComplete and
// pulls in no provider packages. `npm run verify:files` sets NEXT_ADAPTER_PATH to a real adapter to
// show the duplicate outputs being written to disk.
export default {
  adapterPath: process.env.NEXT_ADAPTER_PATH ?? require.resolve("./scripts/probe-adapter.cjs"),
}
