// api/escrow/checkout.js
export default async function handler(req, res) {
    // Simple health check for GET requests (helps confirm deployment)
    if (req.method === 'GET') {
      return res.status(405).json({ error: 'Method not allowed' });
    }
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }
  
    // --- CORS (TEMP: permissive for testing; we'll lock down later) ---
    const origin = req.headers.origin || '';
    const allowed = /^(https:\/\/(www\.)?domaingrid\.com|https:\/\/domaingrid-f181b9\.webflow\.io)$/i;
    if (!allowed.test(origin)) {
      return res.status(403).json({ error: 'Forbidden (Origin not allowed)' });
    }
  
    // --- Validate input from Webflow/button ---
    const { title, price, currency = 'usd', reference = '' } = req.body || {};
    if (!title || !Number.isFinite(price)) {
      return res.status(400).json({ error: 'Bad payload' });
    }
  
    // --- Escrow auth from Vercel env vars ---
    const ESCROW_EMAIL = process.env.ESCROW_EMAIL;
    const ESCROW_API_KEY = process.env.ESCROW_API_KEY;
    if (!ESCROW_EMAIL || !ESCROW_API_KEY) {
      return res.status(500).json({ error: 'Server not configured: missing Escrow credentials' });
    }
    const AUTH = Buffer.from(`${ESCROW_EMAIL}:${ESCROW_API_KEY}`).toString('base64');
  
    const buyerEmail = 'test-buyer@domaingrid.com'; // sandbox test email

    // --- Build Escrow Pay payload (SANDBOX) ---
    const payload = {
      currency,
      description: `Sale of ${title}`,
      reference,
      return_url: 'https://domaingrid.com/thank-you',
      redirect_type: 'automatic',
      items: [{
        title,
        type: 'domain_name',           // change if needed
        inspection_period: 259200,     // 3 days (seconds)
        quantity: 1,
        schedule: [{
          amount: price,
          payer_customer: 'buyer',
          beneficiary_customer: 'me'
        }],
        fees: [{ type: 'escrow', split: 1, payer_customer: 'buyer' }]
      }],
      parties: [
        { role: 'buyer',  customer: buyerEmail, agreed: true },
        { role: 'seller', customer: 'me',       agreed: true }
      ]
    };
  
    try {
        const resp = await fetch('https://api.escrow-sandbox.com/integration/pay/2018-03-31', {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${AUTH}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify(payload)
        });
    
        const text = await resp.text();                 // read raw body once
        if (!resp.ok) {
          console.error('Escrow Pay error', resp.status, text);
          return res.status(502).json({
            error: 'Escrow Pay failed',
            status: resp.status,
            detail: text
          });
        }
    
        // If ok, parse the json we already read
        let data;
        try { data = JSON.parse(text); }
        catch { 
          console.error('Escrow Pay: non-JSON success body', text);
          return res.status(502).json({ error: 'Unexpected response from Escrow', detail: text });
        }
    
        return res.status(200).json({ url: data.landing_page });
      } catch (e) {
        console.error('Server exception', e);
        return res.status(500).json({ error: 'Server error' });
      }    
  }
  
