import { kv } from '@vercel/kv';
import { decrypt } from './webhooks.js';
import { createHash } from 'node:crypto';

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

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { topPost, test, token, threatScore = 0 } = req.body ?? {};

  if (test) {
    if (!token) return res.status(400).json({ error: 'token required for test mode' });

    try {
      const tokenHash = hashToken(token);
      const entry     = await kv.get(`webhook:${tokenHash}`);
      if (!entry?.encrypted) return res.status(404).json({ error: 'Webhook not found - register it first.' });

      const webhookUrl = decrypt(entry.encrypted);
      const embed = {
        title:       '✅  Test - RBX Radar',
        description: "Your Discord webhook is connected and working correctly!\nThis message will update dynamically in silence.",
        color:       0x22c55e,
        url:         'https://robloxbanwave.vercel.app',
        fields:      [{ name: 'Webhook status', value: 'Verified ✓', inline: true }],
        footer:      { text: 'robloxbanwave.vercel.app  ·  r/robloxhackers' },
        timestamp:   new Date().toISOString()
      };

      const r = await fetch(webhookUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ 
          content: '', 
          username: 'Roblox Ban Wave', 
          avatar_url: 'https://robloxbanwave.vercel.app/logo.png', 
          embeds: [embed] 
        })
      });

      if (r.ok || r.status === 204) return res.json({ ok: true });

      const text = await r.text().catch(() => '');
      return res.status(400).json({ error: `Discord returned ${r.status}. ${text.slice(0, 160)}` });
    } catch (e) {
      if (kvError(e)) return res.status(503).json({ error: 'KV not configured' });
      return res.status(500).json({ error: e.message });
    }
  }

  const ipHash = hashIp(req);
  try {
    const rlKey = `rl:notify:${ipHash}`;
    const cnt   = await kv.incr(rlKey);
    if (cnt === 1) await kv.expire(rlKey, 3600);
    if (cnt > 12) return res.status(429).json({ error: 'Too many requests' });
  } catch {}

  let hashes;
  try {
    hashes = await kv.smembers('webhook:index');
  } catch (e) {
    if (kvError(e)) return res.status(503).json({ error: 'KV not configured' });
    return res.status(500).json({ error: e.message });
  }

  if (!hashes?.length) return res.json({ sent: 0, total: 0 });

  let statusTitle, statusColor, statusDesc;

  // Calcul basé sur le pourcentage (ex: 78% -> 0.78 ou si l'API envoie directement une valeur sur 1 ou sur 100)
  const scoreNum = Number(threatScore) > 1 ? Number(threatScore) / 100 : Number(threatScore);

  if (scoreNum >= 0.35 || Number(threatScore) >= 3.5) {
    statusTitle = '🚨 NOT SAFE';
    statusColor = 0xef4444;
    statusDesc  = '**Active ban wave with significant recent reports. Stop all executors immediately.**\nAccounts using executors risk permanent bans.';
  } else if (scoreNum >= 0.10 || Number(threatScore) >= 1.0) {
    statusTitle = '⚠️ USE CAUTION';
    statusColor = 0xf59e0b;
    statusDesc  = '**Elevated activity — a wave may be starting or winding down.**\nCheck the reports before running anything.';
  } else {
    statusTitle = '🟢 ALL CLEAR';
    statusColor = 0x22c55e;
    statusDesc  = '**No significant ban wave activity in the past 14 days.**\nLower risk, but conditions can change quickly.';
  }

  let sent     = 0;
  let skipped  = 0;
  const failed = [];

  for (const hash of hashes) {
    try {
      const entry = await kv.get(`webhook:${hash}`);
      if (!entry?.encrypted) { skipped++; continue; }

      const webhookUrl = decrypt(entry.encrypted);
      
      const displayScore = Number(threatScore) > 1 ? `${threatScore}%` : `${(Number(threatScore) * 100).toFixed(0)}%`;

      const fields = [
        { name: 'THREAT LEVEL', value: `**${displayScore}**`, inline: true }
      ];

      if (topPost) {
        fields.push({ name: 'Most Recent Report', value: `[${topPost.title}](${topPost.url})`, inline: false });
      }

      const embed = {
        title:       statusTitle,
        description: statusDesc,
        color:       statusColor,
        url:         'https://robloxbanwave.vercel.app',
        fields:      fields,
        footer:      { text: 'robloxbanwave.vercel.app  ·  r/robloxhackers' },
        timestamp:   new Date().toISOString()
      };

      if (entry.lastMessageId) {
        const editUrl = `${webhookUrl}/messages/${entry.lastMessageId}`;
        const r = await fetch(editUrl, {
          method:  'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ 
            content: '', 
            embeds: [embed] 
          })
        });

        if (r.ok) {
          sent++;
          continue;
        }
      }

      const r = await fetch(`${webhookUrl}?wait=true`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ 
          content: '', 
          username: 'Roblox Ban Wave', 
          avatar_url: 'https://robloxbanwave.vercel.app/logo.png', 
          embeds: [embed] 
        })
      });

      if (r.ok || r.status === 200) {
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
