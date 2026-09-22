/**
 * Application error reporting utility
 */
export function reportLovableError(error: Error, info?: Record<string, unknown>) {
  if (process.env.NODE_ENV !== "production") {
    console.error("[ErrorReporting]", error, info);
  }
}
