{
  lib,
  stdenvNoCC,
  callPackage,
  bun,
  sysctl,
  makeBinaryWrapper,
  models-dev,
  ripgrep,
  installShellFiles,
  versionCheckHook,
  writableTmpDirAsHomeHook,
  node_modules ? callPackage ./node-modules.nix { },
}:
stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "agent-core";
  inherit (node_modules) version src;
  inherit node_modules;

  nativeBuildInputs = [
    bun
    installShellFiles
    makeBinaryWrapper
    models-dev
    writableTmpDirAsHomeHook
  ];

  configurePhase = ''
    runHook preConfigure

    cp -R ${finalAttrs.node_modules}/. .

    runHook postConfigure
  '';

  env.MODELS_DEV_API_JSON = "${models-dev}/dist/_api.json";
  env.AGENT_CORE_VERSION = finalAttrs.version;
  env.AGENT_CORE_CHANNEL = "local";

  buildPhase = ''
    runHook preBuild

    cd ./packages/agent-core
    bun --bun ./script/build.ts --single --skip-install
    bun --bun ./script/schema.ts schema.json

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    cd packages/agent-core
    install -Dm755 dist/agent-core-*/bin/opencode $out/bin/agent-core
    install -Dm644 schema.json $out/share/agent-core/schema.json

    mkdir -p $out/lib/agent-core
    cp -r dist $out/lib/agent-core/
    chmod -R u+w $out/lib/agent-core/dist

    # Select bundled worker assets deterministically (sorted find output)
    worker_file=$(find "$out/lib/agent-core/dist" -type f \( -path '*/tui/worker.*' -o -name 'worker.*' \) | sort | head -n1)
    parser_worker_file=$(find "$out/lib/agent-core/dist" -type f -name 'parser.worker.*' | sort | head -n1)
    if [ -z "$worker_file" ]; then
      echo "ERROR: bundled worker not found"
      exit 1
    fi

    main_wasm=$(printf '%s\n' "$out"/lib/agent-core/dist/tree-sitter-*.wasm | sort | head -n1)
    wasm_list=$(find "$out/lib/agent-core/dist" -maxdepth 1 -name 'tree-sitter-*.wasm' -print)
    for patch_file in "$worker_file" "$parser_worker_file"; do
      [ -z "$patch_file" ] && continue
      [ ! -f "$patch_file" ] && continue
      if [ -n "$wasm_list" ] && grep -q 'tree-sitter' "$patch_file"; then
        # Rewrite wasm references to absolute store paths to avoid runtime resolve failures.
        bun --bun ${./scripts/patch-wasm.ts} "$patch_file" "$main_wasm" $wasm_list
      fi
    done

    mkdir -p $out/lib/agent-core/node_modules
    cp -r ../../node_modules/.bun $out/lib/agent-core/node_modules/
    mkdir -p $out/lib/agent-core/node_modules/@opentui

    mkdir -p $out/bin
    makeWrapper ${bun}/bin/bun $out/bin/agent-core \
      --add-flags "run" \
      --add-flags "$out/lib/agent-core/dist/src/index.js" \
      --prefix PATH : ${
        lib.makeBinPath (
          [
            ripgrep
          ]
          # bun runs sysctl to detect if dunning on rosetta2
          ++ lib.optional stdenvNoCC.hostPlatform.isDarwin sysctl
        )
      } \
      --argv0 agent-core

    runHook postInstall
  '';

  postInstall = lib.optionalString (stdenvNoCC.buildPlatform.canExecute stdenvNoCC.hostPlatform) ''
    # trick yargs into also generating zsh completions
    installShellCompletion --cmd agent-core \
      --bash <($out/bin/agent-core completion) \
      --zsh <(SHELL=/bin/zsh $out/bin/agent-core completion)
  '';

  nativeInstallCheckInputs = [
    versionCheckHook
    writableTmpDirAsHomeHook
  ];
  doInstallCheck = true;
  versionCheckKeepEnvironment = [ "HOME" ];
  versionCheckProgramArg = "--version";

  passthru = {
    jsonschema = "${placeholder "out"}/share/agent-core/schema.json";
  };

  meta = {
    description = "The open source coding agent";
    license = lib.licenses.mit;
    platforms = [
      "aarch64-linux"
      "x86_64-linux"
    ];
    mainProgram = "agent-core";
  };
})
