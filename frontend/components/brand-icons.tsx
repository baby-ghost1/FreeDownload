import { cn } from '@/lib/utils/cn';

/** Official brand glyphs (decorative only). Paths follow simple-icons geometry. */

const YOUTUBE_D =
  'M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814ZM9.545 15.568V8.432L15.818 12l-6.273 3.568Z';

const FACEBOOK_D =
  'M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073Z';

const X_D =
  'M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z';

const TIKTOK_D =
  'M12.525.02c1.31-.02.06 1.03.01 2.96v1.24c0 2.19-.02 4.39-.02 6.58 0 3.57-2.91 6.48-6.48 6.48-3.57 0-6.47-2.91-6.47-6.48 0-3.57 2.9-6.47 6.47-6.47 1.13 0 2.2.29 3.13.8v3.34c-.92-.5-1.97-.76-3.13-.76-1.78 0-3.22 1.44-3.22 3.22s1.44 3.22 3.22 3.22c1.78 0 3.22-1.44 3.22-3.22V.02h3.28z';

const TWITCH_D =
  'M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z';

const VIMEO_D =
  'M23.977 6.416c-.105 2.338-1.739 5.543-4.894 9.609-3.268 4.247-6.026 6.37-8.29 6.37-1.409 0-2.578-1.294-3.553-3.881L5.322 11.4C4.603 8.816 3.834 7.522 3.01 7.522c-.179 0-.806.378-1.881 1.132L0 7.197c1.185-1.044 2.351-2.084 3.501-3.128C5.08 2.701 6.266 1.984 7.055 1.91c1.867-.18 3.016 1.1 3.447 3.838.465 2.953.789 4.789.971 5.507.539 2.45 1.131 3.674 1.776 3.674.502 0 1.256-.796 2.265-2.385 1.004-1.589 1.54-2.797 1.612-3.628.143-1.371-.395-2.061-1.614-2.061-.574 0-1.167.121-1.777.391 1.186-3.868 3.452-5.745 6.806-5.637 2.407.082 3.539 1.676 3.411 4.777z';

const FILL_PATHS: Record<string, string> = {
  youtube: YOUTUBE_D,
  facebook: FACEBOOK_D,
  x: X_D,
  tiktok: TIKTOK_D,
  twitch: TWITCH_D,
  vimeo: VIMEO_D,
};

function InstagramGlyph({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.2" cy="6.8" r={1.2} fill="currentColor" stroke="none" />
    </svg>
  );
}

export function BrandLogo({
  id,
  size = 16,
  className,
  style,
}: {
  id: string;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  if (id === 'instagram') {
    return (
      <span className={cn('inline-flex', className)} style={style} aria-hidden="true">
        <InstagramGlyph size={size} />
      </span>
    );
  }
  const d = FILL_PATHS[id];
  if (!d) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={className}
      style={style}
    >
      <path d={d} />
    </svg>
  );
}
