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
            // VITAL: Ensure this is your correct, LIVE Plan ID from Razorpay
            plan_id: "plan_R6n1t5ne734knZ", 
            customer_notify: 1,
            total_count: 12,
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
        // --- ENHANCED ERROR LOGGING ---
        // This will give us the exact reason for the failure.
        console.error('RAZORPAY SUBSCRIPTION CREATE FAILED:', error);
        
        // Send a more specific error message back to the frontend if possible
        const errorMessage = error.error ? error.error.description : 'Could not create subscription. Please check the function logs on Netlify.';
        
        return { statusCode: 500, body: JSON.stringify({ error: errorMessage }) };
    }
};
