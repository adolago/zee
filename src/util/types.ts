/**
 * Utility Types
 *
 * Common utility types and interfaces used across zee
 */

/** Logger interface */
export interface Logger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;

  /** Create child logger with additional context */
  child(context: Record<string, unknown>): Logger;

  /** Time an operation */
  time(label: string, data?: Record<string, unknown>): Disposable;
}

/** Log levels */
export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

/** Logger configuration */
export interface LoggerConfig {
  level: LogLevel;
  print?: boolean;
  file?: string;
  structured?: boolean;
}

/** Named error with structured data */
export interface NamedError<T extends Record<string, unknown> = Record<string, unknown>> extends Error {
  readonly code: string;
  readonly data: T;
  toObject(): { code: string; message: string; data: T };
}

/** Create named error type */
export interface NamedErrorConstructor<T extends Record<string, unknown>> {
  new (data: T, options?: ErrorOptions): NamedError<T>;
  is(error: unknown): error is NamedError<T>;
}

/** Result type for operations that can fail */
export type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

/** Async result */
export type AsyncResult<T, E = Error> = Promise<Result<T, E>>;

/** Disposable resource */
export interface Disposable {
  [Symbol.dispose](): void;
}

/** Async disposable resource */
export interface AsyncDisposable {
  [Symbol.asyncDispose](): Promise<void>;
}

/** Identifier generator */
export interface IdentifierGenerator {
  /** Generate ascending ID (chronological) */
  ascending(prefix: string, seed?: string): string;

  /** Generate descending ID (reverse chronological) */
  descending(prefix: string, seed?: string): string;

  /** Generate UUID */
  uuid(): string;

  /** Parse ID to extract timestamp */
  parse(id: string): { prefix: string; timestamp: number } | null;
}

/** File system utilities */
export interface FileSystem {
  /** Read file */
  read(path: string): Promise<string>;

  /** Write file */
  write(path: string, content: string): Promise<void>;

  /** Check if path exists */
  exists(path: string): Promise<boolean>;

  /** Create directory */
  mkdir(path: string, recursive?: boolean): Promise<void>;

  /** Remove file or directory */
  remove(path: string, recursive?: boolean): Promise<void>;

  /** List directory contents */
  readdir(path: string): Promise<string[]>;

  /** Get file stats */
  stat(path: string): Promise<FileStat>;

  /** Watch file changes */
  watch(path: string, callback: (event: FileWatchEvent) => void): () => void;

  /** Glob pattern matching */
  glob(pattern: string, options?: GlobOptions): AsyncIterable<string>;
}

/** File stats */
export interface FileStat {
  isFile: boolean;
  isDirectory: boolean;
  size: number;
  mtime: Date;
  ctime: Date;
}

/** File watch event */
export interface FileWatchEvent {
  type: "create" | "modify" | "delete";
  path: string;
}

/** Glob options */
export interface GlobOptions {
  cwd?: string;
  absolute?: boolean;
  ignore?: string[];
  dot?: boolean;
}

/** Storage interface for persistent data */
export interface Storage {
  /** Read value */
  read<T>(key: string[]): Promise<T | undefined>;

  /** Write value */
  write<T>(key: string[], value: T): Promise<void>;

  /** Update value atomically */
  update<T>(key: string[], updater: (value: T) => T): Promise<T>;

  /** Delete value */
  remove(key: string[]): Promise<void>;

  /** List keys with prefix */
  list(prefix: string[]): Promise<string[][]>;

  /** Check if key exists */
  exists(key: string[]): Promise<boolean>;
}

/** Cache interface */
export interface Cache<T = unknown> {
  /** Get cached value */
  get(key: string): Promise<T | undefined>;

  /** Set cached value with optional TTL */
  set(key: string, value: T, ttl?: number): Promise<void>;

  /** Delete cached value */
  delete(key: string): Promise<void>;

  /** Clear all cached values */
  clear(): Promise<void>;

  /** Check if key exists */
  has(key: string): Promise<boolean>;
}

/** Rate limiter */
export interface RateLimiter {
  /** Check if action is allowed */
  check(key: string): Promise<boolean>;

  /** Consume a token */
  consume(key: string): Promise<boolean>;

  /** Get remaining tokens */
  remaining(key: string): Promise<number>;

  /** Reset limit for key */
  reset(key: string): Promise<void>;
}

/** Rate limiter configuration */
export interface RateLimiterConfig {
  /** Maximum requests per window */
  max: number;

  /** Window size in ms */
  window: number;

  /** Sliding window or fixed */
  type?: "sliding" | "fixed";
}

/** Wildcard pattern matching */
export interface WildcardMatcher {
  /** Check if value matches pattern */
  match(value: string, pattern: string): boolean;

  /** Find first matching pattern */
  findMatch(value: string, patterns: string[]): string | undefined;

  /** Filter values by pattern */
  filter(values: string[], pattern: string): string[];
}

/** Deep merge utility */
export type DeepMerge<T, U> = {
  [K in keyof T | keyof U]: K extends keyof U
    ? K extends keyof T
      ? T[K] extends object
        ? U[K] extends object
          ? DeepMerge<T[K], U[K]>
          : U[K]
        : U[K]
      : U[K]
    : K extends keyof T
      ? T[K]
      : never;
};

/** Branded type for type-safe IDs */
export type Branded<T, Brand extends string> = T & { readonly __brand: Brand };

/** Session ID type */
export type SessionId = Branded<string, "SessionId">;

/** Message ID type */
export type MessageId = Branded<string, "MessageId">;

/** Part ID type */
export type PartId = Branded<string, "PartId">;

/** Permission ID type */
export type PermissionId = Branded<string, "PermissionId">;
