const admin = require('firebase-admin');
const Razorpay = require('razorpay');

// --- Initialize Services (Requires Netlify Environment Variables) ---
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
// --------------------------------------------------------------------

exports.handler = async function(event) {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

    try {
        const { name, email, phone, password, isTrial } = JSON.parse(event.body);
        const userEmail = email.toLowerCase();

        const usersRef = db.collection('free_trial_users');
        const snapshot = await usersRef.where('email', '==', userEmail).limit(1).get();

        if (snapshot.empty && isTrial) {
            // --- NEW USER REQUESTING A TRIAL ---
            const userRecord = await admin.auth().createUser({ email: userEmail, password: password, displayName: name });
            const trialEndDate = new Date();
            trialEndDate.setDate(trialEndDate.getDate() + 14);

            await db.collection('free_trial_users').doc(userRecord.uid).set({
                email: userEmail,
                status: 'trialing',
                trial_end_date: admin.firestore.Timestamp.fromDate(trialEndDate),
                subscription_id: null,
                subscription_status: 'inactive'
            });
            return { statusCode: 200, body: JSON.stringify({ status: 'trial_started' }) };
        }

        // --- EXISTING USER OR DIRECT-TO-PAYMENT ---
        const userDoc = snapshot.empty ? null : snapshot.docs[0];

        const subscription = await razorpay.subscriptions.create({
            plan_id: "plan_R0lfqw7y18smql", // Your Monthly Plan ID from Razorpay
            customer_notify: 1,
            total_count: 12,
            notes: { 
                firebase_uid: userDoc ? userDoc.id : '', // Pass UID if user exists
                user_email: userEmail, 
                user_name: name, 
                user_phone: phone 
            }
        });

        return { statusCode: 200, body: JSON.stringify({ status: 'payment_initiated', subscription: subscription }) };

    } catch (error) {
        console.error('Handler Error:', error);
        return { statusCode: 500, body: JSON.stringify({ error: error.message || 'Could not process request.' }) };
    }
};
