export type CanvasHostConfig = {
  /** Enable the Canvas host HTTP server. Default: true. */
  enabled?: boolean;
  /** Root directory served under `/__zee__/canvas/`. Default: `~/zee/canvas`. */
  root?: string;
  /** Listening port for the Canvas host server. Default: gateway port + 4. */
  port?: number;
  /** Enable live reload + file watching. Default: true. */
  liveReload?: boolean;
};

