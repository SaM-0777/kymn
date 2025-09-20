await Bun.build({
  entrypoints: ["src/index.ts"],
  outdir: "dist",
  target: "node",
  external: ["ethers"],
  format: "esm",
  sourcemap: "linked",
  minify: true,
})