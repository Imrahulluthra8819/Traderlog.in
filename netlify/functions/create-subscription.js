const Razorpay = require('razorpay');
const admin = require('firebase-admin');

// --- Initialize Services ---
try {
  if (!admin.apps.length) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  }
} catch (e) { console.error('Firebase Admin Init Error:', e); }
const db = admin.firestore();

const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
});
// --------------------------

exports.handler = async function(event) {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

    try {
        const { name, email, phone } = JSON.parse(event.body);
        const userEmail = email.toLowerCase();

        const usersRef = db.collection('free_trial_users');
        const snapshot = await usersRef.where('email', '==', userEmail).limit(1).get();
        
        let firebaseUid = '';
        if (!snapshot.empty) {
            firebaseUid = snapshot.docs[0].id;
        }

        const subscription = await razorpay.subscriptions.create({
            // VITAL STEP: Replace this with your actual Plan ID from Razorpay
            plan_id: "plan_R6n1t5ne734knZ", 
            customer_notify: 1,
            total_count: 12, // This means the subscription will run for 12 cycles (1 year)
            notes: { 
                firebase_uid: firebaseUid,
                user_email: userEmail,
                user_name: name,
                user_phone: phone,
                plan_id: 'monthly'
            }
        });

        return { statusCode: 200, body: JSON.stringify(subscription) };

    } catch (error) {
        // This is the error you are seeing. It's happening because the plan_id is wrong.
        console.error('Create Subscription Error:', error);
        return { statusCode: 500, body: JSON.stringify({ error: 'Could not create subscription.' }) };
    }
};
