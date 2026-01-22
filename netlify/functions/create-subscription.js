const Razorpay = require('razorpay');
const admin = require('firebase-admin');

// --- Initialize Firebase (Standard Secure Setup) ---
if (!admin.apps.length) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY))
    });
  } catch (e) {
    console.error('Firebase Init Error:', e);
  }
}
const db = admin.firestore();

// --- Initialize Razorpay ---
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
});

exports.handler = async function(event) {
    // 1. Only allow POST requests
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

    try {
        const data = JSON.parse(event.body);
        const { planId, email, name, phone, transactionId, affiliateId } = data;

        // ============================================================
        // BRANCH A: ACTIVATE SUBSCRIPTION (User has paid or is Trial)
        // This runs when Rpp1.html calls "createFirestoreSubscriptionRecord"
        // ============================================================
        if (transactionId || planId === 'trial') {
            
            console.log(`[ACTIVATE] Attempting to activate ${planId} for ${email}`);

            // --- SECURITY CHECK: VERIFY PAYMENT WITH RAZORPAY ---
            if (planId !== 'trial') {
                if (!transactionId) {
                    return { statusCode: 400, body: JSON.stringify({ error: 'Missing Transaction ID' }) };
                }

                try {
                    // Logic: If it looks like a sub ID (starts with 'sub_'), check subscription.
                    // Otherwise, check it as a direct payment (order).
                    if (transactionId.startsWith('sub_')) {
                        const sub = await razorpay.subscriptions.fetch(transactionId);
                        if (sub.status !== 'active' && sub.status !== 'authenticated') {
                            throw new Error(`Subscription not active. Status: ${sub.status}`);
                        }
                    } else {
                        const payment = await razorpay.payments.fetch(transactionId);
                        if (payment.status !== 'captured') {
                            throw new Error(`Payment not captured. Status: ${payment.status}`);
                        }
                    }
                } catch (verifyError) {
                    console.error('Payment Verification Failed:', verifyError);
                    return { statusCode: 400, body: JSON.stringify({ error: 'Payment verification failed. Access denied.' }) };
                }
            }

            // --- CALCULATE ACCESS DATES ---
            const now = new Date();
            let endDate = new Date();
            let durationDays = 0;

            switch (planId) {
                case 'trial': durationDays = 14; break;
                case 'monthly': durationDays = 30; break;
                case 'six-months': durationDays = 180; break;
                case 'yearly': durationDays = 365; break;
                default: return { statusCode: 400, body: JSON.stringify({ error: 'Invalid Plan' }) };
            }
            endDate.setDate(now.getDate() + durationDays);

            // --- SAVE TO FIREBASE ---
            // We use the email to find/create the user document or store by email key
            // Ideally, we find the UID, but for now, let's update the subscriptions collection
            
            // NOTE: Ideally you should save under users/{uid}. Since we only have email here,
            // we will assume the App will look up subscription by Email or you have a system for this.
            // For now, ensuring the "subscriptions" collection has this record:
            
            await db.collection('subscriptions').doc(email).set({
                planId,
                userEmail: email,
                userName: name,
                userPhone: phone,
                transactionId: transactionId || 'TRIAL',
                affiliateId: affiliateId || 'direct',
                startDate: admin.firestore.Timestamp.fromDate(now),
                endDate: admin.firestore.Timestamp.fromDate(endDate),
                status: 'active',
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });

            return { statusCode: 200, body: JSON.stringify({ success: true, message: 'Account Activated' }) };
        }

        // ============================================================
        // BRANCH B: CREATE PAYMENT INTENT (User wants to pay)
        // This runs when Rpp1.html calls "initiateRazorpayPayment" (for Monthly)
        // ============================================================
        else {
            console.log(`[PAYMENT] Creating Monthly Sub for ${email}`);
            
            // Create Razorpay Subscription Link/Intent
            const subscription = await razorpay.subscriptions.create({
                plan_id: "plan_R76nWkRQGGkReO", // Ensure this ID is correct from your Razorpay Dashboard
                customer_notify: 1,
                total_count: 12, // 1 year of monthly billing
                notes: { 
                    user_email: email,
                    affiliate_id: affiliateId || "direct"
                }
            });

            return { statusCode: 200, body: JSON.stringify(subscription) };
        }

    } catch (error) {
        console.error('Server Error:', error);
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};
