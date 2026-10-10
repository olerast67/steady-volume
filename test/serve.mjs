// Minimal static server for the test pages: node test/serve.mjs [port]
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const port = Number(process.argv[2]) || 8765;
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.wav': 'audio/wav', '.mp4': 'video/mp4', '.webm': 'video/webm', '.m4a': 'audio/mp4',
};

createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
  const file = join(root, path || 'test/harness.html');
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    const headers = { 'content-type': types[extname(file)] || 'application/octet-stream' };
    // ?cors=1 imitates a CDN that allows cross-origin reads
    if (new URL(req.url, 'http://x').searchParams.has('cors')) headers['access-control-allow-origin'] = '*';
    headers['accept-ranges'] = 'bytes';
    // Range support, as on real media servers: without it Firefox can't seek to a part not yet downloaded
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (m) {
      const start = m[1] ? Number(m[1]) : body.length - Number(m[2]);
      const end = m[1] && m[2] ? Math.min(Number(m[2]), body.length - 1) : body.length - 1;
      headers['content-range'] = `bytes ${start}-${end}/${body.length}`;
      res.writeHead(206, headers).end(body.subarray(start, end + 1));
      return;
    }
    res.writeHead(200, headers).end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`http://127.0.0.1:${port}/`));
