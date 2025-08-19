const Razorpay = require('razorpay');
const admin = require('firebase-admin');

// --- Initialize Firebase Admin SDK ---
if (!admin.apps.length) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY))
    });
  } catch (e) {
    console.error('Firebase Admin Init Error:', e);
  }
}
// ------------------------------------

const db = admin.firestore();

const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
});

exports.handler = async function(event) {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

    try {
        const data = JSON.parse(event.body);
        const userEmail = data.email.toLowerCase();

        console.log("Received data for order:", data);
        
        let firebaseUid = '';
        try {
            const usersRef = db.collection('free_trial_users');
            const snapshot = await usersRef.where('email', '==', userEmail).limit(1).get();
            if (!snapshot.empty) {
                firebaseUid = snapshot.docs[0].id;
            }
        } catch (dbError) {
            console.error('Firestore lookup failed, but proceeding with payment. Error:', dbError);
        }

        const options = {
            amount: data.amount, 
            currency: "INR",
            // =================================================================
            // FINAL FIX: Created a shorter receipt ID to meet Razorpay's
            // 40-character limit.
            // =================================================================
            receipt: `order_${Date.now()}`,
            notes: {
                firebase_uid: firebaseUid || "N/A",
                user_email: userEmail,
                user_name: data.name,
                user_phone: data.phone,
                plan_id: data.plan_id,
                affiliate_id: data.affiliate_id || "direct"
            }
        };

        const order = await razorpay.orders.create(options);
        return { statusCode: 200, body: JSON.stringify(order) };

    } catch (error) {
        console.error('Create Order Error:', error.error || error); // Log the detailed error from Razorpay
        return { statusCode: 500, body: JSON.stringify({ error: 'Could not create order.' }) };
    }
};
