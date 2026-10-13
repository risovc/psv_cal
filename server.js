/**
 * Local Preview & Edge Function Simulator Server (Zero Dependencies)
 * ---------------------------------------------------------------------------
 * - Serves static assets for PSVCalc Pro on port 8085
 * - Mounts Cloudflare Pages Function `/functions/api/ask-psv.js` at `POST /api/ask-psv`
 * - Reads `GEMINI_API_KEY` from local git-ignored `.env.local` (never served over HTTP)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 8085);

function loadLocalEnv() {
  const env = { ...process.env };
  const envPath = path.join(ROOT, '.env.local');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        const k = trimmed.slice(0, eqIdx).trim();
        const v = trimmed.slice(eqIdx + 1).trim();
        env[k] = v;
      }
    }
  }
  return env;
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.zip': 'application/zip'
};

let cfHandlerPromise = null;
function getCfHandler() {
  if (!cfHandlerPromise) {
    const modUrl = pathToFileURL(path.join(ROOT, 'functions', 'api', 'ask-psv.js')).href;
    cfHandlerPromise = import(modUrl);
  }
  return cfHandlerPromise;
}

const server = http.createServer(async (req, res) => {
  try {
    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    let pathname = decodeURIComponent(parsedUrl.pathname);

    // Block any access to dot-files (.env.local, .gitignore, etc.)
    if (pathname.split('/').some(part => part.startsWith('.'))) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('403 Forbidden');
      return;
    }

    // Route POST /api/ask-psv to Cloudflare Pages Function
    if (pathname === '/api/ask-psv') {
      const cfMod = await getCfHandler();
      if (req.method === 'OPTIONS' && cfMod.onRequestOptions) {
        const cfRes = await cfMod.onRequestOptions();
        res.writeHead(cfRes.status, Object.fromEntries(cfRes.headers.entries()));
        res.end();
        return;
      }
      if (req.method === 'POST' && cfMod.onRequestPost) {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const rawBody = Buffer.concat(chunks).toString('utf8');
        const env = loadLocalEnv();
        const context = {
          env,
          request: {
            json: async () => JSON.parse(rawBody || '{}'),
            text: async () => rawBody
          }
        };
        const cfRes = await cfMod.onRequestPost(context);
        const bodyText = await cfRes.text();
        res.writeHead(cfRes.status, Object.fromEntries(cfRes.headers.entries()));
        res.end(bodyText);
        return;
      }
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Method Not Allowed' }));
      return;
    }

    if (pathname === '/') pathname = '/index.html';
    const filePath = path.resolve(ROOT, '.' + pathname);
    if (!filePath.startsWith(ROOT + path.sep) && filePath !== ROOT) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache'
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('500 Internal Server Error');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`PSVCalc Pro server listening on http://0.0.0.0:${PORT}`);
});
