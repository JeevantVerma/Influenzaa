import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { post } from '../api/client.js';
import { Button, Field } from '../components/ui.jsx';

export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [password, setPassword] = useState('');
  const [state, setState] = useState({ loading: false, error: '', done: false });
  const submit = async (e) => {
    e.preventDefault();
    if (password.length < 10) return setState({ ...state, error: 'Use at least 10 characters' });
    setState({ loading: true, error: '', done: false });
    try {
      await post('/auth/reset-password', { token, password });
      setState({ loading: false, error: '', done: true });
    } catch (err) {
      setState({ loading: false, error: err.message, done: false });
    }
  };
  return (
    <div className="auth-form" style={{ minHeight: '100vh' }}>
      <form className="card card-body stack" onSubmit={submit} noValidate>
        <h1>Choose a new password</h1>
        {!token && <div className="callout danger">This reset link is missing its token.</div>}
        {state.done ? (
          <div className="callout info">
            Password updated. <Link to="/login">Sign in</Link>
          </div>
        ) : (
          <>
            {state.error && <div className="callout danger" role="alert">{state.error}</div>}
            <Field label="New password" hint="At least 10 characters">
              {(p) => <input {...p} className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
            </Field>
            <Button type="submit" variant="primary" loading={state.loading} disabled={!token}>
              Update password
            </Button>
          </>
        )}
      </form>
    </div>
  );
}
