/** Best-effort diagnostic logging: never throws, never blocks an action. */
import { error, info, warn } from "@tauri-apps/plugin-log";
import { describeError } from "./errors";

export { describeError };

export interface LogSink {
  info: (message: string) => Promise<void>;
  warn: (message: string) => Promise<void>;
  error: (message: string) => Promise<void>;
}

export interface Logger {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (scope: string, error: unknown) => void;
}

/**
 * Wrap a sink so a missing Tauri bridge (plain browser) or a failing log
 * command can never break the operation being logged.
 */
export function createLogger(sink: LogSink): Logger {
  function send(level: keyof LogSink, message: string): void {
    try {
      void sink[level](message).catch(() => {
        // Logging is diagnostic only: drop the failure.
      });
    } catch {
      // Same, for a sink that throws before returning a promise.
    }
  }

  return {
    info: (message) => send("info", message),
    warn: (message) => send("warn", message),
    error: (scope, value) => send("error", `[${scope}] ${describeError(value)}`),
  };
}

/** Production logger backed by tauri-plugin-log (file + stdout in dev). */
export const logger = createLogger({ info, warn, error });
