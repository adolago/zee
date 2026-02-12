// Keep this file CommonJS because the repo root is ESM ("type": "module").
// dependency-cruiser loads config via require().

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "core-must-not-import-swabble",
      severity: "error",
      // Exception: the embedded Zee gateway is intentionally bundled into zee.
      from: { path: "^packages/zee/src/", pathNot: "^packages/zee/src/gateway/embedded-gateway\\.ts$" },
      to: { path: "^packages/zee/Swabble/" },
    },
  ],
  options: {
    doNotFollow: {
      path: "node_modules",
    },
    exclude: {
      path: [
        "^node_modules/",
        "^packages/zee/dist/",
        "^packages/zee/dist-check/",
        "^target/",
      ].join("|"),
    },
    enhancedResolveOptions: {
      conditionNames: ["browser", "import", "default", "node"],
      extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json"],
    },
  },
}
