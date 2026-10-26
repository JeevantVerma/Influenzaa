import { getConfig } from '../../../config/env.js';
import { demoSource } from './demo.source.js';
import { rssSource } from './rss.source.js';
import { braveSource } from './brave.source.js';
import { gdeltSource } from './gdelt.source.js';
import { serperSource } from './serper.source.js';
import { instagramSource } from './instagram.source.js';

const ALL = { demo: demoSource, rss: rssSource, brave: braveSource, gdelt: gdeltSource, serper: serperSource, instagram: instagramSource };

/** Sources enabled at the platform level (DISCOVERY_SOURCES). */
export function platformSources() {
  return getConfig().discovery.sources.map((id) => ALL[id]).filter(Boolean);
}

/** Sources for one creator: platform-enabled ∩ creator-enabled. */
export function sourcesFor(config) {
  const enabled = config.sourceConfiguration?.enabledSources;
  const platform = platformSources();
  if (!enabled?.length) return platform;
  return platform.filter((s) => enabled.includes(s.id));
}

let override;
export function setSourcesForTests(list) {
  override = list;
}
export function resolveSources(config) {
  return override || sourcesFor(config);
}
