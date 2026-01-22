const Razorpay = require('razorpay');
const admin = require('firebase-admin');

// --- Initialize Firebase ---
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
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

    try {
        const data = JSON.parse(event.body);
        const { planId, email, name, phone, transactionId, affiliateId, deviceId } = data;

        // ============================================================
        // BRANCH A: ACTIVATE SUBSCRIPTION
        // ============================================================
        if (transactionId || planId === 'trial') {
            
            console.log(`[ACTIVATE] Processing ${planId} for ${email}`);

            // --- 1. ABUSE PROTECTION SYSTEM ---
            if (planId === 'trial') {
                
                // CHECK A: EMAIL (Has this email used a trial?)
                const emailCheck = await db.collection('subscriptions').doc(email).get();
                if (emailCheck.exists) {
                    return { statusCode: 403, body: JSON.stringify({ error: 'This email has already used a Free Trial.' }) };
                }

                // CHECK B: PHONE (Has this phone number used a trial?)
                const phoneCheck = await db.collection('subscriptions').where('userPhone', '==', phone).limit(1).get();
                if (!phoneCheck.empty) {
                    return { statusCode: 403, body: JSON.stringify({ error: 'This phone number has already used a Free Trial.' }) };
                }

                // CHECK C: DEVICE ID (Has this specific browser used a trial?)
                // This stops them even if they change Email & Phone!
                if (deviceId) {
                    const deviceCheck = await db.collection('subscriptions').where('deviceId', '==', deviceId).limit(1).get();
                    if (!deviceCheck.empty) {
                        return { statusCode: 403, body: JSON.stringify({ error: 'Free Trial already claimed on this device.' }) };
                    }
                }
            }

            // --- 2. PAYMENT VERIFICATION ---
            if (planId !== 'trial') {
                if (!transactionId) return { statusCode: 400, body: JSON.stringify({ error: 'Missing Transaction ID' }) };
                
                try {
                    if (transactionId.startsWith('sub_')) {
                        const sub = await razorpay.subscriptions.fetch(transactionId);
                        if (sub.status !== 'active' && sub.status !== 'authenticated') throw new Error('Subscription inactive');
                    } else {
                        const payment = await razorpay.payments.fetch(transactionId);
                        if (payment.status !== 'captured') throw new Error('Payment not captured');
                    }
                } catch (verifyError) {
                    console.error('Payment Verify Error:', verifyError.message);
                    return { statusCode: 400, body: JSON.stringify({ error: 'Payment verification failed.' }) };
                }
            }

            // --- 3. SAVE TO DB ---
            const now = new Date();
            let endDate = new Date();
            let durationDays = (planId === 'trial') ? 14 : (planId === 'monthly' ? 30 : (planId === 'six-months' ? 180 : 365));
            endDate.setDate(now.getDate() + durationDays);

            await db.collection('subscriptions').doc(email).set({
                planId,
                userEmail: email,
                userName: name,
                userPhone: phone,
                deviceId: deviceId || 'unknown', // Save device ID for future blocks
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
        // BRANCH B: PAYMENT INTENT
        // ============================================================
        else {
            const subscription = await razorpay.subscriptions.create({
                plan_id: "plan_R76nWkRQGGkReO",
                total_count: 12,
                notes: { user_email: email, affiliate_id: affiliateId || "direct" }
            });
            return { statusCode: 200, body: JSON.stringify(subscription) };
        }

    } catch (error) {
        console.error('Server Error:', error.message);
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};
