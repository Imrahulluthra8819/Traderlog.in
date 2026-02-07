const Razorpay = require('razorpay');
const admin = require('firebase-admin');

// --- CORS HEADERS ---
const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

// --- HELPER: NORMALIZE PHONE NUMBERS ---
// Turns "+91-98765 43210" into "9876543210"
function sanitizePhone(phone) {
    if (!phone) return '';
    // Remove all non-numeric characters
    let cleaned = String(phone).replace(/\D/g, '');
    // If it has country code (like 91 at start) and is longer than 10 digits, take last 10
    if (cleaned.length > 10) {
        cleaned = cleaned.slice(-10);
    }
    return cleaned;
}

// --- UNIVERSAL FIREBASE INIT ---
if (!admin.apps.length) {
    try {
        if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
            admin.initializeApp({
                credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY))
            });
        } else if (process.env.FIREBASE_PRIVATE_KEY) {
            admin.initializeApp({
                credential: admin.credential.cert({
                    projectId: process.env.FIREBASE_PROJECT_ID,
                    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
                }),
            });
        }
    } catch (e) {
        console.error('Firebase Init Error:', e);
    }
}
const db = admin.firestore();

const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
});

exports.handler = async function(event) {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
    if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Method Not Allowed' };

    try {
        const data = JSON.parse(event.body);
        const { planId, email, name, transactionId, affiliateId, deviceId } = data;
        
        // CLEAN THE PHONE NUMBER BEFORE USING IT
        const rawPhone = data.phone || '';
        const cleanPhone = sanitizePhone(rawPhone);

        console.log(`[REQ] ${email} | Plan: ${planId} | Phone: ${cleanPhone} | Device: ${deviceId}`);

        // ============================================================
        // BRANCH A: ACTIVATE SUBSCRIPTION
        // ============================================================
        // UPDATED: Added check for 'trial_30'
        if (transactionId || planId === 'trial' || planId === 'trial_30') {

            // --- 1. ABUSE PROTECTION SYSTEM ---
            // UPDATED: Apply protection to BOTH trial types
            if (planId === 'trial' || planId === 'trial_30') {
                
                // CHECK A: EMAIL
                const emailCheck = await db.collection('subscriptions').doc(email).get();
                if (emailCheck.exists) {
                    return { statusCode: 403, headers, body: JSON.stringify({ error: 'This email has already used a Free Trial.' }) };
                }

                // CHECK B: PHONE (NORMALIZED)
                // We check if this clean number exists in ANY user document
                if (cleanPhone.length >= 10) {
                    const phoneCheck = await db.collection('subscriptions')
                        .where('cleanPhone', '==', cleanPhone) // Check against the clean version
                        .limit(1)
                        .get();

                    if (!phoneCheck.empty) {
                        console.warn(`[BLOCK] Phone match found for ${cleanPhone}`);
                        return { statusCode: 403, headers, body: JSON.stringify({ error: 'This phone number has already used a Free Trial.' }) };
                    }
                }

                // CHECK C: DEVICE ID
                if (deviceId) {
                    const deviceCheck = await db.collection('subscriptions')
                        .where('deviceId', '==', deviceId)
                        .limit(1)
                        .get();

                    if (!deviceCheck.empty) {
                        console.warn(`[BLOCK] Device match found for ${deviceId}`);
                        return { statusCode: 403, headers, body: JSON.stringify({ error: 'Free Trial already claimed on this device.' }) };
                    }
                }
            }

            // --- 2. PAYMENT VERIFICATION ---
            // UPDATED: Skip payment check for 'trial_30' as well
            if (planId !== 'trial' && planId !== 'trial_30') {
                if (!transactionId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing Transaction ID' }) };
                try {
                    if (transactionId.startsWith('sub_')) {
                        const sub = await razorpay.subscriptions.fetch(transactionId);
                        if (sub.status !== 'active' && sub.status !== 'authenticated') throw new Error('Sub Status: ' + sub.status);
                    } else {
                        const payment = await razorpay.payments.fetch(transactionId);
                        if (payment.status !== 'captured') throw new Error('Pay Status: ' + payment.status);
                    }
                } catch (verifyError) {
                    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Payment verification failed.' }) };
                }
            }

            // --- 3. SAVE TO DB ---
            const now = new Date();
            let endDate = new Date();
            
            // UPDATED: Duration logic for 30 day trial
            let durationDays;
            if (planId === 'trial') {
                durationDays = 14;
            } else if (planId === 'trial_30') {
                durationDays = 30; // <--- This handles the new 30-day offer
            } else if (planId === 'monthly') {
                durationDays = 30;
            } else if (planId === 'six-months') {
                durationDays = 180;
            } else {
                durationDays = 365; // Yearly
            }
            
            endDate.setDate(now.getDate() + durationDays);

            await db.collection('subscriptions').doc(email).set({
                planId,
                userEmail: email,
                userName: name,
                userPhone: rawPhone,      // Save original for display
                cleanPhone: cleanPhone,   // Save CLEAN version for checking
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
        // BRANCH B: PAYMENT INTENT
        // ============================================================
        else {
            const subscription = await razorpay.subscriptions.create({
                plan_id: "plan_SDGnlG3fwzmHos",
                total_count: 12,
                notes: { user_email: email, affiliate_id: affiliateId || "direct" }
            });
            return { statusCode: 200, headers, body: JSON.stringify(subscription) };
        }

    } catch (error) {
        console.error('Server Error:', error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
};
