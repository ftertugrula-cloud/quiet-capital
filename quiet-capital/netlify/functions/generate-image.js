exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  try {
    const body = JSON.parse(event.body);
    const { prompt, model, aspect_ratio, reference_image, reference_mode, elevate_key } = body;

    if (!elevate_key) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Missing elevate_key' }) };
    }

    // Build MCP JSON-RPC request — same format used by Claude MCP integration
    const mcpPayload = {
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: {
        name: 'generate_image',
        arguments: {
          prompt,
          model: model || 'nano_banana_pro',
          aspect_ratio: aspect_ratio || 'landscape',
          wait: true,
          ...(reference_image && {
            reference_images: [reference_image],
            reference_mode: reference_mode || 'subject'
          })
        }
      }
    };

    const response = await fetch('https://mcp.elevate.uno/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${elevate_key}`
      },
      body: JSON.stringify(mcpPayload)
    });

    const text = await response.text();
    
    let data;
    try {
      data = JSON.parse(text);
    } catch(e) {
      return {
        statusCode: 500,
        headers: CORS,
        body: JSON.stringify({ error: 'Invalid JSON response', raw: text.slice(0, 500) })
      };
    }

    if (!response.ok) {
      return {
        statusCode: response.status,
        headers: CORS,
        body: JSON.stringify({ error: `MCP error ${response.status}`, detail: data })
      };
    }

    // Extract URL from MCP JSON-RPC response
    let url = null;
    
    // Try standard MCP response format
    if (data.result) {
      const content = data.result.content;
      if (Array.isArray(content)) {
        for (const item of content) {
          if (item.type === 'text' && item.text) {
            try {
              const parsed = JSON.parse(item.text);
              url = parsed.result_url || parsed.data?.result_url || parsed.url;
              if (url) break;
            } catch(e) {
              // Try regex on text
              const m = item.text.match(/https?:\/\/[^\s"<>]+\.(?:png|jpg|jpeg|webp)/i);
              if (m) { url = m[0]; break; }
            }
          }
        }
      }
    }

    // Fallback: regex scan entire response
    if (!url) {
      const raw = JSON.stringify(data);
      const m = raw.match(/https?:\/\/[^\s"<>\\]+\.(?:png|jpg|jpeg|webp)/i);
      if (m) url = m[0];
    }

    if (!url) {
      return {
        statusCode: 500,
        headers: CORS,
        body: JSON.stringify({ error: 'No image URL in response', raw: JSON.stringify(data).slice(0, 500) })
      };
    }

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ url })
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message })
    };
  }
};
