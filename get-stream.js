export async function handler(event, context) {
    if (event.httpMethod !== 'GET') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }

    const { id, type = 'movie' } = event.queryStringParameters; // e.g., id=96981&type=movie (TMDB ID)

    if (!id) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Missing content ID parameter' }) };
    }

    // Define your ordered list of providers/resolvers
    // Each entry maps a provider name to a URL generator function or pattern
    const providers = [
        {
            name: 'videasy',
            getUrl: (id, type) => `https://videasy.net/api/embed/${type}/${id}`, // Adjust based on exact target API layout
            parse: async (res) => {
                const data = await res.json();
                return data.m3u8Url || data.url;
            }
        },
        {
            name: 'vidsrc',
            getUrl: (id, type) => `https://vidsrc.xyz/embed/${type}/${id}`,
            parse: async (res) => {
                // If it returns HTML or requires scraping, handle extraction here
                const text = await res.text();
                const match = text.match(/https?:\/\/[^"']+\.m3u8/);
                return match ? match[0] : null;
            }
        },
        {
            name: 'vidlink',
            getUrl: (id, type) => `https://vidlink.pro/api/v1/${type}/${id}`,
            parse: async (res) => {
                const data = await res.json();
                return data.stream?.url || data.url;
            }
        },
        {
            name: 'primesrc',
            getUrl: (id, type) => `https://primesrc.xyz/embed/${type}/${id}`,
            parse: async (res) => {
                const text = await res.text();
                const match = text.match(/https?:\/\/[^"']+\.m3u8/);
                return match ? match[0] : null;
            }
        }
    ];

    let m3u8Url = null;
    let successfulProvider = null;

    // Loop sequentially through providers until one succeeds
    for (const provider of providers) {
        try {
            const targetUrl = provider.getUrl(id, type);
            
            // Set a tight timeout (e.g., 4000ms) so a lagging provider fails fast and moves on
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 4000);

            const response = await fetch(targetUrl, {
                signal: controller.signal,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Referer': 'https://google.com'
                }
            });

            clearTimeout(timeoutId);

            if (response.ok) {
                const extractedUrl = await provider.parse(response);
                if (extractedUrl && extractedUrl.includes('.m3u8')) {
                    m3u8Url = extractedUrl;
                    successfulProvider = provider.name;
                    break; // Stop loop immediately on success!
                }
            }
        } catch (err) {
            console.warn(`Provider ${provider.name} failed:`, err.message);
            // Continue to the next provider in the loop
        }
    }

    if (!m3u8Url) {
        return {
            statusCode: 502,
            body: JSON.stringify({ error: 'All streaming providers failed to return a valid .m3u8 stream.' })
        };
    }

    return {
        statusCode: 200,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({ success: true, provider: successfulProvider, m3u8Url })
    };
}
