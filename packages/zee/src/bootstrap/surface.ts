/**
 * Surface Bootstrap
 *
 * Initializes the surface router and registers default surfaces.
 * Called by daemon on startup to enable multi-surface support.
 */

import { getSurfaceRouter, SurfaceRouter } from '../surface/router';
import { createCLISurface } from '../surface/cli';
import { createMessagingSurface } from '../surface/messaging';
import { WhatsAppPlatformHandler } from '../surface/platforms/whatsapp';
import type { Surface } from '../surface/surface';
import { Log } from '../util/log';
import { Config } from '../config/config';
import { sendWhatsAppMessage } from '@root/domain/zee/whatsapp-send';

const log = Log.create({ service: 'surface-bootstrap' });

// Track initialized state
let initialized = false;
let router: SurfaceRouter | null = null;

// =============================================================================
// Configuration Types
// =============================================================================

type SurfaceBootstrapConfig = {
  /** Enable CLI surface (default: true) */
  enableCLI?: boolean;
  /** Enable WhatsApp messaging surface */
  enableWhatsApp?: boolean;
  /** WhatsApp surface configuration */
  whatsApp?: {
    allowedNumbers?: string[];
    allowedGroups?: string[];
    requireMention?: boolean;
  };
  /** Enable analytics collection */
  enableAnalytics?: boolean;
  /** Enable hot-reload of surface configs */
  enableHotReload?: boolean;
};

// =============================================================================
// Initialization
// =============================================================================

/**
 * Initialize surface layer and register configured surfaces.
 */
export async function initSurfaces(): Promise<void> {
  if (initialized) {
    log.debug('Surfaces already initialized');
    return;
  }

  log.info('Initializing surface layer');

  // Load configuration
  const config = await loadSurfaceConfig();

  // Create router with configuration
  router = getSurfaceRouter({
    enableAnalytics: config.enableAnalytics ?? true,
    enableHotReload: config.enableHotReload ?? false,
  });

  // Register CLI surface (always enabled in daemon mode)
  if (config.enableCLI !== false) {
    await registerCLISurface();
  }

  // Register WhatsApp messaging surface
  if (config.enableWhatsApp) {
    await registerWhatsAppSurface(config.whatsApp);
  }

  // Initialize router (connects all surfaces)
  await router.init();

  initialized = true;
  log.info('Surface layer initialized', {
    surfaces: router.getAllSurfaces().map((s) => s.id),
  });
}

/**
 * Shutdown surface layer and disconnect all surfaces.
 */
export async function shutdownSurfaces(): Promise<void> {
  if (!initialized || !router) {
    return;
  }

  log.info('Shutting down surface layer');

  await router.shutdown();
  router = null;
  initialized = false;

  log.info('Surface layer shutdown complete');
}

/**
 * Get the initialized surface router.
 */
export function getRouter(): SurfaceRouter | null {
  return router;
}

// =============================================================================
// Surface Registration
// =============================================================================

async function registerCLISurface(): Promise<void> {
  if (!router) return;

  log.info('Registering CLI surface');

  const cliSurface = createCLISurface({
    streamOutput: true,
  });

  await router.registerSurface(cliSurface);
}

async function registerWhatsAppSurface(
  waConfig?: SurfaceBootstrapConfig['whatsApp'],
): Promise<void> {
  if (!router) return;

  log.info('Registering WhatsApp messaging surface');

  const handler = new WhatsAppPlatformHandler({
    sendFn: async (target, text, options) => {
      const result = await sendWhatsAppMessage({ to: target, message: text });
      if (!result.success) {
        log.warn('WhatsApp send failed', { target, error: result.error });
      }
    },
  });

  const surface = createMessagingSurface(handler, {
    platform: 'whatsapp',
    allowedSenders: waConfig?.allowedNumbers ?? [],
    groups: {
      enabled: (waConfig?.allowedGroups?.length ?? 0) > 0,
      requireMention: waConfig?.requireMention ?? true,
      allowedGroups: waConfig?.allowedGroups ?? [],
      mentionPatterns: [],
    },
  });

  await router.registerSurface(surface);
}

// =============================================================================
// Configuration Loading
// =============================================================================

async function loadSurfaceConfig(): Promise<SurfaceBootstrapConfig> {
  try {
    const config = await Config.get();

    const wa = config.experimental?.surfaces?.whatsapp;
    const surfaceConfig: SurfaceBootstrapConfig = {
      enableCLI: config.experimental?.surfaces?.cli?.enabled ?? true,
      enableWhatsApp: wa?.enabled ?? false,
      whatsApp: wa ? {
        allowedNumbers: wa.allowedNumbers,
        allowedGroups: wa.allowedGroups,
        requireMention: wa.requireMention,
      } : undefined,
      enableAnalytics: config.experimental?.surfaces?.analytics?.enabled ?? true,
      enableHotReload: config.experimental?.surfaces?.hotReload?.enabled ?? false,
    };

    return surfaceConfig;
  } catch (error) {
    log.debug('Could not load surface config, using defaults', {
      error: error instanceof Error ? error.message : String(error),
    });

    // Return defaults
    return {
      enableCLI: true,
      enableAnalytics: true,
      enableHotReload: false,
    };
  }
}

// =============================================================================
// Dynamic Surface Management
// =============================================================================

/**
 * Register an additional surface at runtime.
 */
export async function registerSurface(surface: Surface): Promise<void> {
  if (!router) {
    throw new Error('Surface router not initialized');
  }

  await router.registerSurface(surface);
}

/**
 * Unregister a surface at runtime.
 */
export async function unregisterSurface(surfaceId: string): Promise<void> {
  if (!router) {
    throw new Error('Surface router not initialized');
  }

  await router.unregisterSurface(surfaceId);
}

/**
 * Get analytics for all surfaces or a specific surface.
 */
export function getSurfaceAnalytics(surfaceId?: string) {
  if (!router) {
    return [];
  }

  return router.getAnalytics(surfaceId);
}

/**
 * Get current session statistics.
 */
export function getSurfaceSessionStats() {
  if (!router) {
    return {
      totalSessions: 0,
      totalMessages: 0,
      activeSurfaces: 0,
    };
  }

  return router.getSessionStats();
}
