import { AppError } from '../../errors/app-error.js';

/**
 * Navbar visibility (contract §43): owned by the admin console
 * (`system_settings` row `navbar_config`), served to every visitor through
 * `GET /config/public`. Missing or malformed = fully visible (fail-open -
 * the navbar must never vanish because of a bad row).
 */

export const NAVBAR_SETTING_KEY = 'navbar_config';

export interface NavbarLinks {
  home: boolean;
  download: boolean;
  downloads: boolean;
  auth: boolean;
}

export interface NavbarConfig {
  visible: boolean;
  links: NavbarLinks;
}

export const DEFAULT_NAVBAR: NavbarConfig = {
  visible: true,
  links: { home: true, download: true, downloads: true, auth: true },
};

function isBool(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

/** Coerce unknown setting values to a safe config (fail-open to defaults). */
export function normalizeNavbar(raw: unknown): NavbarConfig {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_NAVBAR;
  const record = raw as Record<string, unknown>;
  const links = (typeof record.links === 'object' && record.links !== null
    ? record.links
    : {}) as Record<string, unknown>;
  return {
    visible: isBool(record.visible) ? record.visible : true,
    links: {
      home: isBool(links.home) ? links.home : true,
      download: isBool(links.download) ? links.download : true,
      downloads: isBool(links.downloads) ? links.downloads : true,
      auth: isBool(links.auth) ? links.auth : true,
    },
  };
}

/** Strict gate for admin writes - garbage must never reach the row. */
export function assertNavbarValue(value: unknown): asserts value is NavbarConfig {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  const links =
    typeof raw.links === 'object' && raw.links !== null
      ? (raw.links as Record<string, unknown>)
      : {};
  const ok =
    isBool(raw.visible) &&
    isBool(links.home) &&
    isBool(links.download) &&
    isBool(links.downloads) &&
    isBool(links.auth);
  if (!ok) {
    throw new AppError(
      'VALIDATION_ERROR',
      'navbar_config must be { visible: boolean, links: { home, download, downloads, auth: boolean } }.',
    );
  }
}
