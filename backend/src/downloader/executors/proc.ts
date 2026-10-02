import { spawn } from 'node:child_process';

import { SourceError } from '../errors.js';

/**
 * Argument-array process execution (security layer 4): no shell, no string
 * interpolation, output paths are always worker-generated.
 */

export interface RunOptions {
  signal?: AbortSignal | undefined;
  timeoutMs?: number | undefined;
  /** Called for each complete stdout line (progress parsing). */
  onStdoutLine?: ((line: string) => void) | undefined;
  /** Cap on collected stdout (analyze dumps can be large). */
  maxStdoutBytes?: number | undefined;
  cwd?: string | undefined;
}

export interface RunResult {
  stdout: string;
  stderrTail: string;
}

export class ProcessError extends Error {
  readonly exitCode: number | null;
  readonly stderrTail: string;
  constructor(message: string, exitCode: number | null, stderrTail: string) {
    super(message);
    this.name = 'ProcessError';
    this.exitCode = exitCode;
    this.stderrTail = stderrTail;
  }
}

const DEFAULT_MAX_STDOUT = 32 * 1024 * 1024;
const STDERR_TAIL = 8 * 1024;

function killTree(pid: number): void {
  if (process.platform === 'win32') {
    // yt-dlp/ffmpeg spawn children; /T takes the whole tree down.
    spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }).on(
      'error',
      () => undefined,
    );
    return;
  }
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // already gone
  }
}

export function runProcess(
  file: string,
  args: string[],
  opts: RunOptions = {},
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) {
      reject(new SourceError('SOURCE_TIMEOUT', 'aborted before start'));
      return;
    }

    const child = spawn(file, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...(opts.cwd ? { cwd: opts.cwd } : {}),
    });

    let stdout = '';
    let stderrTail = '';
    let stdoutBytes = 0;
    let killedByTimeout = false;
    let settled = false;

    const maxStdout = opts.maxStdoutBytes ?? DEFAULT_MAX_STDOUT;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };

    const onAbort = () => {
      if (child.pid !== undefined) killTree(child.pid);
    };
    const cleanup = () => {
      opts.signal?.removeEventListener('abort', onAbort);
      clearTimeout(timer);
    };

    const timer =
      opts.timeoutMs !== undefined
        ? setTimeout(() => {
            killedByTimeout = true;
            onAbort();
          }, opts.timeoutMs)
        : undefined;

    opts.signal?.addEventListener('abort', onAbort, { once: true });

    let lineBuffer = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes <= maxStdout) stdout += chunk.toString('utf8');
      if (!opts.onStdoutLine) return;
      lineBuffer += chunk.toString('utf8');
      let idx = lineBuffer.indexOf('\n');
      while (idx >= 0) {
        const line = lineBuffer.slice(0, idx).replace(/\r$/, '');
        lineBuffer = lineBuffer.slice(idx + 1);
        opts.onStdoutLine(line);
        idx = lineBuffer.indexOf('\n');
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString('utf8')).slice(-STDERR_TAIL);
    });

    child.on('error', (err) => {
      finish(() =>
        reject(new SourceError('SOURCE_UNAVAILABLE', `could not run ${file}: ${err.message}`)),
      );
    });

    child.on('close', (code) => {
      if (lineBuffer.length > 0 && opts.onStdoutLine) opts.onStdoutLine(lineBuffer);
      if (killedByTimeout) {
        finish(() => reject(new SourceError('SOURCE_TIMEOUT', `${file} timed out`)));
        return;
      }
      if (opts.signal?.aborted) {
        finish(() => reject(new SourceError('SOURCE_TIMEOUT', `${file} was aborted`)));
        return;
      }
      if (code !== 0) {
        finish(() => reject(new ProcessError(`${file} exited with ${code}`, code, stderrTail)));
        return;
      }
      finish(() => resolve({ stdout, stderrTail }));
    });
  });
}
