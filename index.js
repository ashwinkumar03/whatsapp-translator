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

// Make the phone number validation more flexible
const ALLOWED_PHONE_NUMBERS = process.env.ALLOWED_PHONE_NUMBERS?.split(',').map(num => {
    // Strip any non-digit characters
    const cleaned = num.replace(/\D/g, '');
    // Ensure it has country code (assuming US/Canada for simplicity)
    return cleaned.startsWith('1') ? cleaned : `1${cleaned}`;
}) || [];

// Add debug line to verify allowed numbers on startup
console.log('Allowed phone numbers:', ALLOWED_PHONE_NUMBERS);

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

// Modify your webhook handler to acknowledge receipt immediately
app.post('/webhook', [
    body('object').exists(),
    body('entry.*.changes.*.value.messages.*.text.body').exists(),
    body('entry.*.changes.*.value.metadata.phone_number_id').exists(),
    body('entry.*.changes.*.value.messages.*.from').exists(),
    header('x-hub-signature-256').exists(),
], async (req, res) => {
    // Acknowledge receipt immediately to prevent duplicates
    res.status(200).send('OK');
    
    // Process the webhook asynchronously
    try {
        console.log('Environment:', {
            NODE_ENV: process.env.NODE_ENV,
            DEBUG: DEBUG,
            isTestEnvironment: isTestEnvironment,
            ALLOWED_PHONE_NUMBERS: ALLOWED_PHONE_NUMBERS
        });
        
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
            // Don't send response, just log
            console.log('Validation failed');
            return; // Exit early
        }

        // Signature verification
        try {
            // Only verify signature in production mode
            if (process.env.NODE_ENV === 'production' && !isTestEnvironment) {
                const signature = req.header('x-hub-signature-256');
                
                // Skip signature check if it's missing and we're in debug mode
                if (!signature && DEBUG) {
                    console.warn('Missing signature, but continuing due to DEBUG mode');
                } else if (!signature) {
                    console.warn('Missing signature');
                    return; // Exit early
                } else {
                    // Log the raw body and signature for debugging
                    console.log('Raw body:', JSON.stringify(req.body));
                    console.log('Received signature:', signature);
                    
                    // Try different ways of calculating the signature
                    const bodyString = JSON.stringify(req.body);
                    
                    // Method 1: Using string directly
                    const expectedSignature1 = crypto
                        .createHmac('sha256', process.env.WHATSAPP_TOKEN)
                        .update(bodyString)
                        .digest('hex');
                        
                    // Method 2: Using Buffer
                    const expectedSignature2 = crypto
                        .createHmac('sha256', process.env.WHATSAPP_TOKEN)
                        .update(Buffer.from(bodyString))
                        .digest('hex');
                        
                    console.log('Expected signature (Method 1):', `sha256=${expectedSignature1}`);
                    console.log('Expected signature (Method 2):', `sha256=${expectedSignature2}`);
                    
                    // Try both methods for verification
                    if (signature === `sha256=${expectedSignature1}` || signature === `sha256=${expectedSignature2}`) {
                        console.log('Signature verified successfully');
                    } else if (DEBUG) {
                        console.warn('Invalid signature received, but continuing due to DEBUG mode');
                    } else {
                        console.warn('Invalid signature received');
                        return; // Exit early
                    }
                }
            }
        } catch (error) {
            console.error('Signature verification failed:', error);
            if (!DEBUG) {
                return; // Exit early
            } else {
                console.warn('Continuing despite signature verification failure due to DEBUG mode');
            }
        }

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
                const from = message.from;
                
                console.log('Received message:', message);
                console.log('Full value object:', JSON.stringify(value, null, 2));
                
                // Add phone number check
                if (!ALLOWED_PHONE_NUMBERS.includes(from) && !DEBUG) {
                    console.log(`Unauthorized phone number attempted to use bot: ${from}`);
                    // Use the correct phone number ID from the metadata
                    const phone_number_id = value.metadata.phone_number_id;
                    // Send a friendly message to unauthorized users
                    await sendMessage(
                        phone_number_id,
                        from,
                        "Sorry, this translation service is currently restricted to authorized users only."
                    );
                    return; // Exit early
                } else if (!ALLOWED_PHONE_NUMBERS.includes(from)) {
                    console.log(`Unauthorized phone number bypassed in DEBUG mode: ${from}`);
                }
                
                try {
                    // Use the phone_number_id from the incoming message
                    const phone_number_id = value.metadata.phone_number_id;
                    const msg_body = message.text.body;

                    console.log('Processing message with phone_number_id:', phone_number_id);
                    
                    // Translate the message to English
                    const [translation] = await translate.translate(msg_body, 'en');
                    
                    // Send the translated message back
                    await sendMessage(phone_number_id, from, `Translated text: ${translation}`);
                    
                    // Log success instead of sending response
                    console.log('Translation successful:', translation);
                } catch (error) {
                    console.error('Translation error:', error);
                    // Log error instead of sending response
                }
            } else if (value.statuses) {
                // Handle status update
                console.log('Received status update:', value.statuses[0]);
            }
        } else {
            console.log('Invalid request format');
        }
        
        // Log completion instead of sending response
        console.log('Processing completed successfully');
    } catch (error) {
        console.error('Error processing webhook:', error);
    }
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

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy', timestamp: new Date().toISOString() });
});

app.listen(port, () => {
    console.log(`Webhook is listening on port ${port}`);
}); 