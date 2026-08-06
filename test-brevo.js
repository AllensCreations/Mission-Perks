require('dotenv').config();

async function testBrevo() {
  const apiKey = process.env.BREVO_API_KEY;
  console.log("Checking Brevo API Key:", apiKey ? "Loaded successfully (" + apiKey.slice(0, 6) + "...)" : "❌ MISSING API KEY");

  try {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': apiKey,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        sender: { name: "Timeless Creations", email: "noreply.timelesscreations.ph@gmail.com" },
        to: [{ email: "noreply.timelesscreations.ph@gmail.com" }], // 🔄 Put your email here to test
        subject: "Brevo API Diagnostic Test",
        htmlContent: "<h3>If you see this, your Brevo API integration is working!</h3>"
      })
    });

    const data = await response.json();
    if (response.ok) {
      console.log("✅ SUCCESS! Email sent via Brevo:", data);
    } else {
      console.error("❌ BREVO API REJECTED THE REQUEST:", data);
    }
  } catch (err) {
    console.error("❌ NETWORK/FETCH ERROR:", err.message);
  }
}

testBrevo();