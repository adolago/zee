export type LegacyGatewayService = {
  platform: "linux" | "darwin" | "win32";
  label: string;
  detail: string;
};

/**
 * Best-effort detection of legacy gateway services (older installs, old service names, etc).
 *
 * This is intentionally conservative: if we can't confidently detect legacy services, we return none.
 */
export async function findLegacyGatewayServices(
  _env: Record<string, string | undefined>,
): Promise<LegacyGatewayService[]> {
  return [];
}

/**
 * Best-effort uninstall for legacy gateway services.
 *
 * Returns a list of human-readable actions performed (for doctor output).
 */
export async function uninstallLegacyGatewayServices(
  _services: LegacyGatewayService[],
  _env: Record<string, string | undefined>,
): Promise<string[]> {
  return [];
}

