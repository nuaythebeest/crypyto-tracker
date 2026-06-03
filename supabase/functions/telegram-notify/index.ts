import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Direction emoji map
const DIRECTION_EMOJI: Record<string, string> = {
  LONG: '🟢',
  SHORT: '🔴',
};

// Alert type → emoji + label
const ALERT_META: Record<string, { emoji: string; label: string }> = {
  new_signal:     { emoji: '📡', label: 'NEW SIGNAL' },
  tp1:            { emoji: '🎯', label: 'TP1 HIT' },
  tp2:            { emoji: '🎯🎯', label: 'TP2 HIT' },
  tp3:            { emoji: '💰', label: 'TP3 HIT — FULL TARGET' },
  stop_loss:      { emoji: '🛑', label: 'STOP LOSS HIT' },
  loss_limit:     { emoji: '⛔', label: 'DAILY LOSS LIMIT' },
  signal_expired: { emoji: '⏰', label: 'SIGNAL EXPIRED' },
};

async function sendTelegramMessage(chatId: string, text: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
    }),
  });
}

serve(async (req) => {
  // This function is triggered by a Supabase database webhook on alerts INSERT
  const payload = await req.json();
  const alert = payload.record;

  if (!alert) return new Response('No record', { status: 400 });

  // Use service role to bypass RLS and fetch telegram_chat_id
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // For new_signal alerts: notify ALL users who have a telegram_chat_id
  // For all other alert types: notify only the user who owns the alert
  let chatIds: string[] = [];

  if (alert.alert_type === 'new_signal') {
    const { data: profiles } = await supabase
      .from('user_profiles')
      .select('telegram_chat_id')
      .not('telegram_chat_id', 'is', null);
    chatIds = (profiles ?? []).map((p: any) => p.telegram_chat_id).filter(Boolean);
  } else {
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('telegram_chat_id')
      .eq('id', alert.user_id)
      .single();
    if (profile?.telegram_chat_id) chatIds = [profile.telegram_chat_id];
  }

  if (chatIds.length === 0) return new Response('No telegram recipients', { status: 200 });

  const meta = ALERT_META[alert.alert_type] ?? { emoji: '🔔', label: alert.alert_type.toUpperCase() };
  const message = `${meta.emoji} <b>${meta.label}</b>\n${alert.message}`;

  await Promise.all(chatIds.map(chatId => sendTelegramMessage(chatId, message)));

  return new Response('OK', { status: 200 });
});
