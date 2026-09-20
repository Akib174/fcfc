#!/usr/bin/env node
// ⚡ fcfc — এক কমান্ডে ক্লাউডফ্লেয়ারে ডিপ্লয় (Worker + D1 + KV + R2 + frontend সব একসাথে, একটাই URL)
//
// ব্যবহার:
//   ১) https://dash.cloudflare.com/profile/api-tokens → "Create Token"
//      → "Edit Cloudflare Workers" টেমপ্লেট → Create → টোকেন কপি করুন
//   ২) টার্মিনালে:
//        macOS/Linux:   export CLOUDFLARE_API_TOKEN="আপনার-টোকেন"
//        Windows PS:    $env:CLOUDFLARE_API_TOKEN="আপনার-টোকেন"
//   ৩) node deploy.mjs
//
// ঐচ্ছিক এনভায়রনমেন্ট:
//   CLOUDFLARE_ACCOUNT_ID=...   → একাধিক ক্লাউডফ্লেয়ার অ্যাকাউন্ট থাকলে কোনটা বোঝাতে
//   CALLS_API_TOKEN=...         → ভিডিও/ভয়েস কল চালু করতে (Calls API টোকেন)
//   PUSH_CONTACT=mailto:a@b.c   → পুশ নোটিফিকেশনের যোগাযোগ-ঠিকানা
//   node deploy.mjs --dry-run   → ক্লাউডে কিছু না পাঠিয়ে শুধু লোকাল চেক
//
// স্ক্রিপ্টটি ইডিম্পোটেন্ট — বার বার চালানো যায় (আগের রিসোর্স থাকলে রিইউজ করে)।

import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, rmSync, cpSync, unlinkSync, existsSync } from 'node:fs'
import { webcrypto } from 'node:crypto'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const WORKER = path.join(ROOT, 'worker')
const FRONTEND = path.join(ROOT, 'frontend')
const SECRETS_FILE = path.join(ROOT, '.deploy-secrets.json')
const DRY = process.argv.includes('--dry-run')

const log = (...a) => console.log(...a)
const die = (msg) => { console.error('\n✖ ' + msg); process.exit(1) }
const randHex = (n) => randomBytes(n).toString('hex')

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd || WORKER,
    stdio: opts.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    shell: true,
    env: { ...process.env, ...(opts.env || {}) },
    maxBuffer: 64 * 1024 * 1024,
  })
  if (opts.inherit) return { ok: r.status === 0, out: '' }
  return { ok: r.status === 0, out: ((r.stdout || '') + (r.stderr || '')) }
}
const wrangler = (args, opts = {}) => run('npx', ['wrangler', ...args], opts)

function b64u(bytes) {
  return Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// VAPID কী-জোড়া (Web Push) — worker/scripts/gen-vapid.mjs-এর মতোই
async function genVapid() {
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const raw = new Uint8Array(await webcrypto.subtle.exportKey('raw', pair.publicKey))
  const jwk = await webcrypto.subtle.exportKey('jwk', pair.privateKey)
  return { pub: b64u(raw), priv: jwk.d }
}

// সিক্রেটগুলো লোকালি .deploy-secrets.json-এ জমা থাকে — রি-ডিপ্লয়ে একই কী
// পুনঃব্যবহার হয় (নতুন করে জেনারেট করলে সব লগইন/পুশ-সাবস্ক্রিপশন ভেঙে যেত)।
async function loadOrCreateSecrets() {
  let s = {}
  try { s = JSON.parse(readFileSync(SECRETS_FILE, 'utf8')) } catch {}
  if (!s.JWT_SECRET) s.JWT_SECRET = randHex(32)
  if (!s.REFRESH_PEPPER) s.REFRESH_PEPPER = randHex(32)
  if (!s.VAPID_PUBLIC_KEY || !s.VAPID_PRIVATE_KEY) {
    const v = await genVapid()
    s.VAPID_PUBLIC_KEY = v.pub
    s.VAPID_PRIVATE_KEY = v.priv
  }
  if (!s.PUSH_CONTACT) s.PUSH_CONTACT = process.env.PUSH_CONTACT || 'mailto:admin@fcfc.app'
  if (process.env.CALLS_API_TOKEN) s.CALLS_API_TOKEN = process.env.CALLS_API_TOKEN
  return s
}

function hints(out) {
  const h = []
  if (/subdomain/i.test(out)) h.push('→ ড্যাশবোর্ড → Workers & Pages → ডান-উপরে workers.dev সাবডোমেইন একবার সেট করে আবার চালান')
  if (/not authorized|authentication code|10000|api token/i.test(out)) h.push('→ টোকেন ঠিক আছে কি দেখুন — "Edit Cloudflare Workers" টেমপ্লেট দিয়ে বানাতে হবে')
  if (/r2|bucket/i.test(out) && /error|fail|denied/i.test(out)) h.push('→ R2 প্রথমবার ব্যবহারে ড্যাশবোর্ড → R2 ওপেন করে অ্যাক্টিভেট করতে হয় (ফ্রি লিমিটের নিচে চার্জ লাগে না)')
  return h.length ? '\n💡 ইশারা:\n' + h.join('\n') : ''
}

async function main() {
  log('🚀 fcfc ডিপ্লয় শুরু' + (DRY ? '  (DRY RUN — ক্লাউডে কিছু যাবে না)' : '') + '\n')

  // ── ০. প্রস্তুতি-চেক ──
  const token = process.env.CLOUDFLARE_API_TOKEN
  if (!token && !DRY)
    die('CLOUDFLARE_API_TOKEN সেট করা হয়নি।\n' +
      '  macOS/Linux : export CLOUDFLARE_API_TOKEN="টোকেন"\n' +
      '  Windows PS  : $env:CLOUDFLARE_API_TOKEN="টোকেন"\n' +
      'টোকেন বানান: https://dash.cloudflare.com/profile/api-tokens → Create Token → "Edit Cloudflare Workers" টেমপ্লেট')
  if (parseInt(process.versions.node.split('.')[0], 10) < 18) die('Node.js 18+ দরকার (বর্তমান: ' + process.versions.node + ') — nodejs.org থেকে LTS ইনস্টল করুন')

  // ── ১. ডিপেন্ডেন্সি ──
  log('[1/8] ডিপেন্ডেন্সি ইনস্টল হচ্ছে…')
  for (const dir of [WORKER, FRONTEND]) {
    let r = run('npm', ['ci', '--no-audit', '--no-fund'], { cwd: dir })
    if (!r.ok) r = run('npm', ['install', '--no-audit', '--no-fund'], { cwd: dir })
    if (!r.ok) die('npm install ব্যর্থ (' + path.basename(dir) + '):\n' + r.out.slice(-2000))
  }
  log('      ✓ রেডি')

  // ── ২. টোকেন যাচাই + অ্যাকাউন্ট ──
  let accountId = process.env.CLOUDFLARE_ACCOUNT_ID || ''
  const cenv = { ...(token ? { CLOUDFLARE_API_TOKEN: token } : {}), ...(accountId ? { CLOUDFLARE_ACCOUNT_ID: accountId } : {}) }
  if (!DRY) {
    log('[2/8] টোকেন যাচাই হচ্ছে…')
    const w = wrangler(['whoami'])
    if (!w.ok) die('টোকেন দিয়ে লগইন যাচাই ব্যর্থ:\n' + w.out.slice(-1500) + hints(w.out))
    if (!accountId) {
      const ids = [...new Set(w.out.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) || [])]
      if (ids.length > 1)
        die('একাধিক ক্লাউডফ্লেয়ার অ্যাকাউন্ট পাওয়া যাচ্ছে:\n  ' + ids.join('\n  ') +
          '\nকোনটা ব্যবহার করবেন বলে দিন:\n  export CLOUDFLARE_ACCOUNT_ID="অ্যাকাউন্ট-আইডি" && node deploy.mjs')
      if (ids.length === 1) { accountId = ids[0]; Object.assign(cenv, { CLOUDFLARE_ACCOUNT_ID: accountId }) }
    }
    log('      ✓ টোকেন ঠিক আছে')
  }

  // ── ৩. D1 ডেটাবেস ──
  let dbId = ''
  if (!DRY) {
    log('[3/8] D1 ডেটাবেস (fcfc-db)…')
    const info = wrangler(['d1', 'info', 'fcfc-db'], { env: cenv })
    if (info.ok) {
      dbId = (info.out.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/) || [''])[0]
      log('      ✓ আগে থেকেই আছে:', dbId)
    } else {
      const cr = wrangler(['d1', 'create', 'fcfc-db'], { env: cenv })
      dbId = cr.ok ? (cr.out.match(/database_id\s*=\s*"([^"]+)"/) || [''])[1] : ''
      if (!dbId) die('D1 তৈরি ব্যর্থ:\n' + cr.out.slice(-1500) + hints(cr.out))
      log('      ✓ নতুন তৈরি হলো:', dbId)
    }
  }

  // ── ৪. KV namespace ──
  let kvId = ''
  if (!DRY) {
    log('[4/8] KV namespace (fcfc-kv)…')
    const cr = wrangler(['kv', 'namespace', 'create', 'fcfc-kv'], { env: cenv })
    if (cr.ok) kvId = (cr.out.match(/id\s*=\s*"([^"]+)"/) || [''])[1]
    if (!kvId) {
      const lr = wrangler(['kv', 'namespace', 'list'], { env: cenv })
      try {
        const arr = JSON.parse(lr.out.slice(lr.out.indexOf('['), lr.out.lastIndexOf(']') + 1))
        const hit = (arr || []).find((n) => n.title === 'fcfc-kv')
        if (hit) kvId = hit.id
      } catch {}
    }
    if (!kvId) die('KV namespace তৈরি/খুঁজে পাওয়া যায়নি:\n' + cr.out.slice(-1500) + hints(cr.out))
    log('      ✓', kvId)
  }

  // ── ৫. R2 bucket ──
  if (!DRY) {
    log('[5/8] R2 bucket (fcfc-media)…')
    const r = wrangler(['r2', 'bucket', 'create', 'fcfc-media'], { env: cenv })
    if (r.ok) log('      ✓ নতুন তৈরি হলো')
    else if (/already exist/i.test(r.out)) log('      ✓ আগে থেকেই আছে')
    else die('R2 তৈরি ব্যর্থ:\n' + r.out.slice(-1500) + hints(r.out))
  }

  // ── ৬. wrangler.toml-এ আসল আইডি বসানো + assets কনফিগ ──
  log('[6/8] wrangler.toml আপডেট হচ্ছে…')
  const tomlPath = path.join(WORKER, 'wrangler.toml')
  let toml = readFileSync(tomlPath, 'utf8')
  if (dbId) toml = toml.replace('REPLACE_WITH_YOUR_D1_DATABASE_ID', dbId)
  if (kvId) toml = toml.replace('REPLACE_WITH_YOUR_KV_NAMESPACE_ID', kvId)
  if (!toml.includes('[assets]')) {
    toml += '\n# ── ফ্রন্টএন্ড (SPA) static assets — deploy.mjs যোগ করেছে ──\n' +
      '# অ্যাপ ও API একই URL-এ চলে (CORS লাগে না)। শুধু API আলাদা চাইলে এই অংশটুকু মুছে দিন।\n' +
      '[assets]\ndirectory = "./public-dist"\nnot_found_handling = "single-page-application"\n'
  }
  writeFileSync(tomlPath, toml)
  log('      ✓ রেডি')

  // ── ৭. ফ্রন্টএন্ড বিল্ড → worker/public-dist ──
  log('[7/8] ফ্রন্টএন্ড বিল্ড হচ্ছে…')
  const br = run('npx', ['vite', 'build'], { cwd: FRONTEND, env: { VITE_API_BASE: '' } })
  if (!br.ok) die('ফ্রন্টএন্ড বিল্ড ব্যর্থ:\n' + br.out.slice(-2500))
  rmSync(path.join(WORKER, 'public-dist'), { recursive: true, force: true })
  cpSync(path.join(FRONTEND, 'dist'), path.join(WORKER, 'public-dist'), { recursive: true })
  log('      ✓ রেডি')

  // ── ৮. ডিপ্লয় ──
  if (DRY) {
    log('[8/8] DRY RUN — wrangler deploy --dry-run…\n')
    const r = wrangler(['deploy', '--dry-run'], { inherit: true })
    if (!r.ok) die('dry-run ব্যর্থ — কনফিগ/বিল্ড চেক করুন')
    log('\n✅ Dry-run সফল! আসল ডিপ্লয়ের জন্য CLOUDFLARE_API_TOKEN সেট করে আবার চালান (দ্রুততম পথের নির্দেশনা স্ক্রিপ্টের উপরে লেখা)।')
    return
  }

  log('[8/8] Worker ডিপ্লয় হচ্ছে…')
  const dep = wrangler(['deploy'], { env: cenv })
  if (!dep.ok) die('ডিপ্লয় ব্যর্থ:\n' + dep.out.slice(-3000) + hints(dep.out))
  const url = (dep.out.match(/https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev/) || [''])[0]
  log('      ✓ ডিপ্লয় হয়েছে' + (url ? ' → ' + url : ''))

  // ── সিক্রেট আপলোড ──
  log('… সিক্রেট সেট হচ্ছে (JWT, VAPID, push)…')
  const secrets = await loadOrCreateSecrets()
  writeFileSync(SECRETS_FILE, JSON.stringify(secrets, null, 2))
  const tmp = path.join(WORKER, '.secrets-tmp.json')
  writeFileSync(tmp, JSON.stringify(secrets))
  const sr = wrangler(['secret', 'bulk', '.secrets-tmp.json'], { env: cenv })
  try { unlinkSync(tmp) } catch {}
  if (!sr.ok) die('সিক্রেট আপলোড ব্যর্থ:\n' + sr.out.slice(-1500) + hints(sr.out))
  log('      ✓ সব সিক্রেট সেট' + (secrets.CALLS_API_TOKEN ? ' (Calls সহ)' : ''))

  // ── ডেটাবেস মাইগ্রেশন ──
  log('… ডেটাবেস মাইগ্রেশন চলছে…')
  const mr = wrangler(['d1', 'migrations', 'apply', 'fcfc-db', '--remote'], { env: cenv })
  if (!mr.ok) die('মাইগ্রেশন ব্যর্থ:\n' + mr.out.slice(-2000) + hints(mr.out))
  log('      ✓ স্কিমা রেডি')

  // ── লাইভ টেস্ট ──
  if (url) {
    log('… লাইভ স্মোক-টেস্ট…')
    try {
      const home = await fetch(url + '/')
      const check = await fetch(url + '/auth/check?username=zzz_deploy_test')
      const homeOk = home.ok && (await home.text()).includes('<div id="root">')
      const apiOk = check.ok && typeof (await check.json())?.ok === 'boolean'
      log('      ফ্রন্টএন্ড: ' + (homeOk ? '✓ চলছে' : '⚠ রেসপন্স অদ্ভুত (HTTP ' + home.status + ')'))
      log('      API (D1): ' + (apiOk ? '✓ চলছে' : '⚠ রেসপন্স অদ্ভুত (HTTP ' + check.status + ')'))
    } catch (e) {
      log('      ⚠ লাইভ টেস্ট স্কিপ: ' + e.message)
    }
  }

  console.log('\n' + '═'.repeat(62))
  console.log('🎉 সব রেডি!')
  if (url) console.log('   📱 অ্যাপ (এই URL-টাই সবাইকে দিন): ' + url)
  console.log('═'.repeat(62))
  console.log('পরবর্তী ধাপ:')
  console.log('  • ব্রাউজারে URL খুলে সাইনআপ করুন — পুরো অ্যাপ (চ্যাট+মিডিয়া) একই ঠিকানায়')
  console.log('  • সেটিংস → নোটিফিকেশন → "চালু করুন" দিলে পুশ নোটিফিকেশন কাজ করবে')
  if (!secrets.CALLS_API_TOKEN)
    console.log('  • (ঐচ্ছিক) ভিডিও/ভয়েস কল: ড্যাশবোর্ড → Calls → API টোকেন বানিয়ে চালান:\n      CALLS_API_TOKEN="টোকেন" node deploy.mjs')
  console.log('  • কোড বদলালে আবার ' + 'node deploy.mjs' + ' — সব ইডিম্পোটেন্ট')
  console.log('\n⚠ লোকাল ফাইল .deploy-secrets.json গোপন রাখুন (git-এ যাবে না)।')
}

main().catch((e) => die(e?.stack || String(e)))
