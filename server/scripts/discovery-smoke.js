// Live check of the real discovery sources. Runs the chosen sources for a
// sample creator profile and prints what they found. Makes real calls (GDELT,
// AI provider, Serper, Apify — Apify costs credit), writes nothing except the
// discovery cache, and never creates opportunities.
//
//   npm run discovery:smoke -w server -- --source=gdelt --niche=fitness
//   npm run discovery:smoke -w server -- --source=gdelt,serper,instagram --niche=fitness,food --fresh
//   npm run discovery:smoke -w server -- --source=instagram --niche=fashion --creators=handle1,handle2
//
// --fresh skips the cache (otherwise repeated runs within 12-24 h are free and instant).
import mongoose from 'mongoose';
import { getConfig } from '../src/config/env.js';
import { createGdeltSource } from '../src/services/discovery/sources/gdelt.source.js';
import { createSerperSource } from '../src/services/discovery/sources/serper.source.js';
import { createInstagramSource } from '../src/services/discovery/sources/instagram.source.js';
import { SIGNAL_KINDS } from '../src/services/discovery/taxonomy.js';

const arg = (name, fallback) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const sourceIds = arg('source', 'gdelt').split(',').map((s) => s.trim());
const niches = arg('niche', 'fitness').split(',').map((s) => s.trim());
const fresh = process.argv.includes('--fresh');
const creators = arg('creators', '').split(',').map((s) => s.trim().replace(/^@/, '')).filter(Boolean);

const noCache = async (_key, _ttl, fn) => ({ value: await fn(), cached: false });
const noProfileCache = { get: async () => null, set: async () => {} };
const opts = fresh ? { cacheFn: noCache } : {};
const FACTORIES = {
  gdelt: () => createGdeltSource(opts),
  serper: () => createSerperSource(opts),
  instagram: () => createInstagramSource(fresh ? { ...opts, profileCache: noProfileCache } : opts),
};

async function main() {
  const cfg = getConfig();
  await mongoose.connect(cfg.mongoUri);
  console.log(`Discovery smoke test · niches ${niches.join(', ')}${creators.length ? ` · similar creators: ${creators.length}` : ''}${fresh ? ' · cache skipped' : ''}\n`);
  for (const id of sourceIds) {
    const make = FACTORIES[id];
    if (!make) {
      console.log(`Unknown source "${id}" (choose from ${Object.keys(FACTORIES).join(', ')})\n`);
      continue;
    }
    const source = make();
    const t0 = Date.now();
    const r = await source.collect({ profile: { niches }, config: { sourceConfiguration: { instagramCreators: creators } }, now: new Date() });
    console.log(`■ ${source.label}`);
    console.log(`  status ${r.status} · ${r.candidates.length} brand(s) · ${Math.round((Date.now() - t0) / 1000)} s${r.message ? ` · ${r.message}` : ''}`);
    for (const c of r.candidates) {
      const kind = SIGNAL_KINDS[c.signal.kind];
      console.log(`  • ${c.brand.name} (${c.brand.domain})${c.brand.instagramHandle ? ` @${c.brand.instagramHandle}` : ''} — ${kind?.label || c.signal.kind} [${kind?.intent || '?'}]`);
      console.log(`    ${c.signal.title}`);
      for (const e of c.evidence.slice(0, 2)) console.log(`    ↳ ${e.url}${e.excerpt ? `\n      "${String(e.excerpt).slice(0, 160)}"` : ''}`);
    }
    console.log('');
  }
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
