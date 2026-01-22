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
        const { planId, email, name, phone, transactionId, affiliateId } = data;

        // ============================================================
        // BRANCH A: ACTIVATE SUBSCRIPTION (User has paid or is Trial)
        // ============================================================
        if (transactionId || planId === 'trial') {
            
            console.log(`[ACTIVATE] Processing ${planId} for ${email}`);

            // --- 1. TRIAL ABUSE CHECK (EMAIL & PHONE) ---
            if (planId === 'trial') {
                // Check A: Is this EMAIL already used?
                const emailCheck = await db.collection('subscriptions').doc(email).get();
                if (emailCheck.exists) {
                    return { 
                        statusCode: 403, 
                        body: JSON.stringify({ error: 'This email has already used a Free Trial.' }) 
                    };
                }

                // Check B: Is this PHONE NUMBER already used?
                // We query the database to see if any document has this phone number
                const phoneCheck = await db.collection('subscriptions')
                    .where('userPhone', '==', phone)
                    .get();

                if (!phoneCheck.empty) {
                    return { 
                        statusCode: 403, 
                        body: JSON.stringify({ error: 'This phone number has already used a Free Trial.' }) 
                    };
                }
            }

            // --- 2. PAYMENT VERIFICATION (For Paid Plans) ---
            if (planId !== 'trial') {
                if (!transactionId) {
                    return { statusCode: 400, body: JSON.stringify({ error: 'Missing Transaction ID' }) };
                }
                try {
                    if (transactionId.startsWith('sub_')) {
                        const sub = await razorpay.subscriptions.fetch(transactionId);
                        if (sub.status !== 'active' && sub.status !== 'authenticated') throw new Error('Subscription inactive');
                    } else {
                        const payment = await razorpay.payments.fetch(transactionId);
                        if (payment.status !== 'captured') throw new Error('Payment not captured');
                    }
                } catch (verifyError) {
                    console.error('Payment Verification Failed:', verifyError.message);
                    return { statusCode: 400, body: JSON.stringify({ error: 'Payment verification failed.' }) };
                }
            }

            // --- CALCULATE DATES ---
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

            // --- SAVE TO DATABASE ---
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
        // BRANCH B: CREATE PAYMENT INTENT
        // ============================================================
        else {
            const subscription = await razorpay.subscriptions.create({
                plan_id: "plan_R76nWkRQGGkReO",
                customer_notify: 1,
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
