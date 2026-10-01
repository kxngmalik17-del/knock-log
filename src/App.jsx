import { useState, useEffect } from 'react';
import { supabase } from './lib/supabase';
import { clearLocalUserData } from './lib/db';
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

  const handleUserSession = (s) => {
    if (s?.user?.id) {
      const lastUserId = localStorage.getItem('knocklog_active_user_id');
      if (lastUserId && lastUserId !== s.user.id) {
        console.log(`[Auth] User switch detected: from ${lastUserId} to ${s.user.id}. Clearing local database.`);
        clearLocalUserData();
        try {
          localStorage.removeItem('knocklog_active_street');
          localStorage.removeItem(`knocklog_active_street_${lastUserId}`);
        } catch (e) {}
      }
      localStorage.setItem('knocklog_active_user_id', s.user.id);
      fetchRepName(s.user.id);
    } else {
      setRepName('');
      setLoading(false);
    }
    setSession(s);
  };

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
      handleUserSession(s);
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
      handleUserSession(s);
    });

    return () => subscription.unsubscribe();
  }, []);

  async function fetchRepName(userId) {
    const { data } = await supabase
      .from('reps')
      .select('display_name')
      .eq('user_id', userId)
      .maybeSingle();

    if (data?.display_name) {
      setRepName(data.display_name);
    } else {
      // Fallback to auth user metadata if reps view is pending
      const { data: userData } = await supabase.auth.getUser();
      const metaName = userData?.user?.user_metadata?.full_name || userData?.user?.user_metadata?.display_name || 'Rep';
      setRepName(metaName);
    }
    setLoading(false);
  }

  async function handleLogout() {
    const currentId = session?.user?.id;
    await supabase.auth.signOut();
    try {
      localStorage.removeItem('knocklog_active_street');
      if (currentId) {
        localStorage.removeItem(`knocklog_active_street_${currentId}`);
      }
      clearLocalUserData();
    } catch (e) {}
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
