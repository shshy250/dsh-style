/**
 * Host half of the "DSH style" bundle.
 *
 * Owns the persisted appearance state (top-left name, brand logo, window
 * wallpaper and its veil) plus the uploaded media bytes, and serves both from
 * one prefix route so the Client half can read and write them over the page's
 * own origin:
 *
 *   GET    /dsh-style/state            -> { ok, state }
 *   PUT    /dsh-style/name             -> { ok, state }   body: { name }
 *   PUT    /dsh-style/options          -> { ok, state }   body: { dim }
 *   POST   /dsh-style/media?kind=logo|background
 *   DELETE /dsh-style/media?kind=logo|background
 *   GET    /dsh-style/asset/<file>     -> the stored bytes
 *
 * State lives under `$DSH_HOME/storages/dsh-style`, next to the other durable
 * Harness storages, so it survives plugin upgrades and page reloads without
 * bloating the profile patch.
 *
 * @module @local/dsh-style
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

/** Route prefix owned by this bundle. */
const PREFIX = '/dsh-style';
/** Plugin id used for log lines and effect labels. */
const PLUGIN_ID = '@local/dsh-style';
/** Stored media kinds and their size ceilings. */
const KINDS = ['logo', 'background'];
const LIMITS = { logo: 2 * 1024 * 1024, background: 32 * 1024 * 1024 };
/** File names this route serves: `<kind>-<hash>.<ext>`, nothing else. */
const FILE_PATTERN = /^(logo|bg)-[0-9a-f]{12}\.(png|jpg|gif|webp|avif|svg)$/;
/** Sanity ceiling for a JSON request body. */
const JSON_LIMIT = 64 * 1024;
/** Default veil opacity drawn over the wallpaper. */
const DEFAULT_DIM = 0.25;
/** Highest veil the UI may request. */
const MAX_DIM = 0.85;

/** Services this bundle needs; without a web server the route cannot exist. */
export const inject = ['webServer'];

/**
 * Register the appearance route for the lifetime of this plugin fiber.
 *
 * @param ctx - Host root context.
 */
export function apply(ctx) {
  const store = createStore(ctx);
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: PREFIX,
        handler: (req, res) => {
          void handleRequest(store, req, res);
        },
      }),
    `${PLUGIN_ID}: appearance route`,
  );
}

/**
 * Build the state store bound to one data directory.
 *
 * @param ctx - Host root context, used only for diagnostics.
 * @returns store facade with state, upload, and removal operations.
 */
function createStore(ctx) {
  const dir = dataDirectory();
  const statePath = path.join(dir, 'state.json');
  let warned = false;
  let queue = Promise.resolve();

  /** Serialize read-modify-write cycles so two uploads cannot drop one another. */
  const serialize = (operation) => {
    const pending = queue.then(operation, operation);
    queue = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  };

  const load = async () => {
    let raw;
    try {
      raw = await readFile(statePath, 'utf8');
    } catch {
      return defaultState();
    }
    try {
      return normalizeState(JSON.parse(raw));
    } catch (error) {
      if (!warned) {
        warned = true;
        ctx.logger?.warn?.(`${PLUGIN_ID}: unreadable state.json, using defaults (${String(error)})`);
      }
      return defaultState();
    }
  };

  const persist = async (next) => {
    await mkdir(dir, { recursive: true });
    const temporary = `${statePath}.tmp`;
    await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    await rename(temporary, statePath);
    warned = false;
    return next;
  };

  const dropFile = async (file) => {
    if (typeof file !== 'string' || !FILE_PATTERN.test(file)) return;
    try {
      await unlink(path.join(dir, file));
    } catch {
      /* already gone */
    }
  };

  return {
    dir,
    async state() {
      return project(await load());
    },
    async setName(name) {
      return serialize(async () => {
        const current = await load();
        return project(await persist({ ...current, name }));
      });
    },
    async setDim(dim) {
      return serialize(async () => {
        const current = await load();
        return project(await persist({ ...current, dim }));
      });
    },
    async putMedia(kind, bytes) {
      return serialize(async () => {
        const detected = sniffImage(bytes);
        if (detected === undefined) return { error: 'unsupported' };
        if (bytes.length > LIMITS[kind]) return { error: 'too-large' };
        const current = await load();
        const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 12);
        const file = `${kind === 'logo' ? 'logo' : 'bg'}-${hash}.${detected.ext}`;
        await mkdir(dir, { recursive: true });
        await writeFile(path.join(dir, file), bytes);
        const previous = current[kind];
        const next = await persist({
          ...current,
          [kind]: { file, type: detected.type, bytes: bytes.length, updatedAt: new Date().toISOString() },
        });
        if (previous?.file !== undefined && previous.file !== file) await dropFile(previous.file);
        await pruneKind(kind, file);
        return { state: project(next) };
      });
    },
    async clearMedia(kind) {
      return serialize(async () => {
        const current = await load();
        const previous = current[kind];
        const next = await persist({ ...current, [kind]: null });
        if (previous?.file !== undefined) await dropFile(previous.file);
        return project(next);
      });
    },
    async readAsset(name) {
      if (!FILE_PATTERN.test(name)) return undefined;
      const filePath = path.join(dir, name);
      try {
        const info = await stat(filePath);
        if (!info.isFile()) return undefined;
        return { filePath, size: info.size, type: contentTypeOf(name) };
      } catch {
        return undefined;
      }
    },
  };

  /** Remove stale files of one kind so re-uploads do not accumulate. */
  async function pruneKind(kind, keep) {
    const prefix = kind === 'logo' ? 'logo-' : 'bg-';
    let names;
    try {
      names = await readdir(dir);
    } catch {
      return;
    }
    await Promise.all(
      names
        .filter((name) => name.startsWith(prefix) && name !== keep && FILE_PATTERN.test(name))
        .map((name) => dropFile(name)),
    );
  }
}

/**
 * Dispatch one HTTP request against the appearance store.
 *
 * @param store - store facade from {@link createStore}.
 * @param req - Node request.
 * @param res - Node response.
 */
async function handleRequest(store, req, res) {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const rest = url.pathname.slice(PREFIX.length).replace(/^\/+/, '');
    const method = (req.method ?? 'GET').toUpperCase();

    if (rest === 'state' && (method === 'GET' || method === 'HEAD')) {
      sendJson(res, 200, { ok: true, state: await store.state() });
      return;
    }
    if (rest === 'name' && method === 'PUT') {
      const body = await readJson(req);
      const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 40) : '';
      sendJson(res, 200, { ok: true, state: await store.setName(name) });
      return;
    }
    if (rest === 'options' && method === 'PUT') {
      const body = await readJson(req);
      if (typeof body?.dim !== 'number' || !Number.isFinite(body.dim)) {
        sendJson(res, 400, { ok: false, error: 'bad-request' });
        return;
      }
      const dim = Math.min(MAX_DIM, Math.max(0, body.dim));
      sendJson(res, 200, { ok: true, state: await store.setDim(dim) });
      return;
    }
    if (rest === 'media' && method === 'POST') {
      const kind = url.searchParams.get('kind');
      if (kind === null || !KINDS.includes(kind)) {
        sendJson(res, 400, { ok: false, error: 'bad-request' });
        return;
      }
      const bytes = await readBody(req, LIMITS[kind]);
      const result = await store.putMedia(kind, bytes);
      if (result.error !== undefined) {
        sendJson(res, result.error === 'too-large' ? 413 : 415, { ok: false, error: result.error });
        return;
      }
      sendJson(res, 200, { ok: true, state: result.state });
      return;
    }
    if (rest === 'media' && method === 'DELETE') {
      const kind = url.searchParams.get('kind');
      if (kind === null || !KINDS.includes(kind)) {
        sendJson(res, 400, { ok: false, error: 'bad-request' });
        return;
      }
      sendJson(res, 200, { ok: true, state: await store.clearMedia(kind) });
      return;
    }
    if (rest.startsWith('asset/') && (method === 'GET' || method === 'HEAD')) {
      const name = decodeURIComponent(rest.slice('asset/'.length));
      const asset = await store.readAsset(name);
      if (asset === undefined) {
        sendJson(res, 404, { ok: false, error: 'not-found' });
        return;
      }
      sendAsset(req, res, asset);
      return;
    }
    sendJson(res, 404, { ok: false, error: 'not-found' });
  } catch (error) {
    const code = error?.code;
    if (!res.headersSent && !res.writableEnded) {
      try {
        if (code === 'body-too-large') sendJson(res, 413, { ok: false, error: 'too-large' });
        else if (error instanceof SyntaxError) sendJson(res, 400, { ok: false, error: 'bad-request' });
        else sendJson(res, 500, { ok: false, error: 'internal-error' });
      } catch {
        /* the socket is already gone */
      }
    }
    if (code !== 'body-too-large' && code !== 'client-aborted') {
      console.warn(`${PLUGIN_ID}: request failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/** @returns the data directory of this bundle. */
function dataDirectory() {
  const configured = process.env.DSH_HOME?.trim();
  const home = configured !== undefined && configured !== '' ? configured : path.join(homedir(), '.dsh');
  return path.join(home, 'storages', 'dsh-style');
}

/** @returns a fresh default state object. */
function defaultState() {
  return { version: 1, name: '', dim: DEFAULT_DIM, logo: null, background: null };
}

/**
 * Coerce an unknown parsed document into the current state shape.
 *
 * @param raw - parsed state.json content.
 * @returns a safe state object.
 */
function normalizeState(raw) {
  const next = defaultState();
  if (raw === null || typeof raw !== 'object') return next;
  if (typeof raw.name === 'string') next.name = raw.name.trim().slice(0, 40);
  if (typeof raw.dim === 'number' && Number.isFinite(raw.dim)) next.dim = Math.min(MAX_DIM, Math.max(0, raw.dim));
  next.logo = normalizeAsset(raw.logo);
  next.background = normalizeAsset(raw.background);
  return next;
}

/**
 * Validate one stored media descriptor.
 *
 * @param raw - candidate descriptor.
 * @returns the descriptor, or null when it does not describe a servable file.
 */
function normalizeAsset(raw) {
  if (raw === null || typeof raw !== 'object') return null;
  if (typeof raw.file !== 'string' || !FILE_PATTERN.test(raw.file)) return null;
  if (typeof raw.type !== 'string' || !raw.type.startsWith('image/')) return null;
  return {
    file: raw.file,
    type: raw.type,
    bytes: typeof raw.bytes === 'number' && Number.isFinite(raw.bytes) ? raw.bytes : 0,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
  };
}

/**
 * Project stored state into the shape the Client half consumes.
 *
 * @param state - normalized state.
 * @returns client-facing state with asset URLs.
 */
function project(state) {
  return {
    name: state.name,
    dim: state.dim,
    logo: state.logo === null ? null : { ...state.logo, url: `${PREFIX}/asset/${state.logo.file}` },
    background:
      state.background === null ? null : { ...state.background, url: `${PREFIX}/asset/${state.background.file}` },
  };
}

/** @returns the response content type for one stored file name. */
function contentTypeOf(name) {
  if (name.endsWith('.png')) return 'image/png';
  if (name.endsWith('.jpg')) return 'image/jpeg';
  if (name.endsWith('.gif')) return 'image/gif';
  if (name.endsWith('.webp')) return 'image/webp';
  if (name.endsWith('.avif')) return 'image/avif';
  return 'image/svg+xml';
}

/**
 * Detect the image type from its own bytes — never from a client header.
 *
 * @param bytes - uploaded body.
 * @returns `{ type, ext }`, or undefined when the bytes are not a supported image.
 */
function sniffImage(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 4) return undefined;
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { type: 'image/png', ext: 'png' };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { type: 'image/jpeg', ext: 'jpg' };
  }
  const head = bytes.subarray(0, 16).toString('latin1');
  if (head.startsWith('GIF87a') || head.startsWith('GIF89a')) return { type: 'image/gif', ext: 'gif' };
  if (head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP') return { type: 'image/webp', ext: 'webp' };
  if (head.slice(4, 8) === 'ftyp') {
    const brand = head.slice(8, 12);
    if (brand === 'avif' || brand === 'avis') return { type: 'image/avif', ext: 'avif' };
  }
  if (looksLikeSvg(bytes.subarray(0, 8192).toString('utf8'))) return { type: 'image/svg+xml', ext: 'svg' };
  return undefined;
}

/**
 * Tell whether a leading text chunk opens an SVG document.
 *
 * @param text - decoded prefix of the upload.
 * @returns true for an XML/SVG document.
 */
function looksLikeSvg(text) {
  let rest = text.replace(/^\uFEFF/, '').trimStart();
  for (;;) {
    if (rest.startsWith('<?xml')) {
      const end = rest.indexOf('?>');
      if (end < 0) return false;
      rest = rest.slice(end + 2).trimStart();
      continue;
    }
    if (rest.startsWith('<!--')) {
      const end = rest.indexOf('-->');
      if (end < 0) return false;
      rest = rest.slice(end + 3).trimStart();
      continue;
    }
    const doctype = /^<!DOCTYPE/i.exec(rest);
    if (doctype !== null) {
      const end = rest.indexOf('>');
      if (end < 0) return false;
      rest = rest.slice(end + 1).trimStart();
      continue;
    }
    return /^<svg[\s>]/i.test(rest);
  }
}

/**
 * Read a request body with a hard ceiling.
 *
 * @param req - Node request.
 * @param limit - maximum accepted byte count.
 * @returns the complete body.
 */
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const fail = (error) => {
      req.removeAllListeners('data');
      req.on('error', () => undefined);
      reject(error);
    };
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        const error = new Error('request body too large');
        error.code = 'body-too-large';
        req.destroy();
        fail(error);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', (error) => {
      if (error?.code === 'ECONNRESET') error.code = 'client-aborted';
      reject(error);
    });
  });
}

/**
 * Read and parse a small JSON request body.
 *
 * @param req - Node request.
 * @returns the parsed value (an empty body yields undefined).
 */
async function readJson(req) {
  const body = await readBody(req, JSON_LIMIT);
  if (body.length === 0) return undefined;
  return JSON.parse(body.toString('utf8'));
}

/**
 * Write one JSON response.
 *
 * @param res - Node response.
 * @param status - HTTP status code.
 * @param payload - JSON-serializable body.
 */
function sendJson(res, status, payload) {
  const text = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
  });
  res.end(text);
}

/**
 * Stream one stored asset.
 *
 * @param req - Node request.
 * @param res - Node response.
 * @param asset - resolved asset metadata.
 */
function sendAsset(req, res, asset) {
  res.writeHead(200, {
    'content-type': asset.type,
    'content-length': asset.size,
    'cache-control': 'public, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
    'cross-origin-resource-policy': 'same-origin',
  });
  if ((req.method ?? 'GET').toUpperCase() === 'HEAD') {
    res.end();
    return;
  }
  const stream = createReadStream(asset.filePath);
  stream.on('error', () => {
    try {
      res.destroy();
    } catch {
      /* nothing left to close */
    }
  });
  stream.pipe(res);
}
