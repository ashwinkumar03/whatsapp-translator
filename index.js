require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const {Translate} = require('@google-cloud/translate').v2;
const fetch = require('node-fetch');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const { body, validationResult, header } = require('express-validator');
const crypto = require('crypto');

// Add this near the top of the file, after imports
const isTestEnvironment = process.env.NODE_ENV === 'development';
const DEBUG = true; // Force debug mode regardless of NODE_ENV

// Add after your imports
const requiredEnvVars = [
    'WHATSAPP_TOKEN',
    'WHATSAPP_VERIFY_TOKEN',
    'GOOGLE_PROJECT_ID',
    'GOOGLE_APPLICATION_CREDENTIALS_JSON',
    'ALLOWED_PHONE_NUMBERS',
    'NODE_ENV',
    'WHATSAPP_PHONE_NUMBER_ID'
];

for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
        console.error(`Missing required environment variable: ${envVar}`);
        process.exit(1);
    }
}

const app = express();
const port = process.env.PORT || 3000;

// Add this line before other middleware
app.set('trust proxy', 1);  // Trust first proxy (Render)

// Security middleware
app.use(helmet({
    contentSecurityPolicy: true,
    crossOriginEmbedderPolicy: true,
    crossOriginOpenerPolicy: true,
    crossOriginResourcePolicy: true,
    dnsPrefetchControl: true,
    frameguard: true,
    hidePoweredBy: true,
    hsts: true,
    ieNoOpen: true,
    noSniff: true,
    referrerPolicy: true,
    xssFilter: true
}));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100 // limit each IP to 100 requests per windowMs
});
app.use('/webhook', limiter);

// IP whitelisting in production
app.use('/webhook', (req, res, next) => {
    // Temporarily disable IP check
    return next();
    
    /* Original code
    if (process.env.NODE_ENV === 'production') {
        // Skip IP check for GET requests (webhook verification)
        if (req.method === 'GET') {
            return next();
        }

        // WhatsApp IP ranges
        const whatsappIPs = ['157.240.0.0/16', '69.171.250.0/24', '69.171.251.0/24'];
        const clientIP = req.ip;
        
        const isWhatsAppIP = whatsappIPs.some(range => 
            clientIP.startsWith(range.split('/')[0].slice(0, -1))
        );

        if (!isWhatsAppIP) {
            return res.status(403).json({ error: 'Unauthorized IP' });
        }
    }
    next();
    */
});

// Initialize Google Translate with credentials
let credentials;
if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
    credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
}

const translate = new Translate({
    projectId: process.env.GOOGLE_PROJECT_ID,
    credentials: credentials
});

app.use(bodyParser.json());

// Enhanced webhook verification
app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (!mode || !token) {
        return res.sendStatus(400);
    }

    if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
        console.log('Webhook verified');
        res.status(200).send(challenge);
    } else {
        res.sendStatus(403);
    }
});

// Update ALLOWED_PHONE_NUMBERS to include country code
const ALLOWED_PHONE_NUMBERS = process.env.ALLOWED_PHONE_NUMBERS?.split(',').map(num => 
    num.startsWith('1') ? num : `1${num}`
) || [];

// Update the logging middleware
app.use((req, res, next) => {
    console.log('--------------------');
    console.log('New Request:');
    console.log('Time:', new Date().toISOString());
    console.log('Method:', req.method);
    console.log('Path:', req.path);
    console.log('Headers:', JSON.stringify(req.headers, null, 2));
    console.log('Body:', JSON.stringify(req.body, null, 2));
    console.log('--------------------');
    next();
});

// Handle incoming messages
app.post('/webhook', [
    body('object').exists(),
    // Remove these strict validations temporarily
    /*
    body('entry.*.changes.*.value.messages.*.text.body').exists(),
    body('entry.*.changes.*.value.metadata.phone_number_id').exists(),
    body('entry.*.changes.*.value.messages.*.from').exists(),
    header('x-hub-signature-256').exists(),
    */
], async (req, res) => {
    console.log('Webhook POST received');
    console.log('Full request:', {
        headers: req.headers,
        body: req.body,
        query: req.query,
        params: req.params
    });
    
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        console.log('Validation errors:', errors.array());
        return res.status(400).json({ errors: errors.array() });
    }

    // Verify WhatsApp signature
    const signature = req.header('x-hub-signature-256');
    const expectedSignature = crypto
        .createHmac('sha256', process.env.WHATSAPP_TOKEN)
        .update(Buffer.from(JSON.stringify(req.body)))  // Convert to buffer
        .digest('hex');

    if (signature) {
        console.log('Received signature:', signature);
        console.log('Expected signature:', `sha256=${expectedSignature}`);
    }

    // Temporarily disable signature check for testing
    // if (!signature || `sha256=${expectedSignature}` !== signature) {
    //     console.warn('Invalid signature received');
    //     return res.sendStatus(401);
    // }

    if (req.body.object === 'whatsapp_business_account') {
        const entry = req.body.entry[0];
        const changes = entry.changes[0];
        const value = changes.value;

        // Log the type of update we're receiving
        console.log('Webhook update type:', changes.field);
        console.log('Value:', value);

        if (value.messages) {
            // Handle incoming message
            const message = value.messages[0];
            console.log('Received message:', message);
            
            try {
                // Use environment variable instead of constant
                const phone_number_id = process.env.WHATSAPP_PHONE_NUMBER_ID;
                const from = message.from;
                const msg_body = message.text.body;

                console.log('Processing message:', {
                    phone_number_id,
                    from,
                    msg_body
                });

                // Translate the message to English
                const [translation] = await translate.translate(msg_body, 'en');
                
                // Send the translated message back
                await sendMessage(phone_number_id, from, `Translated text: ${translation}`);
                
                return res.status(200).json({ 
                    success: true, 
                    translation: translation 
                });
            } catch (error) {
                console.error('Translation error:', error);
                return res.status(500).json({ 
                    error: 'Translation failed',
                    details: error.message 
                });
            }
        } else if (value.statuses) {
            // Handle status update
            console.log('Received status update:', value.statuses[0]);
            return res.sendStatus(200); // Acknowledge status updates
        }
    }
    
    res.status(400).json({ error: 'Invalid request format' });
});

// Modify the sendMessage function
async function sendMessage(phone_number_id, to, message) {
    console.log('Sending message:', {
        phone_number_id,
        to,
        message
    });

    // Real WhatsApp API call for production
    const url = `https://graph.facebook.com/v18.0/${phone_number_id}/messages`;
    
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                messaging_product: "whatsapp",
                to: to,
                text: { body: message },
            }),
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`WhatsApp API error! status: ${response.status}, details: ${JSON.stringify(errorData)}`);
        }
        
        return await response.json();
    } catch (error) {
        console.error('Error sending message:', error);
        throw error;
    }
}

// Add a health check endpoint
app.get('/', (req, res) => {
    res.status(200).send('WhatsApp Translator Bot is running!');
});

app.listen(port, () => {
    console.log(`Webhook is listening on port ${port}`);
}); 