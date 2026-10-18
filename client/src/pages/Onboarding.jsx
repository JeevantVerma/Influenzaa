import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useApi, useTaxonomy, useAction } from '../api/hooks.js';
import { patch, post } from '../api/client.js';
import { IdentityForm, AudienceForm, CommercialForm } from '../components/ProfileForms.jsx';
import { PreferencesForm, EmailAuthorizationPanel } from '../components/AutomationPanels.jsx';
import { Button, Card, ErrorState, LoadingCard, Toggle } from '../components/ui.jsx';

const STEPS = [
  { id: 'identity', title: 'Creator identity', desc: 'Who you are and where you create' },
  { id: 'audience', title: 'Content & audience', desc: 'Only numbers you can back up' },
  { id: 'commercial', title: 'Commercial preferences', desc: 'Rates, rights and brand rules' },
  { id: 'automation', title: 'Automation & permissions', desc: 'What CreatorOS may do for you' },
];

export default function OnboardingPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const profile = useApi('profile', '/creator-profile/me');
  const tax = useTaxonomy();
  const [step, setStep] = useState(null);
  const [startDiscovery, setStartDiscovery] = useState(true);

  const save = useAction((body) => patch('/creator-profile/me', body), {
    invalidate: ['profile', 'dashboard'],
    onSuccess: (data, body) => {
      qc.setQueryData(['profile'], data);
      const idx = STEPS.findIndex((s) => s.id === body.completeStep);
      if (idx < STEPS.length - 1) setStep(STEPS[idx + 1].id);
    },
  });
  const finish = useAction(
    async (body) => {
      await patch('/creator-profile/me', body);
      if (startDiscovery) await post('/discovery/start');
    },
    { invalidate: ['profile', 'dashboard', 'discovery'], success: startDiscovery ? 'Setup complete — discovery is running' : 'Setup complete', onSuccess: () => navigate('/dashboard') },
  );

  if (profile.isLoading || tax.isLoading) return <div className="content"><LoadingCard lines={6} /></div>;
  if (profile.error) return <div className="content"><ErrorState error={profile.error} onRetry={profile.refetch} /></div>;
  const p = profile.data;
  const done = new Set(p.onboardingStatus?.completedSteps || []);
  const current = step || (STEPS.find((s) => !done.has(s.id)) || STEPS[3]).id;
  const idx = STEPS.findIndex((s) => s.id === current);
  const back = idx > 0 ? <Button onClick={() => setStep(STEPS[idx - 1].id)}>Back</Button> : null;

  return (
    <div className="content" style={{ maxWidth: 960 }}>
      <div className="page-header">
        <div>
          <h1>Set up your AI talent manager</h1>
          <p>Progress is saved after each step. You can change everything later in Settings.</p>
        </div>
        <Button variant="ghost" onClick={() => navigate('/dashboard')}>Skip for now</Button>
      </div>
      <nav className="stepper" aria-label="Onboarding steps">
        {STEPS.map((s, i) => (
          <button key={s.id} className={done.has(s.id) ? 'done' : ''} aria-current={s.id === current ? 'step' : undefined} onClick={() => setStep(s.id)}>
            <span className="n">{done.has(s.id) ? '✓ ' : ''}Step {i + 1}</span>
            <span className="strong" style={{ color: 'var(--text)' }}>{s.title}</span>
            <span className="tiny" style={{ display: 'block' }}>{s.desc}</span>
          </button>
        ))}
      </nav>
      <Card title={STEPS[idx].title}>
        {current === 'identity' && <IdentityForm key="identity" profile={p} saving={save.isPending} submitLabel="Save and continue" onSave={(b) => save.mutate({ ...b, completeStep: 'identity' })} />}
        {current === 'audience' && <AudienceForm key="audience" profile={p} saving={save.isPending} submitLabel="Save and continue" secondary={back} onSave={(b) => save.mutate({ ...b, completeStep: 'audience' })} />}
        {current === 'commercial' && <CommercialForm key="commercial" profile={p} saving={save.isPending} submitLabel="Save and continue" secondary={back} onSave={(b) => save.mutate({ ...b, completeStep: 'commercial' })} />}
        {current === 'automation' && (
          <div className="stack lg">
            <div className="callout info small">
              You start at <strong>Level 0 · Draft only</strong>: CreatorOS researches and drafts, and nothing is sent without your approval. You can raise autonomy later in Settings once you trust the workflow.
            </div>
            <EmailAuthorizationPanel />
            <Toggle checked={startDiscovery} onChange={setStartDiscovery} label="Start sponsor discovery when I finish" description="Runs daily in the background until you pause or stop it." />
            <PreferencesForm key="automation" profile={p} saving={finish.isPending} submitLabel="Finish setup" secondary={back} onSave={(b) => finish.mutate({ ...b, completeStep: 'automation' })} />
          </div>
        )}
      </Card>
    </div>
  );
}
