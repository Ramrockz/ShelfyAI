// Triggered daily by Vercel Cron (see vercel.json). Handles two one-time
// alerts per ingredient:
//   1. "expired" -- expiration_date is today or earlier, see
//      expiry_alert_sent_at on the ingredients table.
//   2. "expiring soon" -- expiration_date is within the next 7 days (but not
//      yet expired, to avoid double-alerting the same day #1 fires), see
//      expiry_soon_alert_sent_at on the ingredients table.
// Both create an in-app notification and push to every subscribed device.
const { createClient } = require('@supabase/supabase-js');
const webPush = require('web-push');

const EXPIRING_SOON_DAYS = 7;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

webPush.setVapidDetails(
  process.env.VAPID_SUBJECT,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

// A dead subscription (404/410) is retried never -- that endpoint will never
// work again, so the subscription is deleted immediately. Anything else
// (a transient network blip, the push service briefly unavailable) gets one
// retry after a short delay before being logged and dropped -- without this,
// a single momentary failure permanently loses that notification, since the
// caller already marks the item as alerted right after this runs either way.
async function sendPushWithRetry(sub, payload, attempt = 0) {
  try {
    await webPush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
      payload
    );
  } catch (pushError) {
    if (pushError.statusCode === 404 || pushError.statusCode === 410) {
      await supabase.from('push_subscriptions').delete().eq('id', sub.id);
      return;
    }
    if (attempt === 0) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      return sendPushWithRetry(sub, payload, attempt + 1);
    }
    console.error('Error sending push notification (after retry):', pushError);
  }
}

async function notifyUsers(supabase, itemsByUser, settingsColumn, buildMessage, pushTitle) {
  let usersNotified = 0;

  for (const [userId, items] of itemsByUser) {
    const { data: settings } = await supabase
      .from('user_settings')
      .select(`notifications_enabled, ${settingsColumn}`)
      .eq('user_id', userId)
      .single();

    const notifyEnabled = settings
      ? settings.notifications_enabled !== false && settings[settingsColumn] !== false
      : true;

    if (!notifyEnabled) continue;

    const { error: insertError } = await supabase.from('notifications').insert(
      items.map((ing) => ({
        profile_id: userId,
        type: ing._notificationType,
        ingredient_id: ing.id,
        message: buildMessage(ing),
        is_read: false
      }))
    );
    if (insertError) console.error('Error inserting notifications:', insertError);

    const { data: subscriptions } = await supabase
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth_key')
      .eq('user_id', userId);

    if (subscriptions && subscriptions.length) {
      const title = pushTitle(items.length);
      const body = items.map((i) => i.name).slice(0, 5).join(', ') + (items.length > 5 ? ', …' : '');
      const payload = JSON.stringify({ title, body, url: '/ingredients' });

      for (const sub of subscriptions) {
        await sendPushWithRetry(sub, payload);
      }
    }

    usersNotified++;
  }

  return usersNotified;
}

function groupByUser(items) {
  const byUser = new Map();
  for (const ing of items) {
    if (!byUser.has(ing.profile_id)) byUser.set(ing.profile_id, []);
    byUser.get(ing.profile_id).push(ing);
  }
  return byUser;
}

module.exports = async (req, res) => {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const soonCutoff = new Date(now);
    soonCutoff.setDate(soonCutoff.getDate() + EXPIRING_SOON_DAYS);
    const soonCutoffStr = soonCutoff.toISOString().split('T')[0];

    const [{ data: expired, error: expiredError }, { data: expiringSoon, error: soonError }] = await Promise.all([
      supabase
        .from('ingredients')
        .select('id, name, profile_id')
        .lte('expiration_date', today)
        .is('expiry_alert_sent_at', null),
      supabase
        .from('ingredients')
        .select('id, name, profile_id, expiration_date')
        .gt('expiration_date', today)
        .lte('expiration_date', soonCutoffStr)
        .is('expiry_soon_alert_sent_at', null)
    ]);
    if (expiredError) throw expiredError;
    if (soonError) throw soonError;

    let usersNotified = 0;

    if (expired && expired.length) {
      expired.forEach((ing) => { ing._notificationType = 'ingredient_expired'; });
      usersNotified += await notifyUsers(
        supabase,
        groupByUser(expired),
        'expired_item_notifications',
        (ing) => `${ing.name} has expired`,
        (count) => (count === 1 ? '1 item expired' : `${count} items expired`)
      );

      const { error: markError } = await supabase
        .from('ingredients')
        .update({ expiry_alert_sent_at: new Date().toISOString() })
        .in('id', expired.map((ing) => ing.id));
      if (markError) console.error('Error marking ingredients as alerted:', markError);
    }

    if (expiringSoon && expiringSoon.length) {
      expiringSoon.forEach((ing) => { ing._notificationType = 'ingredient_expiring_soon'; });
      usersNotified += await notifyUsers(
        supabase,
        groupByUser(expiringSoon),
        'expiring_soon_notifications',
        (ing) => {
          const days = Math.round((new Date(`${ing.expiration_date}T00:00:00`) - new Date(`${today}T00:00:00`)) / 86400000);
          return `${ing.name} expires in ${days} day${days === 1 ? '' : 's'}`;
        },
        (count) => (count === 1 ? '1 item expiring soon' : `${count} items expiring soon`)
      );

      const { error: markSoonError } = await supabase
        .from('ingredients')
        .update({ expiry_soon_alert_sent_at: new Date().toISOString() })
        .in('id', expiringSoon.map((ing) => ing.id));
      if (markSoonError) console.error('Error marking ingredients as soon-alerted:', markSoonError);
    }

    return res.status(200).json({
      processedExpired: expired ? expired.length : 0,
      processedExpiringSoon: expiringSoon ? expiringSoon.length : 0,
      usersNotified
    });
  } catch (error) {
    console.error('Error in send-expiry-notifications:', error);
    return res.status(500).json({ error: error.message });
  }
};
