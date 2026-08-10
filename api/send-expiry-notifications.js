// Triggered daily by Vercel Cron (see vercel.json). Finds ingredients whose
// expiration_date is today or earlier and hasn't been alerted yet, creates
// the matching in-app notification, and pushes to every subscribed device
// via Web Push. Each ingredient is only ever processed once -- see
// expiry_alert_sent_at on the ingredients table.
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

module.exports = async (req, res) => {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const today = new Date().toISOString().split('T')[0];

    const { data: expired, error: fetchError } = await supabase
      .from('ingredients')
      .select('id, name, profile_id')
      .lte('expiration_date', today)
      .is('expiry_alert_sent_at', null);
    if (fetchError) throw fetchError;

    if (!expired || expired.length === 0) {
      return res.status(200).json({ processed: 0, usersNotified: 0 });
    }

    const byUser = new Map();
    for (const ing of expired) {
      if (!byUser.has(ing.profile_id)) byUser.set(ing.profile_id, []);
      byUser.get(ing.profile_id).push(ing);
    }

    let usersNotified = 0;

    for (const [userId, items] of byUser) {
      const { data: settings } = await supabase
        .from('user_settings')
        .select('notifications_enabled, expired_item_notifications')
        .eq('user_id', userId)
        .single();

      const notifyEnabled = settings
        ? settings.notifications_enabled !== false && settings.expired_item_notifications !== false
        : true;

      if (notifyEnabled) {
        const { error: insertError } = await supabase.from('notifications').insert(
          items.map((ing) => ({
            profile_id: userId,
            type: 'ingredient_expired',
            ingredient_id: ing.id,
            message: `${ing.name} has expired`,
            is_read: false
          }))
        );
        if (insertError) console.error('Error inserting expiry notifications:', insertError);

        const { data: subscriptions } = await supabase
          .from('push_subscriptions')
          .select('id, endpoint, p256dh, auth_key')
          .eq('user_id', userId);

        if (subscriptions && subscriptions.length) {
          const title = items.length === 1 ? '1 item expired' : `${items.length} items expired`;
          const body = items.map((i) => i.name).slice(0, 5).join(', ') + (items.length > 5 ? ', …' : '');
          const payload = JSON.stringify({ title, body, url: '/ingredients' });

          for (const sub of subscriptions) {
            try {
              await webPush.sendNotification(
                { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
                payload
              );
            } catch (pushError) {
              if (pushError.statusCode === 404 || pushError.statusCode === 410) {
                await supabase.from('push_subscriptions').delete().eq('id', sub.id);
              } else {
                console.error('Error sending push notification:', pushError);
              }
            }
          }
        }

        usersNotified++;
      }
    }

    const { error: markError } = await supabase
      .from('ingredients')
      .update({ expiry_alert_sent_at: new Date().toISOString() })
      .in('id', expired.map((ing) => ing.id));
    if (markError) console.error('Error marking ingredients as alerted:', markError);

    return res.status(200).json({ processed: expired.length, usersNotified });
  } catch (error) {
    console.error('Error in send-expiry-notifications:', error);
    return res.status(500).json({ error: error.message });
  }
};
