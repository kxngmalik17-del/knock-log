import { useState, useEffect } from 'react';
import { supabase } from './lib/supabase';
import Auth from './components/Auth';
import MainLayout from './components/MainLayout';
import ResetPasswordModal from './components/ResetPasswordModal';
import 'mapbox-gl/dist/mapbox-gl.css';
import './index.css';

export default function App() {
  const [session, setSession] = useState(null);
  const [repName, setRepName] = useState('');
  const [loading, setLoading] = useState(true);
  const [showResetModal, setShowResetModal] = useState(false);

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session: s }, error }) => {
      if (error) {
        // Stale refresh token — clear broken session
        supabase.auth.signOut();
        setSession(null);
        setLoading(false);
        return;
      }
      setSession(s);
      if (s) fetchRepName(s.user.id);
      else setLoading(false);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') {
        // User clicked the reset link in their email — show the set-password modal
        setShowResetModal(true);
        setSession(s);
        setLoading(false);
        return;
      }
      setSession(s);
      if (s) fetchRepName(s.user.id);
      else {
        setRepName('');
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  async function fetchRepName(userId) {
    const { data } = await supabase
      .from('reps')
      .select('display_name')
      .eq('user_id', userId)
      .maybeSingle();

    setRepName(data?.display_name || 'Rep');
    setLoading(false);
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    setSession(null);
    setRepName('');
  }

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner"></div>
        <p>Loading KnockLog…</p>
      </div>
    );
  }

  if (!session) {
    return <Auth />;
  }

  return (
    <>
      {showResetModal && (
        <ResetPasswordModal onClose={() => setShowResetModal(false)} />
      )}
      <MainLayout
        user={session.user}
        repName={repName}
        onLogout={handleLogout}
      />
    </>
  );
}
