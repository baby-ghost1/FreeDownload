/**
 * SourceAdapter - every source-specific behaviour lives behind this
 * interface (contract invariant 6). The API never calls it; workers do.
 */

export interface MediaFormatInfo {
  /** Stable id we expose to clients, e.g. `1080p.mp4` or `audio.m4a`. */
  key: string;
  label: string;
  kind: 'video' | 'audio' | 'other';
  container: string;
  width?: number | null;
  height?: number | null;
  fps?: number | null;
  vcodec?: string | null;
  acodec?: string | null;
  bitrateKbps?: number | null;
  filesizeBytes?: number | null;
  isDefault: boolean;
  sortOrder: number;
}

export interface MediaAnalysis {
  externalId?: string | null;
  title?: string | null;
  durationSec?: number | null;
  thumbnailUrl?: string | null;
  uploader?: string | null;
  pageUrl?: string | null;
  description?: string | null;
  formats: MediaFormatInfo[];
  /**
   * Every absolute URL the extractor reported (final page, media, manifest,
   * thumbnail). The pipeline SSRF-sweeps these before any download starts;
   * never persisted or returned to clients.
   */
  sourceUrls?: string[];
}

export interface AnalyzeOptions {
  signal: AbortSignal;
  timeoutMs?: number;
}

/** What the user picked - structured so it can never become shell input. */
export interface FormatSelection {
  /** Target container, validated `^[a-z0-9]{2,5}$`. */
  container: string;
  /** Requested height cap in pixels; unset = best available. */
  maxHeight?: number | null;
  /** Audio-only rendition. */
  audioOnly?: boolean;
}

export interface DownloadOptions {
  /** Worker-generated scratch directory; never derived from remote names. */
  workDir: string;
  signal: AbortSignal;
  selection: FormatSelection;
  maxFileSizeMb: number;
  /** 0-100 download progress from the extractor. */
  onProgress(percent: number): void;
}

export interface DownloadedArtifact {
  path: string;
  container: string;
  sizeBytes: number;
}

export interface SourceAdapter {
  readonly key: string;
  canHandle(url: URL): boolean;
  analyze(url: string, opts: AnalyzeOptions): Promise<MediaAnalysis>;
  download(url: string, opts: DownloadOptions): Promise<DownloadedArtifact>;
}
