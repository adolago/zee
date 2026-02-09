// Keep this file CommonJS because the repo root is ESM ("type": "module").
// dependency-cruiser loads config via require().

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "core-must-not-import-personas-packages",
      severity: "error",
      // Exception: the embedded Zee gateway is intentionally bundled into zee-core.
      from: { path: "^packages/zee-core/src/", pathNot: "^packages/zee-core/src/gateway/embedded-gateway\\.ts$" },
      to: { path: "^packages/personas/" },
    },
  ],
  options: {
    doNotFollow: {
      path: "node_modules",
    },
    exclude: {
      path: [
        "^node_modules/",
        "^packages/zee-core/dist/",
        "^packages/zee-core/dist-check/",
        "^target/",
      ].join("|"),
    },
    enhancedResolveOptions: {
      conditionNames: ["browser", "import", "default", "node"],
      extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json"],
    },
  },
}
