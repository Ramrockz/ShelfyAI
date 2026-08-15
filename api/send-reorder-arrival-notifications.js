// Triggered daily by Vercel Cron (see vercel.json). Finds pending reorders
// whose ETA (reorder_date + estimated_delivery days -- same formula
// operations.html's Pending Deliveries panel uses for its "Late"/date chip)
// falls on today, creates the matching in-app notification, and pushes to
// every subscribed device via Web Push. Each reorder is only ever alerted
// once -- see reorder_arrival_alert_sent_at on the ingredients table,
// cleared whenever a new reorder is placed (reorder-modal.js's placeReorder()).
const { createClient } = require('@supabase/supabase-js');
const webPush = require('web-push');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

webPush.setVapidDetails(
  process.env.VAPID_SUBJECT,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

// A dead subscription (404/410) is never retried -- that endpoint will never
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

function etaIsToday(item, today) {
  const orderBase = item.reorder_date || (item.updated_at ? item.updated_at.split('T')[0] : null);
  if (!orderBase) return false;
  const eta = new Date(orderBase + 'T00:00:00');
  if (item.estimated_delivery) eta.setDate(eta.getDate() + parseInt(item.estimated_delivery, 10));
  return eta.toISOString().split('T')[0] === today;
}

module.exports = async (req, res) => {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const today = new Date().toISOString().split('T')[0];

    const { data: pending, error: fetchError } = await supabase
      .from('ingredients')
      .select('id, name, profile_id, reorder_date, estimated_delivery, updated_at')
      .eq('reorder_pending', true)
      .is('reorder_arrival_alert_sent_at', null);
    if (fetchError) throw fetchError;

    const arrivingToday = (pending || []).filter((item) => etaIsToday(item, today));
    if (!arrivingToday.length) {
      return res.status(200).json({ processed: 0, usersNotified: 0 });
    }

    const byUser = new Map();
    for (const ing of arrivingToday) {
      if (!byUser.has(ing.profile_id)) byUser.set(ing.profile_id, []);
      byUser.get(ing.profile_id).push(ing);
    }

    let usersNotified = 0;

    for (const [userId, items] of byUser) {
      const { data: settings } = await supabase
        .from('user_settings')
        .select('notifications_enabled, reorder_arrival_notifications')
        .eq('user_id', userId)
        .single();

      const notifyEnabled = settings
        ? settings.notifications_enabled !== false && settings.reorder_arrival_notifications !== false
        : true;

      if (notifyEnabled) {
        const { error: insertError } = await supabase.from('notifications').insert(
          items.map((ing) => ({
            profile_id: userId,
            type: 'reorder_arriving_today',
            ingredient_id: ing.id,
            message: `${ing.name} is expected to arrive today`,
            is_read: false
          }))
        );
        if (insertError) console.error('Error inserting reorder-arrival notifications:', insertError);

        const { data: subscriptions } = await supabase
          .from('push_subscriptions')
          .select('id, endpoint, p256dh, auth_key')
          .eq('user_id', userId);

        if (subscriptions && subscriptions.length) {
          const title = items.length === 1 ? '1 delivery arriving today' : `${items.length} deliveries arriving today`;
          const body = items.map((i) => i.name).slice(0, 5).join(', ') + (items.length > 5 ? ', …' : '');
          const payload = JSON.stringify({ title, body, url: '/operations' });

          for (const sub of subscriptions) {
            await sendPushWithRetry(sub, payload);
          }
        }

        usersNotified++;
      }
    }

    const { error: markError } = await supabase
      .from('ingredients')
      .update({ reorder_arrival_alert_sent_at: new Date().toISOString() })
      .in('id', arrivingToday.map((ing) => ing.id));
    if (markError) console.error('Error marking reorders as alerted:', markError);

    return res.status(200).json({ processed: arrivingToday.length, usersNotified });
  } catch (error) {
    console.error('Error in send-reorder-arrival-notifications:', error);
    return res.status(500).json({ error: error.message });
  }
};
