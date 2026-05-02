import { useState } from 'react';
import { supabase } from '../lib/supabase';

export default function Auth() {
  const [mode, setMode] = useState('login'); // 'login' | 'signup' | 'forgot'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [resetSent, setResetSent] = useState(false);

  async function handleLogin(e) {
    e.preventDefault();
    setLoading(true);
    setError('');
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    if (err) setError(err.message);
    setLoading(false);
  }

  async function handleSignup(e) {
    e.preventDefault();
    if (!displayName.trim()) {
      setError('Display name is required');
      return;
    }
    setLoading(true);
    setError('');

    const { data, error: signUpErr } = await supabase.auth.signUp({ email, password });
    if (signUpErr) {
      setError(signUpErr.message);
      setLoading(false);
      return;
    }

    // Create profile
    if (data.user) {
      const { error: profileErr } = await supabase.from('reps').insert({
        user_id: data.user.id,
        display_name: displayName.trim(),
      });
      if (profileErr) {
        setError('Account created but profile failed: ' + profileErr.message);
      } else if (!data.session) {
        setError('Success! Please check your email to verify your account before logging in.');
      }
    }
    setLoading(false);
  }

  async function handleForgotPassword(e) {
    e.preventDefault();
    setLoading(true);
    setError('');
    // redirectTo must match your Supabase "Site URL" or an allowed redirect URL
    const redirectTo = window.location.origin;
    const { error: err } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    setLoading(false);
    if (err) {
      setError(err.message);
    } else {
      setResetSent(true);
    }
  }

  function switchMode(newMode) {
    setMode(newMode);
    setError('');
    setResetSent(false);
  }

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-logo">
          <img src="/knocklog-logo.png" alt="KnockLog" className="auth-logo-img" />
          <p className="auth-subtitle">Door Knock Logger</p>
        </div>

        {mode !== 'forgot' && (
          <div className="auth-toggle">
            <button
              className={`toggle-btn ${mode === 'login' ? 'active' : ''}`}
              onClick={() => switchMode('login')}
            >
              Sign In
            </button>
            <button
              className={`toggle-btn ${mode === 'signup' ? 'active' : ''}`}
              onClick={() => switchMode('signup')}
            >
              Sign Up
            </button>
          </div>
        )}

        {mode === 'forgot' ? (
          <>
            {resetSent ? (
              <div className="reset-sent-msg">
                <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                  <polyline points="22,6 12,13 2,6" />
                </svg>
                <p>Check your email for a password reset link.</p>
              </div>
            ) : (
              <form onSubmit={handleForgotPassword}>
                <p className="forgot-instructions">
                  Enter your email and we'll send you a link to reset your password.
                </p>
                <input
                  id="forgot-email-input"
                  type="email"
                  placeholder="Email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  autoComplete="email"
                  className="auth-input"
                  required
                />
                {error && <div className="auth-error">{error}</div>}
                <button
                  id="forgot-submit-btn"
                  type="submit"
                  className="auth-submit"
                  disabled={loading}
                >
                  {loading ? 'Sending…' : 'Send Reset Link'}
                </button>
              </form>
            )}
            <button
              className="auth-back-link"
              onClick={() => switchMode('login')}
            >
              &larr; Back to Sign In
            </button>
          </>
        ) : (
          <form onSubmit={mode === 'login' ? handleLogin : handleSignup}>
            {mode === 'signup' && (
              <input
                id="display-name-input"
                type="text"
                placeholder="Your display name"
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                autoComplete="name"
                className="auth-input"
              />
            )}
            <input
              id="email-input"
              type="email"
              placeholder="Email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              autoComplete="email"
              className="auth-input"
              required
            />
            <input
              id="password-input"
              type="password"
              placeholder="Password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              className="auth-input"
              required
            />

            {error && <div className="auth-error">{error}</div>}

            <button
              id="auth-submit-btn"
              type="submit"
              className="auth-submit"
              disabled={loading}
            >
              {loading ? 'Please wait…' : mode === 'login' ? 'Sign In' : 'Create Account'}
            </button>

            {mode === 'login' && (
              <button
                type="button"
                className="auth-forgot-link"
                onClick={() => switchMode('forgot')}
              >
                Forgot password?
              </button>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
