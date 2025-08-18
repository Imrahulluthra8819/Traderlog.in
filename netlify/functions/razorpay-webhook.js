const crypto = require('crypto');
const admin = require('firebase-admin');

try {
  if (!admin.apps.length) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  }
} catch (e) { console.error('Firebase Admin Init Error:', e); }
const db = admin.firestore();

exports.handler = async function(event) {
  const signature = event.headers['x-razorpay-signature'];
  const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;

  try {
    crypto.createHmac('sha256', WEBHOOK_SECRET).update(event.body).digest('hex');
  } catch(error) { return { statusCode: 400, body: 'Invalid signature' }; }

  const data = JSON.parse(event.body);
  const eventType = data.event;
  const subEntity = data.payload.subscription.entity;
  const notes = subEntity.notes;
  let firebaseUid = notes.firebase_uid;

  let newStatus = 'inactive';
  if (eventType.includes('activated') || eventType.includes('charged')) {
      newStatus = 'active';
  } else if (eventType.includes('cancelled') || eventType.includes('halted')) {
      newStatus = 'cancelled';
  }

  try {
    if (!firebaseUid) {
        // This is a new user who paid directly. Create them now.
        const userRecord = await admin.auth().createUser({ email: notes.user_email, displayName: notes.user_name });
        firebaseUid = userRecord.uid;
        await db.collection('free_trial_users').doc(firebaseUid).set({
            email: notes.user_email,
            status: 'active',
            trial_end_date: null, // No trial
            subscription_id: subEntity.id,
            subscription_status: newStatus
        });
    } else {
        // This is an existing user. Update their status.
        await db.collection('free_trial_users').doc(firebaseUid).update({
            subscription_id: subEntity.id,
            subscription_status: newStatus,
            status: 'active'
        });
    }
    return { statusCode: 200, body: 'Webhook processed.' };
  } catch (dbError) {
      console.error('Firestore update failed:', dbError);
      return { statusCode: 500, body: 'Database update failed.' };
  }
};
