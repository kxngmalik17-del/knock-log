import { useState, useEffect } from 'react';
import { supabase } from './lib/supabase';
import Auth from './components/Auth';
import MainLayout from './components/MainLayout';
import './index.css';

export default function App() {
  const [session, setSession] = useState(null);
  const [repName, setRepName] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      if (s) fetchRepName(s.user.id);
      else setLoading(false);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
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
      .single();

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
    <MainLayout
      user={session.user}
      repName={repName}
      onLogout={handleLogout}
    />
  );
}
