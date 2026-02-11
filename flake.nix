{
  description = "Zee engine with Personas system";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
  };

  outputs =
    { self, nixpkgs, ... }:
    let
      systems = [
        "aarch64-linux"
        "x86_64-linux"
      ];
      inherit (nixpkgs) lib;
      forEachSystem = f: lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
      pkgsFor = system: nixpkgs.legacyPackages.${system};
      rev = self.shortRev or self.dirtyShortRev or "dirty";
      packageJson = builtins.fromJSON (builtins.readFile ./packages/zee/package.json);
      bunTarget = {
        "aarch64-linux" = "bun-linux-arm64";
        "x86_64-linux" = "bun-linux-x64";
      };
      defaultNodeModules = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
      hashesFile = "${./nix}/hashes.json";
      hashesData =
        if builtins.pathExists hashesFile then builtins.fromJSON (builtins.readFile hashesFile) else { };
      nodeModulesHash = hashesData.nodeModules or defaultNodeModules;
      modelsDev = forEachSystem (
        system:
        let
          pkgs = pkgsFor system;
        in
        pkgs."models-dev"
      );

      # ==========================================================================
      # Stock Dependencies for Personas System
      # These are the same packages clients install via their package manager
      # ==========================================================================
      stockDeps = system:
        let
          pkgs = pkgsFor system;
        in
        {
          # Terminal & TUI
          wezterm = pkgs.wezterm;           # Terminal emulator with pane orchestration
          yazi = pkgs.yazi;                 # File manager

          # Vector Database
          qdrant = pkgs.qdrant;             # Semantic memory storage

          # Development Tools
          ripgrep = pkgs.ripgrep;           # Fast search (used by zee)
          fd = pkgs.fd;                     # Fast find
          fzf = pkgs.fzf;                   # Fuzzy finder
          jq = pkgs.jq;                     # JSON processing
          gh = pkgs.gh;                     # GitHub CLI

          # Python Environment (for OpenBB, NautilusTrader)
          python = pkgs.python312;
          pythonWithPackages = pkgs.python312.withPackages (ps: with ps; [
            pip
            virtualenv
            # Note: openbb and nautilus-trader are installed via pip
            # as they're not in nixpkgs. See setup instructions below.
          ]);

          # System utilities
          coreutils = pkgs.coreutils;
        };

      # Python packages that need pip install (not in nixpkgs)
      pythonPipPackages = [
        "openbb"              # OpenBB Platform for Stanley
        "nautilus-trader"     # NautilusTrader for Stanley
      ];
    in
    {
      # ========================================================================
      # Development Shells
      # ========================================================================
      devShells = forEachSystem (pkgs:
        let
          system = pkgs.system;
          deps = stockDeps system;
        in
        {
          # Minimal shell for zee development only
          default = pkgs.mkShell {
            packages = with pkgs; [
              bun
              nodejs_20
              pkg-config
              openssl
              git
            ];
          };

          # Full Personas development environment with all stock dependencies
          # Usage: nix develop .#personas
          personas = pkgs.mkShell {
            name = "personas-dev";

            packages = with pkgs; [
              # Core development
              bun
              nodejs_20
              pkg-config
              openssl
              git

              # Stock dependencies (same as clients use)
              deps.wezterm
              deps.yazi
              deps.qdrant
              deps.ripgrep
              deps.fd
              deps.fzf
              deps.jq
              deps.gh

              # Python environment
              deps.pythonWithPackages
            ];

            shellHook = ''
              echo ""
              echo "Personas Development Environment"
              echo ""
              echo "Stock dependencies loaded (same as client installations):"
              echo "  wezterm  - Terminal emulator with pane orchestration"
              echo "  yazi     - File manager"
              echo "  qdrant   - Vector database for semantic memory"
              echo "  ripgrep  - Fast code search"
              echo ""
              echo "Python packages (install via pip in venv):"
              echo "  pip install openbb           # Stanley: market data"
              echo "  pip install nautilus-trader  # Stanley: backtesting"
              echo ""

              # Create Python venv if it doesn't exist
              if [ ! -d ".venv" ]; then
                echo "Creating Python virtual environment..."
                python -m venv .venv
              fi

              # Activate venv
              source .venv/bin/activate

              # Set up qdrant data directory
              export QDRANT_DATA_DIR="''${QDRANT_DATA_DIR:-$HOME/.local/share/qdrant}"
              mkdir -p "$QDRANT_DATA_DIR"
            '';
          };

          # Minimal shell for CI/testing
          ci = pkgs.mkShell {
            packages = with pkgs; [
              bun
              nodejs_20
              git
              deps.ripgrep
            ];
          };
        }
      );

      # ========================================================================
      # Packages
      # ========================================================================
          packages = forEachSystem (pkgs:
        let
          system = pkgs.system;
          deps = stockDeps system;
          node_modules = pkgs.callPackage ./nix/node_modules.nix {
            inherit rev;
          };
          zee = pkgs.callPackage ./nix/zee.nix {
            inherit node_modules;
          };
          # nixpkgs cpu naming to bun cpu naming
          cpuMap = { x86_64 = "x64"; aarch64 = "arm64"; };
          # matrix of node_modules builds - these will always fail due to fakeHash usage
          # but allow computation of the correct hash from any build machine for any cpu/os
          # see the update-nix-hashes workflow for usage
          moduleUpdaters = lib.listToAttrs (
            lib.concatMap (cpu:
              map (os: {
                name = "${cpu}-${os}_node_modules";
                value = node_modules.override {
                  bunCpu = cpuMap.${cpu};
                  bunOs = os;
                  hash = lib.fakeHash;
                };
              }) [ "linux" ]
            ) [ "x86_64" "aarch64" ]
          );

          # Personas bundle: zee + stock dependencies wrapped together
          # Usage: nix build .#personas
          personasPkg = pkgs.symlinkJoin {
            name = "zee-personas";
            paths = [
              zee
              deps.wezterm
              deps.yazi
              deps.ripgrep
              deps.fd
              deps.fzf
              deps.jq
              deps.gh
            ];
            meta = {
              description = "Zee Personas bundle with stock dependencies";
              longDescription = ''
                Complete Personas system bundle including:
                - zee: The AI coding agent CLI
                - wezterm: Terminal emulator for pane orchestration
                - yazi: File manager
                - ripgrep, fd, fzf: Search utilities

                Note: Python packages (openbb, nautilus-trader) must be
                installed separately via pip as they're not in nixpkgs.

                Qdrant server must be run separately:
                  nix run .#qdrant
              '';
              license = lib.licenses.mit;
              platforms = systems;
            };
          };
        in
        {
          default = zee;
          zee = zee;
          personas = personasPkg;

          # Expose individual stock packages for flexibility
          qdrant = deps.qdrant;
          wezterm = deps.wezterm;
          yazi = deps.yazi;
        } // moduleUpdaters
      );

      # ========================================================================
      # Apps (runnable via `nix run`)
      # ========================================================================
      apps = forEachSystem (pkgs:
        let
          system = pkgs.system;
          deps = stockDeps system;
        in
        {
          # Run Qdrant server (for Personas memory)
          # Usage: nix run .#qdrant
          qdrant = {
            type = "app";
            meta = {
              description = "Run Qdrant vector database server";
            };
            program = "${
              pkgs.writeShellApplication {
                name = "qdrant-server";
                runtimeInputs = [ deps.qdrant ];
                text = ''
                  QDRANT_DATA_DIR="''${QDRANT_DATA_DIR:-$HOME/.local/share/qdrant}"
                  mkdir -p "$QDRANT_DATA_DIR"
                  echo "Starting Qdrant on http://localhost:6333"
                  echo "Data directory: $QDRANT_DATA_DIR"
                  exec qdrant --storage-path "$QDRANT_DATA_DIR"
                '';
              }
            }/bin/qdrant-server";
          };

          # Quick setup script for Python packages
          # Usage: nix run .#setup-python
          setup-python = {
            type = "app";
            meta = {
              description = "Set up Python environment with OpenBB and NautilusTrader";
            };
            program = "${
              pkgs.writeShellApplication {
                name = "setup-python";
                runtimeInputs = [ deps.pythonWithPackages ];
                text = ''
                  echo "Setting up Python environment for Personas..."

                  # Create venv if needed
                  if [ ! -d ".venv" ]; then
                    echo "Creating virtual environment..."
                    python -m venv .venv
                  fi

                  source .venv/bin/activate

                  echo "Installing OpenBB Platform..."
                  pip install --upgrade openbb

                  echo "Installing NautilusTrader..."
                  pip install --upgrade nautilus-trader

                  echo ""
                  echo "Python environment ready."
                  echo "   Activate with: source .venv/bin/activate"
                '';
              }
            }/bin/setup-python";
          };
        }
      );

      # ========================================================================
      # NixOS/Home-Manager Module (optional integration)
      # ========================================================================
      nixosModules.default = { config, lib, pkgs, ... }: {
        options.services.zee = {
          enable = lib.mkEnableOption "Zee Personas system";

          qdrant = {
            enable = lib.mkEnableOption "Qdrant vector database for Personas memory";
            dataDir = lib.mkOption {
              type = lib.types.path;
              default = "/var/lib/qdrant";
              description = "Data directory for Qdrant storage";
            };
          };
        };

        config = lib.mkIf config.services.zee.enable {
          environment.systemPackages = [
            self.packages.${pkgs.system}.personas
          ];

          # Qdrant service (if enabled)
          systemd.services.qdrant = lib.mkIf config.services.zee.qdrant.enable {
            description = "Qdrant Vector Database";
            wantedBy = [ "multi-user.target" ];
            after = [ "network.target" ];
            serviceConfig = {
              ExecStart = "${pkgs.qdrant}/bin/qdrant --storage-path ${config.services.zee.qdrant.dataDir}";
              Restart = "on-failure";
              DynamicUser = true;
              StateDirectory = "qdrant";
            };
          };
        };
      };
    };
}
