import { get as httpGet } from 'node:http';
import { get as httpsGet } from 'node:https';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function expandCacheDir(dir) {
  if (!dir) return join(homedir(), '.cache', 'fast-cv', 'refs');
  return dir.startsWith('~') ? join(homedir(), dir.slice(1)) : dir;
}

function cachePathFor(cacheDir, url) {
  const hash = createHash('sha256').update(url).digest('hex').slice(0, 32);
  return join(cacheDir, `${hash}.bin`);
}

function readCached(cacheDir, url) {
  try {
    const p = cachePathFor(cacheDir, url);
    const st = statSync(p);
    if (Date.now() - st.mtimeMs > CACHE_TTL_MS) return null;
    return readFileSync(p, 'utf-8');
  } catch {
    return null;
  }
}

function writeCached(cacheDir, url, body) {
  try {
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(cachePathFor(cacheDir, url), body, 'utf-8');
  } catch { /* noop */ }
}

function fetchWithLimits(url, { timeoutMs, maxResponseBytes }) {
  return new Promise((resolve) => {
    const getter = url.startsWith('https://') ? httpsGet : httpGet;
    let finished = false;
    const done = (result) => {
      if (finished) return;
      finished = true;
      resolve(result);
    };
    let req;
    try {
      req = getter(url, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return done({ ok: false, reason: `redirect-${res.statusCode}` });
        }
        if (res.statusCode !== 200) {
          res.resume();
          return done({ ok: false, reason: `status-${res.statusCode}` });
        }
        let bytes = 0;
        const chunks = [];
        res.on('data', (chunk) => {
          bytes += chunk.length;
          if (bytes > maxResponseBytes) {
            req.destroy();
            return done({ ok: false, reason: 'too-large' });
          }
          chunks.push(chunk);
        });
        res.on('end', () => done({ ok: true, body: Buffer.concat(chunks).toString('utf-8') }));
        res.on('error', (err) => done({ ok: false, reason: `error-${err.code || err.message}` }));
      });
      req.setTimeout(timeoutMs, () => {
        req.destroy();
        done({ ok: false, reason: 'timeout' });
      });
      req.on('error', (err) => done({ ok: false, reason: `error-${err.code || err.message}` }));
    } catch (err) {
      done({ ok: false, reason: `spawn-${err.message}` });
    }
  });
}

function isAllowed(url, allowlist) {
  if (!allowlist || !Array.isArray(allowlist) || allowlist.length === 0) return true;
  return allowlist.some(prefix => typeof prefix === 'string' && url.startsWith(prefix));
}

export async function resolveRemoteRefs(refs, config) {
  const results = {
    resolved: new Map(),
    unreachable: new Set(),
    blocked: new Set(),
    disabled: new Set(),
  };
  const settings = config?.remoteRefs || {};
  const enabled = settings.enabled !== false;
  const timeoutMs = Number.isFinite(settings.timeoutMs) ? settings.timeoutMs : 5000;
  const maxResponseBytes = Number.isFinite(settings.maxResponseBytes) ? settings.maxResponseBytes : 1048576;
  const maxFetchesPerFile = Number.isFinite(settings.maxFetchesPerFile) ? settings.maxFetchesPerFile : 64;
  const allowlist = settings.allowlist || null;
  const cacheDir = expandCacheDir(settings.cacheDir);

  let budget = maxFetchesPerFile;
  const uniqueRefs = [...new Set(refs)];

  for (const url of uniqueRefs) {
    if (!url.startsWith('http://') && !url.startsWith('https://')) continue;
    if (!enabled) { results.disabled.add(url); continue; }
    if (!isAllowed(url, allowlist)) { results.blocked.add(url); continue; }
    if (budget <= 0) { results.unreachable.add(url); continue; }

    const cached = readCached(cacheDir, url);
    if (cached !== null) {
      results.resolved.set(url, cached);
      continue;
    }
    budget -= 1;
    const r = await fetchWithLimits(url, { timeoutMs, maxResponseBytes });
    if (r.ok) {
      results.resolved.set(url, r.body);
      writeCached(cacheDir, url, r.body);
    } else {
      results.unreachable.add(url);
    }
  }

  return results;
}

export function collectRemoteRefs(data, depthCap = 64) {
  const refs = [];
  const seen = new WeakSet();
  function walk(node, depth) {
    if (depth > depthCap) return;
    if (!node || typeof node !== 'object') return;
    if (seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    if (typeof node.$ref === 'string' &&
        (node.$ref.startsWith('http://') || node.$ref.startsWith('https://'))) {
      refs.push(node.$ref);
    }
    for (const [k, v] of Object.entries(node)) {
      if (k === '$ref') continue;
      walk(v, depth + 1);
    }
  }
  walk(data, 0);
  return refs;
}
