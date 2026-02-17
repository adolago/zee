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
  node_modules ? callPackage ./node_modules.nix { },
}:
stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "zee";
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
  env.ZEE_VERSION = finalAttrs.version;
  env.ZEE_CHANNEL = "local";

  buildPhase = ''
    runHook preBuild

    cd ./packages/zee
    bun --bun ./script/build.ts --single --skip-install
    bun --bun ./script/schema.ts schema.json

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    cd packages/zee
    dist_dir=$(ls -d dist/@adolago/zee-* 2>/dev/null | sort | head -n1)
    if [ -z "$dist_dir" ]; then
      echo "ERROR: dist directory not found under packages/zee/dist/@zee"
      find dist -maxdepth 3 -type d -print || true
      exit 1
    fi

    mkdir -p $out/lib/zee
    cp -r "$dist_dir" "$out/lib/zee/"

    install -Dm644 schema.json $out/share/zee/schema.json

    mkdir -p $out/bin
    dist_base="$(basename "$dist_dir")"
    makeWrapper "$out/lib/zee/$dist_base/bin/zee" "$out/bin/zee" \
      --prefix PATH : ${
        lib.makeBinPath (
          [
            ripgrep
          ]
          # bun runs sysctl to detect if running on rosetta2
          ++ lib.optional stdenvNoCC.hostPlatform.isDarwin sysctl
        )
      } \
      --set-default ZEE_ROOT "$out/lib/zee/$dist_base" \
      --argv0 zee
    runHook postInstall
  '';

  postInstall = lib.optionalString (stdenvNoCC.buildPlatform.canExecute stdenvNoCC.hostPlatform) ''
    # trick yargs into also generating zsh completions
    installShellCompletion --cmd zee \
      --bash <($out/bin/zee completion) \
      --zsh <(SHELL=/bin/zsh $out/bin/zee completion)
  '';

  nativeInstallCheckInputs = [
    versionCheckHook
    writableTmpDirAsHomeHook
  ];
  doInstallCheck = true;
  versionCheckKeepEnvironment = [ "HOME" ];
  versionCheckProgramArg = "--version";

  passthru = {
    jsonschema = "${placeholder "out"}/share/zee/schema.json";
  };

  meta = {
    description = "The open source coding agent";
    license = lib.licenses.mit;
    platforms = [
      "aarch64-linux"
      "x86_64-linux"
    ];
    mainProgram = "zee";
  };
})
