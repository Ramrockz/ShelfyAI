// Web Push subscribe/unsubscribe flow for the Settings page. The actual
// sending happens server-side (api/send-expiry-notifications.js, run daily
// by Vercel Cron); this file only handles getting the browser's permission
// and storing the resulting subscription in Supabase.

// Public key is safe to ship client-side, same trust model as auth.js's
// Supabase anon key -- it only lets a browser identify which server can
// push to it, it can't be used to send anything itself.
const VAPID_PUBLIC_KEY = 'BDcLMQ9fct5GtD0z-HUxjdjl40M2r-LjjO0Qhjgiugc4L2M-Yf90PpiYdC6xX7CrIwjbpk4BY4bPvIKj3dDVMrU';

function isPushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

function isIOSNotStandalone() {
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
  return isIOS && !isStandalone;
}

function _urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

async function getCurrentPushSubscription() {
  if (!isPushSupported()) return null;
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

async function enablePushNotifications() {
  if (!isPushSupported()) {
    showAlert('Push notifications aren\'t supported in this browser.');
    return false;
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return false;

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: _urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
    });
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return false;

    const json = subscription.toJSON();
    const { error } = await supabaseClient.from('push_subscriptions').upsert({
      user_id: user.id,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth_key: json.keys.auth
    }, { onConflict: 'user_id,endpoint' });
    if (error) throw error;
    return true;
  } catch (e) {
    console.error('Error enabling push notifications:', e);
    showAlert('Failed to enable push notifications: ' + e.message);
    return false;
  }
}

async function disablePushNotifications() {
  try {
    const subscription = await getCurrentPushSubscription();
    if (subscription) {
      const endpoint = subscription.endpoint;
      await subscription.unsubscribe();
      const { data: { user } } = await supabaseClient.auth.getUser();
      if (user) {
        await supabaseClient.from('push_subscriptions').delete().eq('user_id', user.id).eq('endpoint', endpoint);
      }
    }
    return true;
  } catch (e) {
    console.error('Error disabling push notifications:', e);
    return false;
  }
}
