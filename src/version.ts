/** MNMX SDK version. */
export const VERSION = '0.1.0';

/** Returns the SDK version string. */
export function getVersion(): string {
  return VERSION;
}

/** Returns build information. */
export function getBuildInfo(): { version: string; nodeVersion: string } {
  return {
    version: VERSION,
    nodeVersion: process.version,
  };
}
