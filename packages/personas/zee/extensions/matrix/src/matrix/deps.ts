import type { RuntimeEnv } from "zee/plugin-sdk";
import { createRequire } from "node:module";

const MATRIX_SDK_PACKAGE = "@vector-im/matrix-bot-sdk";

export function isMatrixSdkAvailable(): boolean {
  try {
    const req = createRequire(import.meta.url);
    req.resolve(MATRIX_SDK_PACKAGE);
    return true;
  } catch {
    return false;
  }
}

export async function ensureMatrixSdkInstalled(params: {
  runtime: RuntimeEnv;
  confirm?: (message: string) => Promise<boolean>;
}): Promise<void> {
  if (isMatrixSdkAvailable()) {
    return;
  }
  const message =
    "Matrix plugin dependencies are missing (@vector-im/matrix-bot-sdk). Install the plugin dependencies and restart Zee.";
  params.runtime.log?.(`matrix: ${message}`);
  throw new Error(message);
}
