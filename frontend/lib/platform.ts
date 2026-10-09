/** Detects the source platform from a media URL so pages can tint to match it. */

export type PlatformId =
  | 'default'
  | 'youtube'
  | 'instagram'
  | 'x'
  | 'facebook'
  | 'tiktok'
  | 'twitch'
  | 'vimeo'
  | 'dailymotion'
  | 'snapchat'
  | 'reddit'
  | 'rumble'
  | 'odysee'
  | 'bitchute'
  | 'zedge';

export interface Platform {
  id: PlatformId;
  /** Human label, e.g. "YouTube". */
  label: string;
  /** Decorative dot colour (never used for text). */
  accent: string;
}

const DEFAULT_PLATFORM: Platform = { id: 'default', label: 'Link', accent: 'var(--primary)' };

const KNOWN: Array<Platform & { match: RegExp }> = [
  { id: 'youtube', label: 'YouTube', accent: '#ff3357', match: /(^|\.)(youtube\.com|youtu\.be)$/ },
  { id: 'instagram', label: 'Instagram', accent: '#e1309b', match: /(^|\.)instagram\.com$/ },
  { id: 'x', label: 'X', accent: '#8a94a6', match: /(^|\.)(x\.com|twitter\.com)$/ },
  {
    id: 'facebook',
    label: 'Facebook',
    accent: '#2f7bff',
    match: /(^|\.)(facebook\.com|fb\.com|fb\.watch)$/,
  },
  { id: 'tiktok', label: 'TikTok', accent: '#14b8a6', match: /(^|\.)tiktok\.com$/ },
  { id: 'twitch', label: 'Twitch', accent: '#a970ff', match: /(^|\.)twitch\.tv$/ },
  { id: 'vimeo', label: 'Vimeo', accent: '#1ab7ea', match: /(^|\.)vimeo\.com$/ },
  {
    id: 'dailymotion',
    label: 'Dailymotion',
    accent: '#00aaff',
    match: /(^|\.)(dailymotion\.com|dai\.ly)$/,
  },
  { id: 'snapchat', label: 'Snapchat', accent: '#eab308', match: /(^|\.)snapchat\.com$/ },
  {
    id: 'reddit',
    label: 'Reddit',
    accent: '#ff4500',
    match: /(^|\.)(reddit\.com|redd\.it|v\.redd\.it)$/,
  },
  { id: 'rumble', label: 'Rumble', accent: '#85c742', match: /(^|\.)rumble\.com$/ },
  { id: 'odysee', label: 'Odysee', accent: '#ec4899', match: /(^|\.)odysee\.com$/ },
  {
    id: 'bitchute',
    label: 'BitChute',
    accent: '#dc2626',
    match: /(^|\.)(bitchute\.com|bitchute\.tv)$/,
  },
  { id: 'zedge', label: 'Zedge', accent: '#7c3aed', match: /(^|\.)zedge\.net$/ },
];

export function detectPlatform(rawUrl: string | null | undefined): Platform {
  try {
    let value = (rawUrl ?? '').trim();
    if (!value) return DEFAULT_PLATFORM;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(value)) value = `https://${value}`;
    const host = new URL(value).hostname.toLowerCase().replace(/^www\./, '');
    if (!host) return DEFAULT_PLATFORM;
    const found = KNOWN.find((p) => p.match.test(host));
    return found ?? DEFAULT_PLATFORM;
  } catch {
    return DEFAULT_PLATFORM;
  }
}

/** Pills for the "works with" strip - id, label plus decorative dot colour. */
export const PLATFORM_PILLS: Array<{ id: PlatformId; label: string; accent: string }> = KNOWN.map(
  (p) => ({
    id: p.id,
    label: p.label,
    accent: p.accent,
  }),
);
