// Shared vocabularies for onboarding, matching and the UI.

export const NICHES = [
  'beauty', 'skincare', 'fashion', 'fitness', 'health', 'food', 'tech', 'gaming', 'finance', 'education', 'travel',
  'lifestyle', 'parenting', 'comedy', 'music', 'sports', 'sustainability', 'pets', 'home', 'automotive', 'books',
];

export const BRAND_CATEGORIES = [
  'beauty', 'skincare', 'haircare', 'fashion', 'footwear', 'fitness', 'health_wellness', 'food_beverage', 'tech_gadgets',
  'consumer_apps', 'gaming', 'real_money_gaming', 'finance', 'crypto', 'education', 'travel', 'home_decor', 'parenting',
  'pets', 'automotive', 'sustainability', 'alcohol', 'tobacco', 'entertainment', 'books', 'sports',
];

// Categories considered a natural fit for each creator niche.
export const NICHE_TO_CATEGORIES = {
  beauty: ['beauty', 'skincare', 'haircare'],
  skincare: ['skincare', 'beauty', 'health_wellness'],
  fashion: ['fashion', 'footwear', 'beauty'],
  fitness: ['fitness', 'health_wellness', 'sports', 'food_beverage', 'footwear'],
  health: ['health_wellness', 'fitness', 'food_beverage'],
  food: ['food_beverage', 'home_decor', 'health_wellness'],
  tech: ['tech_gadgets', 'consumer_apps', 'gaming', 'finance'],
  gaming: ['gaming', 'tech_gadgets', 'consumer_apps', 'entertainment'],
  finance: ['finance', 'consumer_apps', 'education'],
  education: ['education', 'consumer_apps', 'books'],
  travel: ['travel', 'fashion', 'tech_gadgets', 'consumer_apps'],
  lifestyle: ['fashion', 'beauty', 'home_decor', 'food_beverage', 'travel', 'consumer_apps'],
  parenting: ['parenting', 'health_wellness', 'education', 'food_beverage'],
  comedy: ['entertainment', 'consumer_apps', 'food_beverage'],
  music: ['entertainment', 'tech_gadgets'],
  sports: ['sports', 'fitness', 'footwear', 'health_wellness'],
  sustainability: ['sustainability', 'home_decor', 'fashion', 'food_beverage'],
  pets: ['pets'],
  home: ['home_decor', 'sustainability', 'food_beverage'],
  automotive: ['automotive', 'tech_gadgets'],
  books: ['books', 'education', 'entertainment'],
};

export const SIGNAL_KINDS = {
  creator_program: { intent: 'high_intent', label: 'Public creator partnership programme' },
  campaign_brief: { intent: 'high_intent', label: 'Published influencer campaign brief' },
  creator_hiring: { intent: 'high_intent', label: 'Hiring for influencer / creator marketing' },
  product_launch: { intent: 'medium_intent', label: 'New product launch' },
  regional_expansion: { intent: 'medium_intent', label: 'Regional expansion' },
  marketing_campaign: { intent: 'medium_intent', label: 'Relevant marketing campaign' },
  paid_creator_partnerships: { intent: 'high_intent', label: 'Paying creators in your niche (Instagram paid partnerships)' },
  creator_campaign_news: { intent: 'high_intent', label: 'Reported influencer / creator campaign' },
  similar_collaborations: { intent: 'medium_intent', label: 'Repeated collaborations with similar creators' },
  funding_round: { intent: 'medium_intent', label: 'Recently raised funding' },
  category_match: { intent: 'low_intent', label: 'Operates in a matching category' },
};

/** Keyword classifier for headlines/excerpts from feeds and search results. */
export function classifySignalText(text) {
  const t = String(text || '').toLowerCase();
  if (/(creator|influencer|ambassador)\s*(programme|program|partnership|collab)|calling (all )?creators|apply to collaborate/.test(t)) return 'creator_program';
  if (/influencer (campaign|brief)|creator brief|ugc brief/.test(t)) return 'campaign_brief';
  if (/(hiring|job|vacancy|we're looking for).{0,40}(influencer|creator) (marketing|partnerships)/.test(t)) return 'creator_hiring';
  if (/launch|introduc|unveil|debut|new range|now available/.test(t)) return 'product_launch';
  if (/expan|enters|new stores?|now in|opens in/.test(t)) return 'regional_expansion';
  if (/campaign|festive|diwali|collection|sale/.test(t)) return 'marketing_campaign';
  return 'category_match';
}

// Search vocabulary per niche, used by the news (GDELT) and web search (Serper) sources.
export const NICHE_KEYWORDS = {
  beauty: ['beauty brand', 'cosmetics', 'makeup'],
  skincare: ['skincare', 'sunscreen', 'serum'],
  fashion: ['fashion brand', 'apparel', 'ethnic wear'],
  fitness: ['protein', 'sportswear', 'activewear', 'supplements'],
  health: ['wellness brand', 'nutrition', 'supplements'],
  food: ['snack brand', 'food brand', 'beverage'],
  tech: ['smartphone', 'gadgets', 'consumer electronics'],
  gaming: ['gaming', 'esports', 'gaming peripherals'],
  finance: ['fintech app', 'investing app', 'credit card'],
  education: ['edtech', 'learning app', 'online courses'],
  travel: ['travel brand', 'luggage', 'hotel'],
  lifestyle: ['lifestyle brand', 'd2c brand', 'home decor'],
  parenting: ['baby care', 'kids brand', 'parenting'],
  comedy: ['ott', 'streaming', 'snack brand'],
  music: ['audio brand', 'headphones', 'music streaming'],
  sports: ['sportswear', 'sports nutrition', 'footwear'],
  sustainability: ['sustainable brand', 'eco-friendly', 'organic'],
  pets: ['pet food', 'pet care', 'pet brand'],
  home: ['home decor', 'kitchenware', 'furniture'],
  automotive: ['electric scooter', 'car accessories', 'ev brand'],
  books: ['publisher', 'audiobooks', 'books'],
};

// Instagram hashtags per niche where Indian creators post brand collaborations.
export const NICHE_HASHTAGS = {
  beauty: ['indianbeautyblogger', 'makeupindia', 'beautyinfluencerindia'],
  skincare: ['skincareindia', 'indianskincare', 'skincarecommunityindia'],
  fashion: ['indianfashionblogger', 'fashioninfluencerindia', 'ootdindia'],
  fitness: ['fitnessindia', 'indianfitness', 'fitindia'],
  health: ['healthylivingindia', 'wellnessindia', 'healthyindia'],
  food: ['indianfoodblogger', 'foodbloggerindia', 'mumbaifoodie'],
  tech: ['techindia', 'indiantech', 'gadgetsindia'],
  gaming: ['indiangamer', 'gamingindia', 'bgmi'],
  finance: ['personalfinanceindia', 'stockmarketindia', 'financeindia'],
  education: ['studygramindia', 'upsc', 'learnwithinstagram'],
  travel: ['indiatravelgram', 'travelblogger_india', 'incredibleindia'],
  lifestyle: ['lifestyleblogger_india', 'indianinfluencer', 'mumbaiblogger'],
  parenting: ['indianmomblogger', 'momblogger_india', 'parentingindia'],
  comedy: ['indiancomedy', 'comedyreels_india', 'desicomedy'],
  music: ['indianmusician', 'indiemusicindia', 'singersofindia'],
  sports: ['indiansports', 'cricketlovers', 'runnersofindia'],
  sustainability: ['sustainableindia', 'zerowasteindia', 'ecofriendlyindia'],
  pets: ['dogsofindia', 'petsofindia', 'catsofindia'],
  home: ['homedecorindia', 'indianhomes', 'homedecorideasindia'],
  automotive: ['carsofindia', 'evindia', 'bikersofindia'],
  books: ['bookstagramindia', 'indianbookstagram', 'booksofindia'],
};

/**
 * The niches a source searches in this run: at most `max`, taking turns across
 * time windows so a creator with many niches gets all of them covered over a few runs.
 */
export function rotateNiches(niches = [], max, now = new Date(), windowHours = 12) {
  const list = [...new Set(niches)];
  if (list.length <= max) return list;
  const start = (Math.floor(now.getTime() / (windowHours * 3_600_000)) * max) % list.length;
  return Array.from({ length: max }, (_, i) => list[(start + i) % list.length]);
}
