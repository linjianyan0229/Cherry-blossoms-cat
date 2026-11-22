export interface VersionValidation {
  valid: boolean;
  normalized: string;
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
  buildmetadata: string | null;
}

export function validateVersion (version: unknown): VersionValidation;
export function resolveBuildVersion (options?: { envVersion?: unknown, sourceVersion?: unknown; }): string;

export default function vitePluginNapcatVersion (): {
  name: string;
  enforce: 'pre';
  config: (userConfig?: { define?: Record<string, unknown>; }) => { define: Record<string, unknown>; };
};
