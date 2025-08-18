const crypto = require('crypto');
const admin = require('firebase-admin');

// --- Initialize Firebase Admin ---
try {
  if (!admin.apps.length) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  }
} catch (e) { console.error('Firebase Admin Init Error:', e); }
const db = admin.firestore();
// ---------------------------------

exports.handler = async function(event) {
  const signature = event.headers['x-razorpay-signature'];
  const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;

  try {
    crypto.createHmac('sha256', WEBHOOK_SECRET).update(event.body).digest('hex');
  } catch(error) {
    return { statusCode: 400, body: 'Invalid signature' };
  }

  const data = JSON.parse(event.body);
  const eventType = data.event;
  const subEntity = data.payload.subscription.entity;
  const firebaseUid = subEntity.notes.firebase_uid;

  if (!firebaseUid) return { statusCode: 400, body: 'Firebase UID missing.' };

  let newStatus = 'inactive';
  if (eventType === 'subscription.activated' || eventType === 'subscription.charged' || eventType === 'subscription.completed') {
      newStatus = 'active';
  } else if (eventType === 'subscription.cancelled') {
      newStatus = 'cancelled';
  }

  try {
      await db.collection('free_trial_users').doc(firebaseUid).update({
          subscription_id: subEntity.id,
          subscription_status: newStatus,
      });
      console.log(`Status updated to ${newStatus} for UID: ${firebaseUid}`);
      return { statusCode: 200, body: 'Webhook processed.' };
  } catch (dbError) {
      console.error('Firestore update failed:', dbError);
      return { statusCode: 500, body: 'Database update failed.' };
  }
};
