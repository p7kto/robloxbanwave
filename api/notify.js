import { kv } from '@vercel/kv';
import { decrypt } from './webhooks.js';
import { createHash } from 'node:crypto';

const SITE = 'https://robloxbanwave.vercel.app';
const LOGO = `${SITE}/logo.png`;
const BAR_SEGMENTS = 10;

function hashToken(token) {
  const salt = process.env.WEBHOOK_CIPHER_KEY || 'CHANGE_ME';
  return createHash('sha256').update(token + salt).digest('hex');
}

function hashIp(req) {
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  return createHash('sha256').update(ip).digest('hex').slice(0, 20);
}

function kvError(e) {
  return /KV_|UPSTASH|fetch failed/i.test(e?.message ?? '');
}

// ── embed helpers ────────────────────────────────────────────────────────────

const STATUS = {
  danger: {
    title:  '🚨  NOT SAFE',
    color:  0xef4444,
    dot:    '🟥',
    label:  '🔴 Critical',
    desc:   '**Active ban wave — significant recent reports.**\nAccounts using executors risk **permanent bans**.',
    advice: '⛔ **Stop all executors now.**\nWait for the threat level to drop before logging in with scripts.',
  },
  caution: {
    title:  '⚠️  USE CAUTION',
    color:  0xf59e0b,
    dot:    '🟧',
    label:  '🟠 Elevated',
    desc:   '**Elevated activity — a wave may be starting or winding down.**\nSomething is moving, stay alert.',
    advice: '🟡 **Check the latest reports first.**\nAvoid main accounts and risky scripts until things settle.',
  },
  safe: {
    title:  '🟢  ALL CLEAR',
    color:  0x22c55e,
    dot:    '🟩',
    label:  '🟢 Calm',
    desc:   '**No significant ban wave activity in the past 14 days.**\nLower risk — conditions can still change quickly.',
    advice: '✅ **No action needed.**\nStay updated, this message refreshes automatically.',
  },
};

function resolveStatus(rawScore) {
  const raw      = Number(rawScore);
  const scoreNum = raw > 1 ? raw / 100 : raw;
  const pct      = Math.max(0, Math.min(100, Math.round(scoreNum * 100)));

  let key = 'safe';
  if (scoreNum >= 0.35 || raw >= 3.5) key = 'danger';
  else if (scoreNum >= 0.10 || raw >= 1.0) key = 'caution';

  return { key, pct, status: STATUS[key] };
}

function progressBar(pct, dot) {
  const filled = pct === 0 ? 0 : Math.max(1, Math.round((pct / 100) * BAR_SEGMENTS));
  return dot.repeat(filled) + '⬛'.repeat(BAR_SEGMENTS - filled);
}

function trendText(pct, prev) {
  if (prev === null || prev === undefined) return '➖ First reading';
  const d = pct - prev;
  if (d > 0) return `📈 **+${d}** pts`;
  if (d < 0) return `📉 **${d}** pts`;
  return '➖ Stable';
}

function safeLink(post) {
  if (!post?.title || !/^https?:\/\//i.test(post?.url ?? '')) return null;
  const title = String(post.title).replace(/[\[\]]/g, '').slice(0, 180);
  return `[${title}](${post.url})`;
}

function buildEmbed({ status, pct, prev, nowUnix, topPost }) {
  const fields = [
    { name: '📊  Threat level', value: `**${pct}%**`,                      inline: true },
    { name: '📈  Trend',        value: trendText(pct, prev),                      inline: true },
    { name: '🕒  Updated',      value: `<t:${nowUnix}:R>\n<t:${nowUnix}:t>`,      inline: true },
    {
      name:   `${status.label}  ·  Ban wave intensity`,
      value:  `${progressBar(pct, status.dot)}  **${pct}%**\n\`0%\` ${'·'.repeat(18)} \`100%\``,
      inline: false,
    },
    { name: '🎯  Recommendation', value: status.advice, inline: false },
  ];

  const link = safeLink(topPost);
  if (link) fields.push({ name: '📰  Most recent report', value: link, inline: false });

  return {
    author:      { name: 'RBX RADAR  ·  Ban Wave Monitor', url: SITE, icon_url: LOGO },
    title:       status.title,
    url:         SITE,
    description: status.desc,
    color:       status.color,
    thumbnail:   { url: LOGO },
    fields,
    footer:      { text: 'robloxbanwave.vercel.app  ·  r/robloxhackers  ·  auto-updating', icon_url: LOGO },
    timestamp:   new Date().toISOString(),
  };
}

function buildTestEmbed(nowUnix) {
  return {
    author:      { name: 'RBX RADAR  ·  Ban Wave Monitor', url: SITE, icon_url: LOGO },
    title:       '✅  Connection verified',
    url:         SITE,
    description: 'Your Discord webhook is **connected and working**.\nThis message will be edited in place with live ban wave updates — no spam.',
    color:       0x22c55e,
    thumbnail:   { url: LOGO },
    fields: [
      { name: '🔗  Webhook', value: 'Verified ✓',                          inline: true },
      { name: '🔕  Mode',    value: 'Silent edits',                        inline: true },
      { name: '🕒  Tested',  value: `<t:${nowUnix}:R>\n<t:${nowUnix}:t>`,  inline: true },
    ],
    footer:      { text: 'robloxbanwave.vercel.app  ·  r/robloxhackers', icon_url: LOGO },
    timestamp:   new Date().toISOString(),
  };
}

function webhookBody(embed) {
  return JSON.stringify({
    content:    '',
    username:   'Roblox Ban Wave',
    avatar_url: LOGO,
    embeds:     [embed],
  });
}

// ── handler ──────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  let { topPost, test, token, threatScore } = req.body ?? {};

  if (test) {
    if (!token) return res.status(400).json({ error: 'token required for test mode' });

    try {
      const tokenHash = hashToken(token);
      const entry     = await kv.get(`webhook:${tokenHash}`);
      if (!entry?.encrypted) return res.status(404).json({ error: 'Webhook not found - register it first.' });

      const webhookUrl = decrypt(entry.encrypted);
      const nowUnix    = Math.floor(Date.now() / 1000);

      const r = await fetch(webhookUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    webhookBody(buildTestEmbed(nowUnix)),
      });

      if (r.ok || r.status === 204) return res.json({ ok: true });

      const text = await r.text().catch(() => '');
      return res.status(400).json({ error: `Discord returned ${r.status}. ${text.slice(0, 160)}` });
    } catch (e) {
      if (kvError(e)) return res.status(503).json({ error: 'KV not configured' });
      return res.status(500).json({ error: e.message });
    }
  }

  if (threatScore === undefined || threatScore === null) {
    try {
      const lastState = await kv.get('banwave:state');
      threatScore = lastState?.pct ?? 78;
    } catch {
      threatScore = 78;
    }
  }

  const ipHash = hashIp(req);
  try {
    const rlKey = `rl:notify:${ipHash}`;
    const cnt   = await kv.incr(rlKey);
    if (cnt === 1) await kv.expire(rlKey, 3600);
    if (cnt > 20) return res.status(429).json({ error: 'Too many requests' });
  } catch {}

  let hashes;
  try {
    hashes = await kv.smembers('webhook:index');
  } catch (e) {
    if (kvError(e)) return res.status(503).json({ error: 'KV not configured' });
    return res.status(500).json({ error: e.message });
  }

  if (!hashes?.length) return res.json({ sent: 0, total: 0 });

  const { pct, status } = resolveStatus(threatScore);
  const nowUnix = Math.floor(Date.now() / 1000);

  let prev = null;
  try {
    const st = await kv.get('banwave:state');
    if (st && typeof st.pct === 'number') prev = st.pct;
    await kv.set('banwave:state', { pct, prev, ts: nowUnix });
  } catch {}

  const embed = buildEmbed({ status, pct, prev, nowUnix, topPost });

  let sent     = 0;
  let skipped  = 0;
  const failed = [];

  for (const hash of hashes) {
    try {
      const entry = await kv.get(`webhook:${hash}`);
      if (!entry?.encrypted) { skipped++; continue; }

      const webhookUrl = decrypt(entry.encrypted);

      if (entry.lastMessageId) {
        const r = await fetch(`${webhookUrl}/messages/${entry.lastMessageId}`, {
          method:  'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ content: '', embeds: [embed] }),
        });

        if (r.ok) { 
          sent++; 
          continue; 
        } else {
          if (r.status === 404) {
            await kv.set(`webhook:${hash}`, { ...entry, lastMessageId: null });
          }
        }
      }

      const r = await fetch(`${webhookUrl}?wait=true`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    webhookBody(embed),
      });

      if (r.ok) {
        const data = await r.json();
        await kv.set(`webhook:${hash}`, { ...entry, lastMessageId: data.id });
        sent++;
      } else {
        failed.push(r.status);
      }
    } catch {
      failed.push('exception');
    }
  }

  return res.json({ sent, skipped, failed: failed.length });
}
