// api/escrow/checkout.js
export default async function handler(req, res) {
        // --- CORS setup for DomainGrid ---
    const origin = req.headers.origin || '';
    const allowedOrigin = /^(https:\/\/(www\.)?domaingrid\.com)$/i.test(origin);

    function setCors(res) {
        if (allowedOrigin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.setHeader('Access-Control-Max-Age', '86400'); // cache preflight 24h
        }
    }

    // Handle browser preflight
    if (req.method === 'OPTIONS') {
        setCors(res);
        return res.status(204).end();
    }

    // Enforce origin after preflight
    if (!allowedOrigin) {
        setCors(res);
        return res.status(403).json({ error: 'Forbidden (origin not allowed)' });
    }

    // --- Validate input from Webflow/button ---
    const {
        title,
        price,
        currency = 'usd',
        reference = '',
        buyerEmail: buyerEmailRaw
      } = req.body || {};
      
      const buyerEmail = (buyerEmailRaw && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(buyerEmailRaw))
        ? buyerEmailRaw
        : null;
      
    if (!title || !Number.isFinite(price)) {
        setCors(res);
        return res.status(400).json({ error: 'Bad payload' });
    }
  
    // --- Escrow auth from Vercel env vars ---
    const ESCROW_EMAIL = process.env.ESCROW_EMAIL;
    const ESCROW_API_KEY = process.env.ESCROW_API_KEY;
    if (!ESCROW_EMAIL || !ESCROW_API_KEY) {
        setCors(res);
        return res.status(500).json({ error: 'Server not configured: missing Escrow credentials' });
    }
    const AUTH = Buffer.from(`${ESCROW_EMAIL}:${ESCROW_API_KEY}`).toString('base64');

    // Make reference unique to avoid "Transaction already exists"
    const baseRef = (reference || 'order').toString().slice(0, 40); // safety limit
    const uniqueRef = `${baseRef}-${Date.now()}`;

    // Fixed placeholder buyer email (will be prefilled on Escrow checkout)
    const buyerEmail = 'example@domaingrid.com';

    // Seller must be the API account email so Escrow recognizes the initiator
    const sellerEmail = ESCROW_EMAIL;

    const parties = [
        { role: 'seller', customer: sellerEmail, agreed: true, initiator: true }
    ];
    if (buyerEmail) {
        parties.unshift({ role: 'buyer', customer: buyerEmail, agreed: true });
    }

    const schedule = [{
        amount: price,
        payer_customer: buyerEmail || sellerEmail,
        beneficiary_customer: sellerEmail
    }];

    const fees = [{
        type: 'escrow',
        split: 1,
        payer_customer: buyerEmail || sellerEmail
    }];

    const payload = {
        currency,
        description: `Sale of ${title}`,
        reference: uniqueRef,
        return_url: 'https://domaingrid.com/thank-you',
        redirect_type: 'automatic',
        items: [{
            title,
            description: `Sale of ${title}`,
            type: 'domain_name',
            inspection_period: 259200,
            quantity: 1,
            schedule,
            fees
        }],
        parties
    };

    try {
        const resp = await fetch('https://api.escrow.com/integration/pay/2018-03-31', {
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
          setCors(res);
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
          setCors(res);
          return res.status(502).json({ error: 'Unexpected response from Escrow', detail: text });
        }
        setCors(res);
        return res.status(200).json({
            url: data.landing_page,
            transaction_id: data.transaction_id,
            token: data.token
        });

      } catch (e) {
        console.error('Server exception', e);
        setCors(res);
        return res.status(500).json({ error: 'Server error' });
      }    
  }
  
