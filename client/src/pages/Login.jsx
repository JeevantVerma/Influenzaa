import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useLocation } from 'react-router-dom';
import { post } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { Button, Field, Tabs } from '../components/ui.jsx';

const loginSchema = z.object({ email: z.string().email('Enter a valid email'), password: z.string().min(1, 'Enter your password') });
const registerSchema = z.object({
  name: z.string().trim().min(1, 'Enter your name').max(120),
  email: z.string().email('Enter a valid email'),
  password: z.string().min(10, 'Use at least 10 characters'),
});
const forgotSchema = z.object({ email: z.string().email('Enter a valid email') });

function ServerError({ error }) {
  if (!error) return null;
  return (
    <div className="callout danger small" role="alert">
      {error}
    </div>
  );
}

function LoginForm() {
  const { setSession } = useAuth();
  const location = useLocation();
  const [serverError, setServerError] = useState('');
  const { register, handleSubmit, formState } = useForm({ resolver: zodResolver(loginSchema) });
  const onSubmit = async (values) => {
    setServerError('');
    try {
      const data = await post('/auth/login', values);
      setSession(data, location.state?.from || '/dashboard');
    } catch (e) {
      setServerError(e.message);
    }
  };
  return (
    <form className="stack" onSubmit={handleSubmit(onSubmit)} noValidate>
      <ServerError error={serverError} />
      <Field label="Email" error={formState.errors.email?.message}>
        {(p) => <input {...p} className="input" type="email" autoComplete="email" {...register('email')} />}
      </Field>
      <Field label="Password" error={formState.errors.password?.message}>
        {(p) => <input {...p} className="input" type="password" autoComplete="current-password" {...register('password')} />}
      </Field>
      <Button type="submit" variant="primary" size="lg" loading={formState.isSubmitting}>
        Sign in
      </Button>
    </form>
  );
}

function RegisterForm() {
  const { setSession } = useAuth();
  const [serverError, setServerError] = useState('');
  const { register, handleSubmit, formState } = useForm({ resolver: zodResolver(registerSchema) });
  const onSubmit = async (values) => {
    setServerError('');
    try {
      const data = await post('/auth/register', values);
      setSession(data, '/onboarding');
    } catch (e) {
      setServerError(e.details?.[0]?.message || e.message);
    }
  };
  return (
    <form className="stack" onSubmit={handleSubmit(onSubmit)} noValidate>
      <ServerError error={serverError} />
      <Field label="Your name" error={formState.errors.name?.message}>
        {(p) => <input {...p} className="input" autoComplete="name" {...register('name')} />}
      </Field>
      <Field label="Email" error={formState.errors.email?.message}>
        {(p) => <input {...p} className="input" type="email" autoComplete="email" {...register('email')} />}
      </Field>
      <Field label="Password" hint="At least 10 characters" error={formState.errors.password?.message}>
        {(p) => <input {...p} className="input" type="password" autoComplete="new-password" {...register('password')} />}
      </Field>
      <Button type="submit" variant="primary" size="lg" loading={formState.isSubmitting}>
        Create account
      </Button>
      <p className="tiny faint">By creating an account you agree that CreatorOS stores your profile and sponsorship data to act on your behalf. You can export or delete it at any time.</p>
    </form>
  );
}

function ForgotForm() {
  const [done, setDone] = useState('');
  const [serverError, setServerError] = useState('');
  const { register, handleSubmit, formState } = useForm({ resolver: zodResolver(forgotSchema) });
  const onSubmit = async (values) => {
    setServerError('');
    try {
      const r = await post('/auth/forgot-password', values);
      setDone(r.message);
    } catch (e) {
      setServerError(e.message);
    }
  };
  if (done) return <div className="callout info">{done}</div>;
  return (
    <form className="stack" onSubmit={handleSubmit(onSubmit)} noValidate>
      <ServerError error={serverError} />
      <p className="muted small">Enter your account email and we'll send a link to reset your password. The link expires in 30 minutes.</p>
      <Field label="Email" error={formState.errors.email?.message}>
        {(p) => <input {...p} className="input" type="email" autoComplete="email" {...register('email')} />}
      </Field>
      <Button type="submit" variant="primary" loading={formState.isSubmitting}>
        Send reset link
      </Button>
    </form>
  );
}

export default function LoginPage() {
  const [tab, setTab] = useState('login');
  return (
    <div className="auth-page">
      <div className="auth-side">
        <div className="brandmark" style={{ color: '#fff' }}>
          <span className="logo">C</span> CreatorOS
        </div>
        <div className="stack lg">
          <h2>Your AI talent manager — finding sponsors, negotiating terms, and protecting your interests.</h2>
          <ul style={{ paddingLeft: 18, margin: 0 }}>
            <li>Discovers brands with evidence-backed reasons to collaborate now</li>
            <li>Negotiates within the boundaries you set — never below them</li>
            <li>Nothing binding is sent without your explicit approval</li>
          </ul>
        </div>
        <p className="tiny" style={{ color: '#8fb0ab' }}>Built for independent creators in India.</p>
      </div>
      <div className="auth-form">
        <div className="card card-body stack">
          <h1>{tab === 'register' ? 'Create your account' : tab === 'forgot' ? 'Reset password' : 'Welcome back'}</h1>
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'login', label: 'Sign in' },
              { value: 'register', label: 'Register' },
              { value: 'forgot', label: 'Forgot password' },
            ]}
          />
          {tab === 'login' && <LoginForm />}
          {tab === 'register' && <RegisterForm />}
          {tab === 'forgot' && <ForgotForm />}
        </div>
      </div>
    </div>
  );
}
