const Razorpay = require('razorpay');
const admin = require('firebase-admin');

// --- Initialize Services ---
// This is kept for consistency, though this function no longer directly uses it.
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
    console.log("Function is attempting to use Key ID starting with:", process.env.RAZORPAY_KEY_ID ? process.env.RAZORPAY_KEY_ID.substring(0, 12) : "UNDEFINED");

    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

    try {
        const data = JSON.parse(event.body);
        const userEmail = data.email.toLowerCase();

        console.log("Received data for subscription creation:", data);

        const subscription = await razorpay.subscriptions.create({
            plan_id: "plan_R76nWkRQGGkReO", // Your Monthly Plan ID
            customer_notify: 1,
            total_count: 12,
            notes: { 
                // This data is passed to Razorpay and back to the frontend handler.
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
