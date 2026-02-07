// Keep this file CommonJS because the repo root is ESM ("type": "module").
// dependency-cruiser loads config via require().

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "core-must-not-import-personas-packages",
      severity: "error",
      // Exception: the embedded Zee gateway is intentionally bundled into agent-core.
      from: { path: "^packages/agent-core/src/", pathNot: "^packages/agent-core/src/gateway/embedded-gateway\\.ts$" },
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
        "^packages/agent-core/dist/",
        "^packages/agent-core/dist-check/",
        "^target/",
      ].join("|"),
    },
    enhancedResolveOptions: {
      conditionNames: ["browser", "import", "default", "node"],
      extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json"],
    },
  },
}
