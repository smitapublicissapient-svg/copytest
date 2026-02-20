/**
 * Optimized Email HTML Fetcher - FAST VERSION
 * Fixes timeout issues by searching smarter and faster
 */

const express = require('express');
const Imap = require('imap');
const { simpleParser } = require('mailparser');
const cors = require('cors');

const app = express();

// Increase timeout for all routes
app.use((req, res, next) => {
    req.setTimeout(120000); // 2 minutes
    res.setTimeout(120000); // 2 minutes
    next();
});

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// IMAP Configuration
const getImapConfig = (provider, username, password) => {
    const configs = {
        gmail: {
            user: username,
            password: password,
            host: 'imap.gmail.com',
            port: 993,
            tls: true,
            tlsOptions: { 
                rejectUnauthorized: false
            },
            authTimeout: 15000,
            connTimeout: 15000
        },
        outlook: {
            user: username,
            password: password,
            host: 'outlook.office365.com',
            port: 993,
            tls: true,
            tlsOptions: { 
                rejectUnauthorized: false
            },
            authTimeout: 15000,
            connTimeout: 15000
        },
        yahoo: {
            user: username,
            password: password,
            host: 'imap.mail.yahoo.com',
            port: 993,
            tls: true,
            tlsOptions: { 
                rejectUnauthorized: false
            },
            authTimeout: 15000,
            connTimeout: 15000
        }
    };
    
    return configs[provider.toLowerCase()];
};

/**
 * Main endpoint - OPTIMIZED
 */
app.post('/fetch-email', async (req, res) => {
    const startTime = Date.now();
    console.log('='.repeat(60));
    console.log('📨 Request received:', new Date().toISOString());
    
    try {
        const { provider, username, password, subject } = req.body;
        
        // Validate
        if (!provider || !username || !password || !subject) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields'
            });
        }
        
        console.log('Provider:', provider);
        console.log('Username:', username);
        console.log('Subject search:', subject);
        
        const imapConfig = getImapConfig(provider, username, password);
        
        if (!imapConfig) {
            return res.status(400).json({
                success: false,
                error: 'Invalid provider'
            });
        }
        
        // Set longer timeout for this specific request
        req.setTimeout(120000);
        res.setTimeout(120000);
        
        console.log('🔌 Starting email fetch...');
        
        // Fetch email with timeout
        const email = await Promise.race([
            fetchEmailBySubjectOptimized(imapConfig, subject),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Search timeout - taking too long')), 90000)
            )
        ]);
        
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`✅ Completed in ${duration}s`);
        
        if (email) {
            res.json({
                success: true,
                data: {
                    subject: email.subject,
                    from: email.from,
                    to: email.to,
                    date: email.date,
                    html: email.html,
                    text: email.text
                },
                meta: {
                    duration_seconds: duration
                }
            });
        } else {
            res.status(404).json({
                success: false,
                error: 'Email not found',
                message: `No email with subject containing: "${subject}"`
            });
        }
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        
        // Handle specific errors
        if (error.message.includes('timeout')) {
            return res.status(408).json({
                success: false,
                error: 'Request timeout',
                message: 'Email search took too long. Try a more specific subject.',
                duration_seconds: duration
            });
        }
        
        if (error.message.includes('LOGIN failed') || error.message.includes('Invalid credentials')) {
            let help = 'Check your credentials. ';
            if (req.body.provider === 'gmail') {
                help += 'Gmail requires App Password: https://myaccount.google.com/apppasswords';
            } else if (req.body.provider === 'outlook') {
                help += 'Outlook requires App Password: https://account.microsoft.com/security';
            }
            
            return res.status(401).json({
                success: false,
                error: 'Authentication failed',
                help: help
            });
        }
        
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * OPTIMIZED: Faster email search
 * Searches most recent emails first, stops when found
 */
function fetchEmailBySubjectOptimized(imapConfig, searchSubject) {
    return new Promise((resolve, reject) => {
        console.log('🔌 Connecting to IMAP...');

        const imap = new Imap(imapConfig);
        let foundEmail = null;

        const timeout = setTimeout(() => {
            if (!foundEmail) {
                console.log('⏰ Search timeout');
                imap.end();
                reject(new Error('Search timeout'));
            }
        }, 85000);

        imap.once('ready', () => {
            console.log('✅ Connected');

            imap.openBox('INBOX', true, (err, box) => {
                if (err) {
                    clearTimeout(timeout);
                    reject(err);
                    return;
                }

                console.log('📬 INBOX opened');
                console.log('📊 Total messages:', box.messages.total);

                if (box.messages.total === 0) {
                    clearTimeout(timeout);
                    imap.end();
                    resolve(null);
                    return;
                }

                // CHANGE: Use IMAP SEARCH with SUBJECT filter (much faster!)
                console.log(`🔍 Searching for subject: "${searchSubject}"...`);

                imap.search(['ALL', ['SUBJECT', searchSubject]], (err, results) => {
                    if (err) {
                        clearTimeout(timeout);
                        reject(err);
                        return;
                    }

                    console.log(`✅ Found ${results.length} matching emails`);

                    if (results.length === 0) {
                        clearTimeout(timeout);
                        imap.end();
                        resolve(null);
                        return;
                    }

                    // Get the MOST RECENT match (last in array)
                    const targetUid = results[results.length - 1];

                    console.log(`📥 Fetching email UID ${targetUid}...`);

                    const f = imap.fetch(targetUid, {
                        bodies: '',
                        markSeen: false
                    });

                    f.on('message', (msg) => {
                        msg.on('body', (stream) => {
                            simpleParser(stream, (err, parsed) => {
                                if (err) {
                                    clearTimeout(timeout);
                                    reject(err);
                                    return;
                                }

                                let htmlContent = parsed.html || '';

                                if (!htmlContent && parsed.text) {
                                    htmlContent = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family: Arial, sans-serif; padding: 20px; line-height: 1.6;">
<pre style="white-space: pre-wrap;">${parsed.text}</pre>
</body>
</html>`;
                                }

                                foundEmail = {
                                    subject: parsed.subject || '',
                                    from: parsed.from ? parsed.from.text : '',
                                    to: parsed.to ? parsed.to.text : '',
                                    date: parsed.date ? parsed.date.toISOString() : new Date().toISOString(),
                                    html: htmlContent,
                                    text: parsed.text || ''
                                };

                                console.log('✅ Email fetched successfully');
                                clearTimeout(timeout);
                                imap.end();
                            });
                        });
                    });

                    f.once('error', (err) => {
                        clearTimeout(timeout);
                        reject(err);
                    });
                });
            });
        });

        imap.once('error', (err) => {
            clearTimeout(timeout);
            console.error('❌ IMAP error:', err.message);

            if (err.message.includes('Invalid credentials') || err.message.includes('LOGIN failed')) {
                reject(new Error('LOGIN failed - Invalid credentials or App Password required'));
            } else {
                reject(err);
            }
        });

        imap.once('end', () => {
            console.log('🔌 Connection closed');
            clearTimeout(timeout);
            resolve(foundEmail);
        });

        imap.connect();
    });
}
/**
 * Health check
 */
app.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        version: '3.2.0 - Optimized',
        timestamp: new Date().toISOString()
    });
});

/**
 * Root endpoint
 */
app.get('/', (req, res) => {
    res.json({
        name: 'Email HTML Fetcher API - Optimized',
        version: '3.2.0',
        status: 'Running',
        optimizations: [
            'Searches last 50 emails only (faster)',
            'Header-only scan first (quick match)',
            'Fetches full body only for matches',
            'Extended timeouts (2 minutes)',
            'Early termination when found'
        ],
        endpoints: {
            '/': 'API documentation',
            '/health': 'Health check',
            '/fetch-email': 'Fetch email (POST)'
        },
        usage: {
            method: 'POST',
            endpoint: '/fetch-email',
            body: {
                provider: 'gmail | outlook | yahoo',
                username: 'your@email.com',
                password: 'app-password',
                subject: 'email subject'
            }
        },
        important: {
            gmail: 'Requires App Password: https://myaccount.google.com/apppasswords',
            outlook: 'Requires App Password: https://account.microsoft.com/security',
            yahoo: 'Requires App Password: https://login.yahoo.com/account/security'
        }
    });
});

// 404
app.use((req, res) => {
    res.status(404).json({
        error: '404 - Not found',
        available: ['GET /', 'GET /health', 'POST /fetch-email']
    });
});

// Start server
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
    console.log('='.repeat(60));
    console.log('✅ Email Fetcher API - OPTIMIZED VERSION');
    console.log('='.repeat(60));
    console.log(`🌍 Port: ${PORT}`);
    console.log('⚡ Optimizations:');
    console.log('   - Searches last 50 emails only');
    console.log('   - Header scan first (fast)');
    console.log('   - Full fetch only when matched');
    console.log('   - 2-minute timeout limit');
    console.log('='.repeat(60));
    console.log('📝 Ready for requests...');
    console.log('='.repeat(60));
});

// Set server timeout to 2 minutes
server.timeout = 120000;

module.exports = app;
