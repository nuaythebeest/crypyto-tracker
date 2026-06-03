/**
 * Authentication Module — Login + Profile Setup
 * Uses Supabase Auth (email + password, invite-only)
 */

import { supabase } from '../api/supabase-client.js';

/**
 * Initialize authentication flow.
 * Checks for existing session, shows login if needed.
 * @param {Function} onAuthSuccess - callback(user, profile) when auth is complete
 */
export async function initAuth(onAuthSuccess) {
  // Check existing session first
  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    await handleAuthSuccess(session.user, onAuthSuccess);
    return;
  }

  // No session — show login screen
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('app-container').classList.add('hidden');

  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    const btn = document.getElementById('login-submit-btn');
    btn.disabled = true;
    btn.textContent = 'Signing in...';

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      showAuthError(error.message);
      btn.disabled = false;
      btn.textContent = 'Sign in';
      return;
    }
    await handleAuthSuccess(data.user, onAuthSuccess);
  });
}

/**
 * Handle successful authentication — check if profile exists
 */
async function handleAuthSuccess(user, onAuthSuccess) {
  // Check if user profile exists
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  if (!profile) {
    // First login — show profile setup
    showProfileSetup(user, onAuthSuccess);
    return;
  }

  // Profile exists — enter app
  hideAllAuthScreens();
  document.getElementById('app-container').classList.remove('hidden');
  onAuthSuccess(user, profile);
}

/**
 * Show the first-time profile setup form
 */
function showProfileSetup(user, onAuthSuccess) {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('profile-setup-screen').classList.remove('hidden');

  document.getElementById('profile-setup-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const profile = {
      id: user.id,
      display_name: document.getElementById('setup-name').value,
      account_size: parseFloat(document.getElementById('setup-account').value),
      risk_percent: parseFloat(document.getElementById('setup-risk').value),
      telegram_chat_id: document.getElementById('setup-telegram').value.trim() || null,
      default_leverage: 7
    };

    const { error } = await supabase.from('user_profiles').insert(profile);
    if (error) { showAuthError(error.message); return; }

    hideAllAuthScreens();
    document.getElementById('app-container').classList.remove('hidden');
    onAuthSuccess(user, profile);
  });
}

/**
 * Hide all authentication screens
 */
function hideAllAuthScreens() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('profile-setup-screen').classList.add('hidden');
}

/**
 * Display authentication error message
 */
function showAuthError(msg) {
  const el = document.getElementById('auth-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

/**
 * Sign out and reload
 */
export async function signOut() {
  await supabase.auth.signOut();
  location.reload();
}
