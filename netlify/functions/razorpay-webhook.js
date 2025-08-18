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
    let updateData = {};
    let firebaseUid, userEmail, userName, userPhone, planId;
    let isSuccess = false;

    if (eventType.startsWith('subscription.')) {
        const sub = data.payload.subscription.entity;
        firebaseUid = sub.notes.firebase_uid;
        updateData.subscription_id = sub.id;
        updateData.subscription_status = sub.status === 'active' ? 'active' : 'inactive';
        if (sub.status === 'active') isSuccess = true;
        planId = 'monthly'; // Assume subscription events are for monthly plans

    } else if (eventType === 'order.paid') {
        const payment = data.payload.payment.entity;
        const notes = payment.notes;
        firebaseUid = notes.firebase_uid;
        userEmail = notes.user_email;
        userName = notes.user_name;
        userPhone = notes.user_phone;
        planId = notes.plan_id;
        isSuccess = true;
    }

    if (!isSuccess) {
        return { statusCode: 200, body: 'Event received but not a success action.' };
    }

    try {
        let userDocRef;
        if (firebaseUid) {
            userDocRef = db.collection('free_trial_users').doc(firebaseUid);
        } else {
            // New user who paid directly. Find or create them.
            const snapshot = await db.collection('free_trial_users').where('email', '==', userEmail).limit(1).get();
            if (!snapshot.empty) {
                userDocRef = snapshot.docs[0].ref;
            } else {
                const userRecord = await admin.auth().createUser({ email: userEmail, displayName: userName });
                userDocRef = db.collection('free_trial_users').doc(userRecord.uid);
                await userDocRef.set({ email: userEmail, name: userName, phone: userPhone, trial_end_date: null });
            }
        }

        let subEndDate = new Date();
        if (planId === 'six-months') subEndDate.setMonth(subEndDate.getMonth() + 6);
        else if (planId === 'yearly') subEndDate.setFullYear(subEndDate.getFullYear() + 1);
        else subEndDate.setFullYear(subEndDate.getFullYear() + 1); // Monthly subscription lasts a year

        updateData.status = 'active';
        updateData.subscription_end_date = admin.firestore.Timestamp.fromDate(subEndDate);

        await userDocRef.update(updateData);
        return { statusCode: 200, body: 'Webhook processed.' };

    } catch (error) {
        console.error('Webhook Firestore Error:', error);
        return { statusCode: 500, body: 'Internal Server Error.' };
    }
};
