const list = (label, items) => {
  console.log(`\n  ${label} (${items.length})`)
  for (const item of items) console.log(`    ${item}`)
}

module.exports = {
  name: "probe",
  onBuildComplete(ctx) {
    const dynamicRoutes = ctx.routing.dynamicRoutes || []
    const appRoutes = ctx.outputs.appRoutes || []

    list("routing.dynamicRoutes", dynamicRoutes.map((r) => r.source))
    list("outputs.appRoutes", appRoutes.map((o) => `${o.pathname}  (type ${o.type}, from ${o.sourcePage})`))

    // Each .rsc output points at the same built asset as its twin, so any adapter writing these
    // out produces two copies of one handler.
    const pairs = appRoutes.filter((o) => o.pathname.endsWith(".rsc"))
    console.log("\n  duplicate outputs share a filePath:")
    for (const rsc of pairs) {
      const base = appRoutes.find((o) => o.pathname === rsc.pathname.slice(0, -4))
      if (base) console.log(`    ${base.pathname} and ${rsc.pathname} -> ${base.filePath === rsc.filePath ? "same" : "different"}  (${base.filePath})`)
    }
    console.log("")
  },
}
