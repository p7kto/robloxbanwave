I archived this project because I'm no longer working on it as it just works, there is also a feature in Roblox that makes the server in control of your movements so cheating isn't even possible on some/most games now, the website is still up though.

<div align="center">
  <img src="favicon.svg" width="96" height="96" alt="RBX Radar logo">
  <h1>Roblox Ban Wave - Live Exploit Status</h1>
  <p>Real-time Roblox ban wave tracker powered by community reports from r/robloxhackers.<br>
  No ads. No trackers. Free forever. Made with love in the UK.</p>
  <p>
    <a href="https://robloxbanwave.vercel.app">robloxbanwave.vercel.app</a>
    &nbsp;&middot;&nbsp;
    <a href="https://robloxbanwave.vercel.app/api/rss">RSS Feed</a>
  </p>
</div>

---

## Features

- **ACTIVE / WARNING / CLEAR** status based on weighted post scoring
- **Wave duration** - "first report X ago" timer on active waves
- **Post feed** with filtering (all / alerts / questions) and sort
- **18-month bar chart** with peak-day stats
- **Verified ban counter** - users submit screenshots; OCR validates the ban message; breakdown by executor shown on the most recent wave post
- **Discord webhook notifications** - register once, get pinged on new waves; includes test button, URL replace, and delete
- **RSS feed** at `/api/rss` - subscribe in any RSS reader
- **FAQ** covering accuracy, false positives, scoring, and privacy
- **About section** - explains Byfron/Hyperion, what ban waves are, and what to do if banned
- **Safety tips** and resource links
- **14-language translation** via Google Translate (external tab, no scripts loaded)
- **Auto-refresh** every 5 minutes with visible countdown ring

---

## Architecture

All Reddit traffic is server-side - browsers never contact Reddit directly.

```
Browser --> /api/reddit     -->  Vercel KV cache  -->  Reddit RSS (if stale)
Browser --> /api/rss        -->  same cache
Browser --> /api/webhooks   -->  Vercel KV (encrypted webhook URLs)
Browser --> /api/notify     -->  Vercel KV --> Discord webhook
Browser --> /api/verify-ban -->  Vercel KV (verified ban counts)
```

### Caching and rate limiting

- Reddit is contacted **at most once every 5 minutes**, shared across all visitors
- On 403 / 429: exponential backoff (x2 each failure, up to x12 = 60-minute interval)
- Stale cache is always served rather than showing an error - the site stays up even if Reddit blocks every request for an hour
- Three-endpoint fallback chain: search RSS -> old.reddit search RSS -> new.rss feed
- Vercel edge CDN caches `/api/reddit` for 5 minutes - multiple concurrent visitors share one function invocation

### Webhook storage

Discord webhook URLs are stored **AES-256-GCM encrypted** in Vercel KV. The deletion token given to users is SHA-256 hashed before storage - the raw token is never persisted. Only the public webhook ID (Discord snowflake) is ever shown in the UI.

---

## Self-hosting / deploy

### 1. Fork and push to GitHub

```bash
git clone https://github.com/yourname/robloxbanwave
cd robloxbanwave
git push
```

### 2. Deploy on Vercel

1. Go to [vercel.com](https://vercel.com) and sign in with GitHub
2. Click **Add New -> Project**
3. Import your repository
4. Framework Preset: **Other**
5. Click **Deploy**

### 3. Add Vercel KV (required for webhooks, caching, and verified bans)

1. In your Vercel project dashboard - **Storage -> Create Database -> KV**
2. Name it anything (e.g. `rbx-kv`), choose the free Hobby tier
3. Vercel auto-injects `KV_URL`, `KV_REST_API_URL`, `KV_REST_API_TOKEN`, `KV_REST_API_READ_ONLY_TOKEN` as environment variables

Without KV the site still works - caching falls back to per-request, and webhook/verified-ban features return a 503 with a clear message.

### 4. Set environment variables

| Variable | Required | Description |
|---|---|---|
| `WEBHOOK_CIPHER_KEY` | Yes (for webhooks) | Random secret used to encrypt stored webhook URLs and hash tokens. Set to any long random string. |

Generate one:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Set it in **Vercel -> Project -> Settings -> Environment Variables**.

---

## Local development

```bash
npm install
npx vercel dev
```

Requires [Vercel CLI](https://vercel.com/docs/cli). KV calls will fail locally unless you pull env vars with `vercel env pull`.

---

## Files

```
index.html                  - full frontend (HTML + CSS + JS)
favicon.svg                 - radar-style vector icon
vercel.json                 - Vercel routing and cache headers
package.json                - @vercel/kv dependency
api/
  reddit.js                 - /api/reddit       - cached Reddit proxy
  rss.js                    - /api/rss          - RSS 2.0 feed
  webhooks.js               - /api/webhooks     - register / update / delete
  notify.js                 - /api/notify       - broadcast to Discord webhooks
  verify-ban.js             - /api/verify-ban   - OCR-validated ban reports
  _reddit-cache.js          - shared KV cache + 3-endpoint fallback (not an endpoint)
  _atom-parser.js           - Reddit Atom XML parser (not an endpoint)
```

---

## Privacy

- No analytics scripts
- No ad networks
- No cookies
- IP addresses are SHA-256 hashed before being used as rate-limit keys and are never logged or stored in plaintext
- Discord webhook URLs are encrypted at rest; only the public webhook ID is ever shown in the UI

---

## Free forever

This project is designed to run entirely within Vercel's free Hobby tier and Vercel KV's free tier (256 MB storage, 10,000 commands/day). No paid services are required.

---

Made with love in the UK. Not affiliated with Roblox Corporation.
