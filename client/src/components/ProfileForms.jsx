import { useState } from 'react';
import { useTaxonomy } from '../api/hooks.js';
import { Button, ChipSelect, Field, MoneyInput, Toggle } from './ui.jsx';
import { toMajor, toMinor } from '../lib/format.js';

const PLATFORMS = ['instagram', 'youtube', 'linkedin', 'x', 'facebook', 'snapchat', 'moj', 'josh', 'sharechat', 'podcast', 'blog', 'other'];
const csv = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
const intOrNull = (v) => (v === '' || v === null || v === undefined ? null : Number.parseInt(v, 10));

function FormActions({ saving, submitLabel = 'Save', secondary }) {
  return (
    <div className="row between" style={{ marginTop: 8 }}>
      <div>{secondary}</div>
      <Button type="submit" variant="primary" loading={saving}>
        {submitLabel}
      </Button>
    </div>
  );
}

// ---- Identity ---------------------------------------------------------------------
export function IdentityForm({ profile, onSave, saving, submitLabel, secondary }) {
  const tax = useTaxonomy();
  const [v, setV] = useState({
    publicName: profile.publicName || '',
    bio: profile.bio || '',
    city: profile.city || '',
    country: profile.country || 'India',
    languages: (profile.languages || []).join(', '),
    creatorType: profile.creatorType || '',
    niches: profile.niches || [],
    contentFormats: (profile.contentFormats || []).join(', '),
    platformProfiles: profile.platformProfiles?.length ? profile.platformProfiles.map((p) => ({ ...p, followers: p.followers ?? '' })) : [{ platform: 'instagram', handle: '', followers: '' }],
  });
  const [error, setError] = useState('');
  const set = (k) => (e) => {
    const val = e?.target ? e.target.value : e;
    setV((prev) => ({ ...prev, [k]: val }));
  };
  const submit = (e) => {
    e.preventDefault();
    if (!v.publicName.trim()) return setError('Add the name brands know you by.');
    if (!v.niches.length) return setError('Pick at least one content niche — discovery needs it.');
    setError('');
    onSave({
      publicName: v.publicName.trim(),
      bio: v.bio,
      city: v.city,
      country: v.country,
      languages: csv(v.languages),
      creatorType: v.creatorType || null,
      niches: v.niches,
      contentFormats: csv(v.contentFormats),
      platformProfiles: v.platformProfiles.filter((p) => p.handle || p.url).map((p) => ({ platform: p.platform, handle: p.handle || undefined, url: p.url || undefined, followers: intOrNull(p.followers) })),
    });
  };
  const updatePlatform = (i, k, val) => setV((prev) => ({ ...prev, platformProfiles: prev.platformProfiles.map((p, j) => (j === i ? { ...p, [k]: val } : p)) }));
  return (
    <form className="stack lg" onSubmit={submit} noValidate>
      {error && <div className="callout danger" role="alert">{error}</div>}
      <div className="grid cols-2">
        <Field label="Creator / public name">{(p) => <input {...p} className="input" value={v.publicName} onChange={set('publicName')} />}</Field>
        <Field label="Creator type">
          {(p) => (
            <select {...p} className="select" value={v.creatorType} onChange={set('creatorType')}>
              <option value="">Select…</option>
              <option value="individual">Individual creator</option>
              <option value="duo_group">Duo / group</option>
              <option value="channel_brand">Channel / media brand</option>
              <option value="expert_professional">Expert / professional</option>
            </select>
          )}
        </Field>
        <Field label="City (optional)">{(p) => <input {...p} className="input" value={v.city} onChange={set('city')} />}</Field>
        <Field label="Primary languages" hint="Comma-separated, e.g. English, Hindi, Tamil">{(p) => <input {...p} className="input" value={v.languages} onChange={set('languages')} />}</Field>
      </div>
      <Field label="Short bio">{(p) => <textarea {...p} className="textarea" rows={3} value={v.bio} onChange={set('bio')} maxLength={2000} />}</Field>
      <div className="field">
        <span className="label">Content niches (up to 8)</span>
        <ChipSelect label="Content niches" options={tax.data?.niches || []} value={v.niches} onChange={set('niches')} max={8} />
      </div>
      <Field label="Content formats" hint="Comma-separated, e.g. Reels, long-form YouTube, podcasts">{(p) => <input {...p} className="input" value={v.contentFormats} onChange={set('contentFormats')} />}</Field>
      <div className="stack sm">
        <span className="label">Social profiles</span>
        <span className="hint small faint">Follower counts are shown as creator-entered until verified through an official API.</span>
        {v.platformProfiles.map((p, i) => (
          <div key={i} className="grid cols-4" style={{ alignItems: 'end' }}>
            <Field label="Platform">
              {(a) => (
                <select {...a} className="select" value={p.platform} onChange={(e) => updatePlatform(i, 'platform', e.target.value)}>
                  {PLATFORMS.map((x) => <option key={x} value={x}>{x}</option>)}
                </select>
              )}
            </Field>
            <Field label="Handle">{(a) => <input {...a} className="input" value={p.handle || ''} onChange={(e) => updatePlatform(i, 'handle', e.target.value)} placeholder="@handle" />}</Field>
            <Field label="Followers">{(a) => <input {...a} className="input num" inputMode="numeric" value={p.followers ?? ''} onChange={(e) => updatePlatform(i, 'followers', e.target.value.replace(/\D/g, ''))} />}</Field>
            <Button variant="ghost" onClick={() => setV({ ...v, platformProfiles: v.platformProfiles.filter((_, j) => j !== i) })} aria-label="Remove profile">Remove</Button>
          </div>
        ))}
        <div><Button size="sm" onClick={() => setV({ ...v, platformProfiles: [...v.platformProfiles, { platform: 'youtube', handle: '', followers: '' }] })}>Add profile</Button></div>
      </div>
      <FormActions saving={saving} submitLabel={submitLabel} secondary={secondary} />
    </form>
  );
}

// ---- Audience ---------------------------------------------------------------------
export function AudienceForm({ profile, onSave, saving, submitLabel, secondary }) {
  const a = profile.audienceMetrics || {};
  const [v, setV] = useState({
    topLocations: (a.topLocations || []).join(', '),
    ageRanges: (a.ageRanges || []).join(', '),
    genderSplit: a.genderSplit || '',
    avgViews: a.avgViews ?? '',
    engagementRatePercent: a.engagementRatePercent ?? '',
    postingFrequency: a.postingFrequency || '',
    mediaKitUrl: profile.mediaKitUrl || '',
  });
  const [error, setError] = useState('');
  const set = (k) => (e) => {
    const val = e.target.value;
    setV((prev) => ({ ...prev, [k]: val }));
  };
  const submit = (e) => {
    e.preventDefault();
    const er = v.engagementRatePercent === '' ? null : Number(v.engagementRatePercent);
    if (er !== null && (Number.isNaN(er) || er < 0 || er > 100)) return setError('Engagement rate must be between 0 and 100.');
    if (v.mediaKitUrl && !/^https?:\/\//.test(v.mediaKitUrl)) return setError('Media kit link must start with http(s)://');
    setError('');
    onSave({
      audienceMetrics: { topLocations: csv(v.topLocations), ageRanges: csv(v.ageRanges), genderSplit: v.genderSplit, avgViews: intOrNull(v.avgViews), engagementRatePercent: er, postingFrequency: v.postingFrequency },
      mediaKitUrl: v.mediaKitUrl,
    });
  };
  return (
    <form className="stack lg" onSubmit={submit} noValidate>
      <div className="callout info small">Only add numbers you can back up. CreatorOS never invents audience metrics, and anything you enter here is labelled as creator-provided.</div>
      {error && <div className="callout danger" role="alert">{error}</div>}
      <div className="grid cols-2">
        <Field label="Top audience locations" hint="Comma-separated">{(p) => <input {...p} className="input" value={v.topLocations} onChange={set('topLocations')} />}</Field>
        <Field label="Main age ranges" hint="e.g. 18-24, 25-34">{(p) => <input {...p} className="input" value={v.ageRanges} onChange={set('ageRanges')} />}</Field>
        <Field label="Average views per post">{(p) => <input {...p} className="input num" inputMode="numeric" value={v.avgViews} onChange={(e) => setV({ ...v, avgViews: e.target.value.replace(/\D/g, '') })} />}</Field>
        <Field label="Engagement rate (%)">{(p) => <input {...p} className="input num" inputMode="decimal" value={v.engagementRatePercent} onChange={set('engagementRatePercent')} />}</Field>
        <Field label="Gender split (optional)">{(p) => <input {...p} className="input" value={v.genderSplit} onChange={set('genderSplit')} placeholder="e.g. 60% women" />}</Field>
        <Field label="Posting frequency">{(p) => <input {...p} className="input" value={v.postingFrequency} onChange={set('postingFrequency')} placeholder="e.g. 4 posts / week" />}</Field>
      </div>
      <Field label="Media kit link (optional)">{(p) => <input {...p} className="input" value={v.mediaKitUrl} onChange={set('mediaKitUrl')} placeholder="https://" />}</Field>
      <FormActions saving={saving} submitLabel={submitLabel} secondary={secondary} />
    </form>
  );
}

// ---- Commercial preferences ---------------------------------------------------------
// Render only after the taxonomy query has loaded (rate rows come from it).
export function CommercialForm({ profile, onSave, saving, submitLabel, secondary }) {
  const tax = useTaxonomy();
  const cp = profile.commercialPolicy || {};
  const bp = profile.brandPreferences || {};
  const barter = profile.barterPolicy || {};
  const rateMap = new Map((cp.rates || []).map((r) => [r.deliverable, r]));
  const accepted = new Set(cp.acceptedDeliverables || []);
  const [v, setV] = useState({
    currency: cp.currency || 'INR',
    minimumDeal: toMajor(cp.minimumDealMinor),
    preferredDeal: toMajor(cp.preferredDealMinor),
    rates: Object.fromEntries((tax.data?.deliverables || []).map((d) => [d.value, { accepted: accepted.has(d.value), preferred: toMajor(rateMap.get(d.value)?.preferredMinor), minimum: toMajor(rateMap.get(d.value)?.minimumMinor) }])),
    maxPackageDiscountPercent: cp.maxPackageDiscountPercent ?? 10,
    maxRevisions: cp.maxRevisions ?? 2,
    maxUsageDays: cp.usageRights?.maxUsageDays ?? 90,
    paidAdsAllowed: !!cp.usageRights?.paidAdsAllowed,
    whitelistingAllowed: !!cp.usageRights?.whitelistingAllowed,
    perpetualAllowed: !!cp.usageRights?.perpetualAllowed,
    exclusivityAcceptable: !!cp.exclusivity?.acceptable,
    exclusivityMaxDays: cp.exclusivity?.maxDays ?? 0,
    maxNetDays: cp.paymentTerms?.maxNetDays ?? 30,
    minAdvancePercent: cp.paymentTerms?.minAdvancePercent ?? 0,
    maxActiveCampaigns: cp.workload?.maxActiveCampaigns ?? 4,
    minLeadTimeDays: cp.workload?.minLeadTimeDays ?? 7,
    paymentPreferences: cp.paymentPreferences || '',
    preferredCategories: bp.preferredCategories || [],
    prohibitedCategories: bp.prohibitedCategories || [],
    preferredBrands: (bp.preferredBrands || []).join(', '),
    avoidBrands: (bp.avoidBrands || []).join(', '),
    barterAcceptance: barter.acceptance || 'selective',
    barterMinimum: toMajor(barter.minimumValueMinor),
    barterCategories: barter.approvedCategories || [],
  });
  const [error, setError] = useState('');
  const set = (k) => (e) => {
    const val = e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e;
    setV((prev) => ({ ...prev, [k]: val }));
  };
  const setRate = (d, k, val) => setV((prev) => ({ ...prev, rates: { ...prev.rates, [d]: { ...prev.rates[d], [k]: val } } }));

  const submit = (e) => {
    e.preventDefault();
    const rates = [];
    for (const [deliverable, r] of Object.entries(v.rates)) {
      if (!r.accepted) continue;
      const pref = toMinor(r.preferred);
      const min = toMinor(r.minimum);
      if (pref === null || min === null) return setError(`Set both a preferred and a minimum rate for ${deliverable.replace(/_/g, ' ')}.`);
      if (min > pref) return setError(`The minimum for ${deliverable.replace(/_/g, ' ')} cannot be higher than the preferred rate.`);
      rates.push({ deliverable, preferredMinor: pref, minimumMinor: min });
    }
    const overlap = v.preferredCategories.filter((c) => v.prohibitedCategories.includes(c));
    if (overlap.length) return setError(`A category cannot be both preferred and prohibited: ${overlap.join(', ')}`);
    setError('');
    onSave({
      commercialPolicy: {
        currency: v.currency,
        minimumDealMinor: toMinor(v.minimumDeal),
        preferredDealMinor: toMinor(v.preferredDeal),
        rates,
        acceptedDeliverables: rates.map((r) => r.deliverable),
        maxPackageDiscountPercent: Number(v.maxPackageDiscountPercent) || 0,
        maxRevisions: Number(v.maxRevisions) || 0,
        usageRights: { maxUsageDays: Number(v.maxUsageDays) || 0, paidAdsAllowed: v.paidAdsAllowed, whitelistingAllowed: v.whitelistingAllowed, perpetualAllowed: v.perpetualAllowed },
        exclusivity: { acceptable: v.exclusivityAcceptable, maxDays: Number(v.exclusivityMaxDays) || 0 },
        paymentTerms: { maxNetDays: Number(v.maxNetDays) || 0, minAdvancePercent: Number(v.minAdvancePercent) || 0 },
        workload: { maxActiveCampaigns: Number(v.maxActiveCampaigns) || 1, minLeadTimeDays: Number(v.minLeadTimeDays) || 0 },
        paymentPreferences: v.paymentPreferences,
      },
      brandPreferences: { preferredCategories: v.preferredCategories, prohibitedCategories: v.prohibitedCategories, preferredBrands: csv(v.preferredBrands), avoidBrands: csv(v.avoidBrands) },
      barterPolicy: { acceptance: v.barterAcceptance, minimumValueMinor: toMinor(v.barterMinimum), approvedCategories: v.barterCategories },
    });
  };

  const cats = tax.data?.brandCategories || [];
  return (
    <form className="stack lg" onSubmit={submit} noValidate>
      {error && <div className="callout danger" role="alert">{error}</div>}
      <section className="stack">
        <h3>Rate card</h3>
        <p className="muted small">Your preferred rate is what CreatorOS asks for. Your minimum is a hard floor: the AI can never offer less without your approval.</p>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Deliverable</th><th>Offer it</th><th>Preferred rate</th><th>Minimum rate</th></tr>
            </thead>
            <tbody>
              {(tax.data?.deliverables || []).map((d) => {
                const r = v.rates[d.value] || {};
                return (
                  <tr key={d.value}>
                    <td>{d.label}</td>
                    <td><input type="checkbox" aria-label={`Offer ${d.label}`} checked={!!r.accepted} onChange={(e) => setRate(d.value, 'accepted', e.target.checked)} style={{ accentColor: 'var(--primary)', width: 16, height: 16 }} /></td>
                    <td style={{ minWidth: 150 }}><MoneyInput aria-label={`${d.label} preferred rate`} currency={v.currency} value={r.preferred} onChange={(x) => setRate(d.value, 'preferred', x)} disabled={!r.accepted} /></td>
                    <td style={{ minWidth: 150 }}><MoneyInput aria-label={`${d.label} minimum rate`} currency={v.currency} value={r.minimum} onChange={(x) => setRate(d.value, 'minimum', x)} disabled={!r.accepted} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="grid cols-4">
          <Field label="Currency">
            {(p) => (
              <select {...p} className="select" value={v.currency} onChange={set('currency')}>
                {['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD'].map((c) => <option key={c}>{c}</option>)}
              </select>
            )}
          </Field>
          <Field label="Minimum paid deal">{(p) => <MoneyInput {...p} currency={v.currency} value={v.minimumDeal} onChange={set('minimumDeal')} />}</Field>
          <Field label="Preferred deal value">{(p) => <MoneyInput {...p} currency={v.currency} value={v.preferredDeal} onChange={set('preferredDeal')} />}</Field>
          <Field label="Max package discount (%)" hint="Multi-deliverable packages only">{(p) => <input {...p} className="input num" type="number" min="0" max="50" value={v.maxPackageDiscountPercent} onChange={set('maxPackageDiscountPercent')} />}</Field>
        </div>
      </section>

      <section className="stack">
        <h3>Terms you accept</h3>
        <div className="grid cols-4">
          <Field label="Max revision rounds">{(p) => <input {...p} className="input num" type="number" min="0" max="10" value={v.maxRevisions} onChange={set('maxRevisions')} />}</Field>
          <Field label="Default usage window (days)">{(p) => <input {...p} className="input num" type="number" min="0" value={v.maxUsageDays} onChange={set('maxUsageDays')} />}</Field>
          <Field label="Max payment terms (days)">{(p) => <input {...p} className="input num" type="number" min="0" max="180" value={v.maxNetDays} onChange={set('maxNetDays')} />}</Field>
          <Field label="Preferred advance (%)">{(p) => <input {...p} className="input num" type="number" min="0" max="100" value={v.minAdvancePercent} onChange={set('minAdvancePercent')} />}</Field>
        </div>
        <div className="grid cols-2">
          <Toggle checked={v.paidAdsAllowed} onChange={set('paidAdsAllowed')} label="Allow paid-ads usage (for a premium)" description="Always needs your approval per deal." />
          <Toggle checked={v.whitelistingAllowed} onChange={set('whitelistingAllowed')} label="Allow whitelisting / partnership ads" description="Brand runs ads from your handle." />
          <Toggle checked={v.perpetualAllowed} onChange={set('perpetualAllowed')} label="Allow perpetual usage" description="Not recommended." />
          <Toggle checked={v.exclusivityAcceptable} onChange={set('exclusivityAcceptable')} label="Exclusivity is negotiable" description="Always needs your approval per deal." />
        </div>
        {v.exclusivityAcceptable && <Field label="Maximum exclusivity (days)">{(p) => <input {...p} className="input num" type="number" min="0" max="730" value={v.exclusivityMaxDays} onChange={set('exclusivityMaxDays')} style={{ maxWidth: 200 }} />}</Field>}
        <div className="grid cols-3">
          <Field label="Max active campaigns">{(p) => <input {...p} className="input num" type="number" min="1" max="50" value={v.maxActiveCampaigns} onChange={set('maxActiveCampaigns')} />}</Field>
          <Field label="Minimum lead time (days)">{(p) => <input {...p} className="input num" type="number" min="0" max="90" value={v.minLeadTimeDays} onChange={set('minLeadTimeDays')} />}</Field>
          <Field label="Payment preferences">{(p) => <input {...p} className="input" value={v.paymentPreferences} onChange={set('paymentPreferences')} placeholder="e.g. Bank transfer, GST invoice" />}</Field>
        </div>
      </section>

      <section className="stack">
        <h3>Barter</h3>
        <div className="grid cols-2">
          <Field label="Barter collaborations">
            {(p) => (
              <select {...p} className="select" value={v.barterAcceptance} onChange={set('barterAcceptance')}>
                <option value="never">Never — paid only</option>
                <option value="selective">Selectively, with my approval</option>
                <option value="open">Open to barter</option>
              </select>
            )}
          </Field>
          <Field label="Minimum barter value" hint="Compared with half the brand-claimed retail price">{(p) => <MoneyInput {...p} currency={v.currency} value={v.barterMinimum} onChange={set('barterMinimum')} />}</Field>
        </div>
        {v.barterAcceptance !== 'never' && (
          <div className="field"><span className="label">Approved barter categories</span><ChipSelect label="Approved barter categories" options={cats} value={v.barterCategories} onChange={set('barterCategories')} /></div>
        )}
      </section>

      <section className="stack">
        <h3>Brand preferences</h3>
        <div className="field"><span className="label">Preferred categories</span><ChipSelect label="Preferred categories" options={cats} value={v.preferredCategories} onChange={set('preferredCategories')} /></div>
        <div className="field"><span className="label">Prohibited categories</span><span className="hint small faint">Brands in these categories are excluded from discovery.</span><ChipSelect label="Prohibited categories" tone="danger" options={cats} value={v.prohibitedCategories} onChange={set('prohibitedCategories')} /></div>
        <div className="grid cols-2">
          <Field label="Brands you'd love to work with" hint="Comma-separated">{(p) => <input {...p} className="input" value={v.preferredBrands} onChange={set('preferredBrands')} />}</Field>
          <Field label="Brands or products to avoid" hint="Comma-separated; excluded from discovery">{(p) => <input {...p} className="input" value={v.avoidBrands} onChange={set('avoidBrands')} />}</Field>
        </div>
      </section>
      <FormActions saving={saving} submitLabel={submitLabel} secondary={secondary} />
    </form>
  );
}
