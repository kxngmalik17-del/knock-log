import { useState } from 'react';
import { supabase } from '../lib/supabase';

export default function ResetPasswordModal({ onClose }) {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  async function handleReset(e) {
    e.preventDefault();
    setError('');

    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    const { error: err } = await supabase.auth.updateUser({ password: newPassword });
    setLoading(false);

    if (err) {
      setError(err.message);
    } else {
      setSuccess(true);
      // Close the modal after a short delay so the user sees the success message
      setTimeout(() => onClose(), 2200);
    }
  }

  return (
    <div className="reset-modal-overlay" onClick={onClose}>
      <div
        className="reset-modal-card"
        onClick={e => e.stopPropagation()}
      >
        {/* Icon */}
        <div className="reset-modal-icon">
          <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>

        <h2 className="reset-modal-title">Set New Password</h2>
        <p className="reset-modal-sub">Choose a strong password for your KnockLog account.</p>

        {success ? (
          <div className="reset-success">
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
            Password updated! Signing you in…
          </div>
        ) : (
          <form onSubmit={handleReset}>
            <input
              id="new-password-input"
              type="password"
              className="auth-input"
              placeholder="New password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              autoComplete="new-password"
              autoFocus
              required
            />
            <input
              id="confirm-password-input"
              type="password"
              className="auth-input"
              placeholder="Confirm new password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              required
            />

            {error && <div className="auth-error">{error}</div>}

            <button
              id="reset-password-submit"
              type="submit"
              className="auth-submit"
              disabled={loading}
            >
              {loading ? 'Updating…' : 'Update Password'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
