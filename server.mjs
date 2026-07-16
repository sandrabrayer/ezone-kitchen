/**
 * Minimal, zero-dependency static file server for production (Railway).
 *
 * It serves the built SPA from ./dist and falls back to index.html for client
 * routes. In v1 there is no API surface — persistence is in the browser. When
 * a backend is added later, this same server is the natural home for an
 * `/api/*` prefix (see docs/ARCHITECTURE.md), so Railway config never changes.
 */
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), 'dist')
const PORT = process.env.PORT || 3000

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
}

async function send(res, filePath, status = 200) {
  const body = await readFile(filePath)
  res.writeHead(status, {
    'Content-Type': MIME[extname(filePath)] || 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff',
  })
  res.end(body)
}

const server = createServer(async (req, res) => {
  try {
    // Prevent path traversal by normalising and stripping leading separators.
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0])
    const safe = normalize(urlPath).replace(/^(\.\.[/\\])+/, '')
    let filePath = join(ROOT, safe)

    const info = await stat(filePath).catch(() => null)
    if (info?.isDirectory()) filePath = join(filePath, 'index.html')

    const exists = await stat(filePath).catch(() => null)
    if (exists) {
      await send(res, filePath)
    } else {
      // SPA fallback
      await send(res, join(ROOT, 'index.html'))
    }
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain' })
    res.end('Internal Server Error')
    console.error(err)
  }
})

server.listen(PORT, () => {
  console.log(`ezone-kitchen serving ./dist on port ${PORT}`)
})
