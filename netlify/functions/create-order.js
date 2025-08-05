const Razorpay = require('razorpay');

exports.handler = async (event) => {
  try {
    const requestData = JSON.parse(event.body);
    const { name, email, phone, amount, description, affiliate_id } = requestData;
    
    const razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_SECRET
    });

    const options = {
      amount: amount * 100, // Convert to paise
      currency: "INR",
      receipt: `order_rcpt_${Date.now()}`,
      notes: {
        user_name: name,
        user_email: email,
        user_phone: phone,
        affiliate_id: affiliate_id || 'direct',
        description: description,
        created_via: "TraderLog Web"
      }
    };

    const order = await razorpay.orders.create(options);

    return {
      statusCode: 200,
      body: JSON.stringify({
        id: order.id,
        amount: order.amount,
        currency: order.currency
      })
    };
  } catch (error) {
    let errorMessage = "Order creation failed";
    if (error.error?.description) errorMessage = error.error.description;
    else if (error.message) errorMessage = error.message;
    
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: errorMessage,
        details: error.error || "Please check your input"
      })
    };
  }
};