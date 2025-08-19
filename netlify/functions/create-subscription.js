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
        // Correctly parse the incoming data from the form
        const data = JSON.parse(event.body);
        const userEmail = data.email.toLowerCase();

        console.log("Received data for subscription:", data); // Log to confirm data is received

        const usersRef = db.collection('free_trial_users');
        const snapshot = await usersRef.where('email', '==', userEmail).limit(1).get();
        
        let firebaseUid = '';
        if (!snapshot.empty) {
            firebaseUid = snapshot.docs[0].id;
        }

        const subscription = await razorpay.subscriptions.create({
            plan_id: "plan_R76nWkRQGGkReO", // Your Monthly Plan ID
            customer_notify: 1,
            total_count: 12,
            notes: { 
                // Pass all captured details to Razorpay notes
                firebase_uid: firebaseUid,
                user_email: userEmail,
                user_name: data.name,
                user_phone: data.phone,
                plan_id: data.plan_id,
                affiliate_id: data.affiliate_id || "direct"
            }
        });

        return { statusCode: 200, body: JSON.stringify(subscription) };

    } catch (error) {
        console.error('Create Subscription Error:', error);
        return { statusCode: 500, body: JSON.stringify({ error: 'Could not create subscription.' }) };
    }
};


