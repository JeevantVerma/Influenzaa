// DEMO DATA — fictional brands on the reserved `.example` TLD. None of these
// companies, people, URLs or email addresses exist. Every record produced from
// this file is stored with isDemo=true and evidence verification "demo".
//
// `releaseAfterHours` makes signals appear progressively after discovery is
// first started, so repeated runs show genuinely new findings while unchanged
// findings are deduplicated.

export const DEMO_BRANDS = [
  {
    name: 'Glowleaf Botanicals',
    domain: 'glowleaf.example',
    industry: 'Clean skincare (D2C)',
    categories: ['skincare', 'beauty'],
    markets: ['India'],
    description: 'Ayurveda-inspired skincare brand selling online and in metro pharmacies.',
    contacts: [{ name: 'Ananya Rao (demo)', role: 'Influencer Partnerships Lead', roleCategory: 'creator_partnerships', email: 'ananya.rao@glowleaf.example', confidence: 0.85 }],
    signals: [
      { kind: 'creator_program', product: 'Glowleaf Creator Collective 2026', daysAgo: 6, releaseAfterHours: 0, title: 'Glowleaf opens applications for its Creator Collective', excerpt: 'We are inviting skincare and lifestyle creators across India to apply for paid, long-term partnerships for our monsoon range.' },
      { kind: 'product_launch', product: 'Saffron Night Repair Serum', daysAgo: 2, releaseAfterHours: 30, title: 'Glowleaf launches Saffron Night Repair Serum', excerpt: 'The new serum launches nationwide with a digital-first campaign planned for the festive season.' },
    ],
  },
  {
    name: 'PeakPulse Nutrition',
    domain: 'peakpulse.example',
    industry: 'Sports nutrition',
    categories: ['fitness', 'health_wellness', 'food_beverage'],
    markets: ['India'],
    description: 'Protein and hydration products for gym-goers and runners.',
    contacts: [{ name: null, role: 'Brand partnerships inbox', roleCategory: 'general_partnerships', email: 'partnerships@peakpulse.example', confidence: 0.55 }],
    signals: [
      { kind: 'product_launch', product: 'Electrolyte Hydration Sticks', daysAgo: 10, releaseAfterHours: 0, title: 'PeakPulse introduces sugar-free electrolyte sticks', excerpt: 'Launching first in Bengaluru, Pune and Hyderabad ahead of marathon season.' },
    ],
  },
  {
    name: 'Kettle & Kin',
    domain: 'kettleandkin.example',
    industry: 'Kitchenware',
    categories: ['home_decor', 'food_beverage'],
    markets: ['India'],
    description: 'Cast-iron and stainless steel cookware for Indian kitchens.',
    contacts: [],
    signals: [
      { kind: 'marketing_campaign', product: 'Festive Kitchen Edit', daysAgo: 18, releaseAfterHours: 0, title: 'Kettle & Kin announces Festive Kitchen Edit campaign', excerpt: 'The brand plans recipe-led video content for Diwali gifting.', barterOnly: true },
    ],
  },
  {
    name: 'Nimbus Audio',
    domain: 'nimbusaudio.example',
    industry: 'Consumer electronics',
    categories: ['tech_gadgets'],
    markets: ['India', 'UAE'],
    description: 'Affordable TWS earbuds and smartwatches.',
    contacts: [{ name: 'Rohit Menon (demo)', role: 'Digital Marketing Manager', roleCategory: 'brand_marketing', email: 'rohit.menon@nimbusaudio.example', confidence: 0.7 }],
    signals: [
      { kind: 'campaign_brief', product: 'Nimbus Buds Pro 3 launch', daysAgo: 4, releaseAfterHours: 0, title: 'Nimbus Audio publishes creator brief for Buds Pro 3', excerpt: 'Seeking tech and lifestyle creators for unboxing reels and YouTube integrations, launch window next month.' },
    ],
  },
  {
    name: 'Threadline Studio',
    domain: 'threadline.example',
    industry: 'Fashion',
    categories: ['fashion'],
    markets: ['India'],
    description: 'Handloom-inspired contemporary womenswear.',
    contacts: [{ name: 'Studio PR (demo agency)', role: 'PR & Influencer Agency', roleCategory: 'agency', email: 'threadline@brightpr.example', confidence: 0.6 }],
    signals: [
      { kind: 'similar_collaborations', product: 'Autumn handloom collection', daysAgo: 25, releaseAfterHours: 0, title: 'Threadline features 12 creators in its autumn lookbook', excerpt: 'The label has repeatedly partnered with micro-creators for styling reels.' },
    ],
  },
  {
    name: 'Ledgerly',
    domain: 'ledgerly.example',
    industry: 'Personal finance app',
    categories: ['finance', 'consumer_apps'],
    markets: ['India'],
    description: 'Expense tracking and SIP planning app.',
    contacts: [{ name: 'Priya Iyer (demo)', role: 'Creator Marketing Manager', roleCategory: 'creator_partnerships', email: 'priya.iyer@ledgerly.example', confidence: 0.8 }],
    signals: [
      { kind: 'creator_hiring', product: 'Creator marketing programme', daysAgo: 12, releaseAfterHours: 0, title: 'Ledgerly is hiring a Creator Marketing Manager', excerpt: 'Role will run finance-creator partnerships across YouTube and Instagram.' },
    ],
  },
  {
    name: 'Wanderlane Stays',
    domain: 'wanderlane.example',
    industry: 'Boutique travel',
    categories: ['travel'],
    markets: ['India'],
    description: 'Boutique homestays in the Himalayas and Konkan coast.',
    contacts: [],
    signals: [
      { kind: 'regional_expansion', product: 'New Konkan coast properties', daysAgo: 40, releaseAfterHours: 0, title: 'Wanderlane expands to five Konkan coast properties', excerpt: 'Expansion adds beach homestays near Ratnagiri and Sindhudurg.', barterOnly: true },
    ],
  },
  {
    name: 'LuckyPick Fantasy',
    domain: 'luckypick.example',
    industry: 'Real-money fantasy gaming',
    categories: ['real_money_gaming', 'gaming'],
    markets: ['India'],
    description: 'Real-money fantasy sports platform.',
    contacts: [{ name: null, role: 'Marketing inbox', roleCategory: 'general_partnerships', email: 'marketing@luckypick.example', confidence: 0.5 }],
    signals: [
      { kind: 'campaign_brief', product: 'Cricket season creator push', daysAgo: 3, releaseAfterHours: 0, title: 'LuckyPick seeks creators for cricket season campaign', excerpt: 'High-volume creator campaign for the upcoming league.' },
    ],
  },
  {
    name: 'Pawsome Pantry',
    domain: 'pawsomepantry.example',
    industry: 'Pet food',
    categories: ['pets'],
    markets: ['India'],
    description: 'Fresh-cooked dog and cat food delivery.',
    contacts: [],
    signals: [
      { kind: 'category_match', product: null, daysAgo: 90, releaseAfterHours: 0, title: 'Pawsome Pantry brand overview', excerpt: 'Subscription pet food brand active on Instagram.' },
    ],
  },
  {
    name: 'Brightpath Learning',
    domain: 'brightpath.example',
    industry: 'EdTech',
    categories: ['education', 'consumer_apps'],
    markets: ['India'],
    description: 'Upskilling courses in data and design.',
    contacts: [{ name: 'Karan Shah (demo)', role: 'Growth Marketing Lead', roleCategory: 'brand_marketing', email: 'karan.shah@brightpath.example', confidence: 0.65 }],
    signals: [
      { kind: 'product_launch', product: 'AI for Creators course', daysAgo: 8, releaseAfterHours: 48, title: 'Brightpath launches an "AI for Creators" cohort', excerpt: 'The new course targets content creators and freelancers; launch promotion through creator partners.' },
    ],
  },
  {
    name: 'Terra Tote',
    domain: 'terratote.example',
    industry: 'Sustainable accessories',
    categories: ['sustainability', 'fashion'],
    markets: ['India', 'Global'],
    description: 'Upcycled bags and travel accessories.',
    contacts: [{ name: null, role: 'Collaborations inbox', roleCategory: 'general_partnerships', email: 'collabs@terratote.example', confidence: 0.5 }],
    signals: [
      { kind: 'creator_program', product: 'Terra Tote Ambassador Programme', daysAgo: 1, releaseAfterHours: 72, title: 'Terra Tote launches a paid ambassador programme', excerpt: 'Quarterly paid partnerships for sustainability and travel creators.' },
    ],
  },
  {
    name: 'Barrel & Oak',
    domain: 'barrelandoak.example',
    industry: 'Alcoholic beverages',
    categories: ['alcohol'],
    markets: ['India'],
    description: 'Craft whisky brand.',
    contacts: [],
    signals: [
      { kind: 'marketing_campaign', product: 'Winter tasting series', daysAgo: 14, releaseAfterHours: 0, title: 'Barrel & Oak announces winter tasting series', excerpt: 'Event-led campaign in Mumbai and Delhi.' },
    ],
  },
  {
    name: 'Stride Lab',
    domain: 'stridelab.example',
    industry: 'Athletic footwear',
    categories: ['footwear', 'fitness', 'sports'],
    markets: ['India'],
    description: 'Running shoes engineered for Indian roads.',
    contacts: [{ name: 'Meera Pillai (demo)', role: 'Influencer Marketing Manager', roleCategory: 'creator_partnerships', email: 'meera.pillai@stridelab.example', confidence: 0.85 }],
    signals: [
      { kind: 'campaign_brief', product: 'Monsoon Run campaign', daysAgo: 5, releaseAfterHours: 24, title: 'Stride Lab posts creator brief for Monsoon Run', excerpt: 'Looking for fitness creators for 30-day running challenges with reels and stories.' },
    ],
  },
  {
    name: 'Chai Point Co. (demo)',
    domain: 'chaipointco.example',
    industry: 'Packaged beverages',
    categories: ['food_beverage'],
    markets: ['India'],
    description: 'Ready-to-brew masala chai blends.',
    contacts: [],
    signals: [
      { kind: 'product_launch', product: 'Cold Brew Masala Chai', daysAgo: 20, releaseAfterHours: 96, title: 'New cold brew masala chai lands in quick-commerce apps', excerpt: 'Launch includes sampling with food creators in Delhi NCR.' },
    ],
  },
];
