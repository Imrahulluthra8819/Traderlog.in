// This function securely records successful subscriptions in your Firebase database.
const crypto = require('crypto');
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

// IMPORTANT: Add your FIREBASE_SERVICE_ACCOUNT to your Netlify environment variables
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}
const db = getFirestore();

exports.handler = async (event) => {
  // IMPORTANT: Add your RAZORPAY_WEBHOOK_SECRET to your Netlify environment variables
  const webhookSecret = process.env.Raanav@88198819;
  const razorpaySignature = event.headers['x-razorpay-signature'];

  // 1. Verify the webhook signature for security
  try {
    const generatedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(event.body)
      .digest('hex');

    if (generatedSignature !== razorpaySignature) {
      return { statusCode: 400, body: 'Invalid signature' };
    }
  } catch (error) {
    console.error("Signature verification failed:", error);
    return { statusCode: 500, body: 'Could not verify signature.' };
  }
  
  const body = JSON.parse(event.body);

  // 2. Process the 'subscription.charged' event
  if (body.event === 'subscription.charged') {
    const subscription = body.payload.subscription.entity;
    const payment = body.payload.payment.entity;
    const userEmail = payment.notes.user_email; // Get email from payment notes

    if (payment.status === 'captured' && userEmail) {
      // Find the user in Firestore by their email
      const usersRef = db.collection('users');
      const querySnapshot = await usersRef.where('email', '==', userEmail).limit(1).get();

      if (!querySnapshot.empty) {
        const userDoc = querySnapshot.docs[0];
        
        // 3. Update the user's status to 'active'
        await userDoc.ref.update({
          subscription_status: 'active',
          razorpay_customer_id: payment.customer_id,
          razorpay_subscription_id: subscription.id,
        });
        console.log(`Subscription successfully activated for user: ${userEmail}`);
      } else {
        console.warn(`Webhook received for a user not in the database: ${userEmail}. This might happen if they pay before logging into the tool for the first time.`);
      }
    }
  }
  
  return { statusCode: 200, body: 'OK' };
};

