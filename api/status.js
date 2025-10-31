// api/status.js
export default function handler(req, res) {
    // No CORS needed for server-to-server health checks
    return res.status(200).json({
      status: 'ok',
      timestamp: new Date().toISOString()
    });
  }
  
  