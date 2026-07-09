import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * Strip the `crossorigin` attribute Vite adds to the entry <script>/<link> tags.
 *
 * Our assets are same-origin, so crossorigin buys nothing — but it makes the
 * browser fetch them in CORS mode, which Cloudflare caches as a SEPARATE variant
 * from the normal request. During a deploy, a CORS request for a brand-new
 * hashed asset can momentarily hit the SPA fallback (index.html, text/html) and
 * get that cached as `immutable` for the asset URL. With `nosniff`, the browser
 * then refuses to apply the HTML as CSS and the whole site renders unstyled.
 * Removing crossorigin keeps requests in plain (non-CORS) mode, which serves the
 * real asset, and avoids ever creating the poisonable CORS cache variant.
 */
function stripCrossorigin(): Plugin {
  return {
    name: 'strip-crossorigin',
    transformIndexHtml: {
      order: 'post',
      handler: (html) => html.replace(/\s+crossorigin(?:=(?:"[^"]*"|'[^']*'))?/g, ''),
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), stripCrossorigin()],
})
