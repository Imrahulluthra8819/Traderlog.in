const Razorpay = require('razorpay');
const admin = require('firebase-admin');

// --- CORS HEADERS (Crucial for connecting Traderlog.in to Journal.traderlog.in) ---
const headers = {
    'Access-Control-Allow-Origin': '*', // Allows connections from your landing page
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

// --- UNIVERSAL FIREBASE INIT (Works with ANY Env Var setup) ---
if (!admin.apps.length) {
    try {
        // Method 1: Single JSON String (Best Practice)
        if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
            admin.initializeApp({
                credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY))
            });
        } 
        // Method 2: Individual Variables (Your likely setup)
        else if (process.env.FIREBASE_PRIVATE_KEY) {
            admin.initializeApp({
                credential: admin.credential.cert({
                    projectId: process.env.FIREBASE_PROJECT_ID,
                    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                    // Fix newlines which often break in Netlify
                    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
                }),
            });
        } else {
            throw new Error('No Firebase configuration found in Environment Variables.');
        }
    } catch (e) {
        console.error('Firebase Init Error:', e);
        // We catch this later to return a proper error to frontend
    }
}
const db = admin.firestore();

// --- Initialize Razorpay ---
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
});

exports.handler = async function(event) {
    // 1. Handle Preflight (OPTIONS) Request for CORS
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    // 2. Only allow POST
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers, body: 'Method Not Allowed' };
    }

    try {
        const data = JSON.parse(event.body);
        const { planId, email, name, phone, transactionId, affiliateId, deviceId } = data;

        // ============================================================
        // BRANCH A: ACTIVATE SUBSCRIPTION (User has paid or is Trial)
        // ============================================================
        if (transactionId || planId === 'trial') {
            
            console.log(`[ACTIVATE] Processing ${planId} for ${email}`);

            // --- 1. TRIAL ABUSE CHECK (EMAIL, PHONE & DEVICE) ---
            if (planId === 'trial') {
                // Check A: EMAIL
                const emailCheck = await db.collection('subscriptions').doc(email).get();
                if (emailCheck.exists) {
                    return { statusCode: 403, headers, body: JSON.stringify({ error: 'This email has already used a Free Trial.' }) };
                }

                // Check B: PHONE (Robust Check)
                // Note: If you get "Missing Index" error in logs, comment this out temporarily
                const phoneCheck = await db.collection('subscriptions').where('userPhone', '==', phone).limit(1).get();
                if (!phoneCheck.empty) {
                    return { statusCode: 403, headers, body: JSON.stringify({ error: 'This phone number has already used a Free Trial.' }) };
                }

                // Check C: DEVICE ID
                if (deviceId) {
                    const deviceCheck = await db.collection('subscriptions').where('deviceId', '==', deviceId).limit(1).get();
                    if (!deviceCheck.empty) {
                        return { statusCode: 403, headers, body: JSON.stringify({ error: 'Free Trial already claimed on this device.' }) };
                    }
                }
            }

            // --- 2. PAYMENT VERIFICATION (For Paid Plans) ---
            if (planId !== 'trial') {
                if (!transactionId) {
                    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing Transaction ID' }) };
                }
                try {
                    if (transactionId.startsWith('sub_')) {
                        const sub = await razorpay.subscriptions.fetch(transactionId);
                        if (sub.status !== 'active' && sub.status !== 'authenticated') throw new Error('Subscription status: ' + sub.status);
                    } else {
                        const payment = await razorpay.payments.fetch(transactionId);
                        if (payment.status !== 'captured') throw new Error('Payment status: ' + payment.status);
                    }
                } catch (verifyError) {
                    console.error('Payment Verify Error:', verifyError.message);
                    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Payment verification failed: ' + verifyError.message }) };
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
                deviceId: deviceId || 'unknown',
                transactionId: transactionId || 'TRIAL',
                affiliateId: affiliateId || 'direct',
                startDate: admin.firestore.Timestamp.fromDate(now),
                endDate: admin.firestore.Timestamp.fromDate(endDate),
                status: 'active',
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });

            return { statusCode: 200, headers, body: JSON.stringify({ success: true, message: 'Account Activated' }) };
        }

        // ============================================================
        // BRANCH B: CREATE PAYMENT INTENT (For Razorpay Popup)
        // ============================================================
        else {
            const subscription = await razorpay.subscriptions.create({
                plan_id: "plan_R76nWkRQGGkReO", // Ensure this ID matches your Dashboard
                total_count: 12,
                notes: { user_email: email, affiliate_id: affiliateId || "direct" }
            });
            return { statusCode: 200, headers, body: JSON.stringify(subscription) };
        }

    } catch (error) {
        console.error('Server Error:', error);
        // Return 500 with headers so the frontend sees the error message
        return { statusCode: 500, headers, body: JSON.stringify({ error: error.message || "Internal Server Error" }) };
    }
};
