require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const {Translate} = require('@google-cloud/translate').v2;
const fetch = require('node-fetch');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const { body, validationResult } = require('express-validator');

// Add this near the top of the file, after imports
const isTestEnvironment = process.env.NODE_ENV === 'development';

// Validate required environment variables
const requiredEnvVars = ['WHATSAPP_TOKEN', 'WHATSAPP_VERIFY_TOKEN', 'GOOGLE_PROJECT_ID'];
for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
        console.error(`Missing required environment variable: ${envVar}`);
        process.exit(1);
    }
}

const app = express();
const port = process.env.PORT || 3000;

// Security middleware
app.use(helmet());

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100 // limit each IP to 100 requests per windowMs
});
app.use('/webhook', limiter);

// Only allow requests from WhatsApp IPs in production
app.use('/webhook', (req, res, next) => {
    if (process.env.NODE_ENV === 'production') {
        // Add WhatsApp IP ranges here
        const whatsappIPs = ['157.240.0.0/16', '69.171.250.0/24', '69.171.251.0/24'];
        const clientIP = req.ip;
        
        // Basic IP check (you might want to use a proper IP checking library)
        const isWhatsAppIP = whatsappIPs.some(range => 
            clientIP.startsWith(range.split('/')[0].slice(0, -1))
        );

        if (!isWhatsAppIP) {
            return res.status(403).json({ error: 'Unauthorized IP' });
        }
    }
    next();
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

// Handle incoming messages
app.post('/webhook', [
    body('object').exists(),
    body('entry.*.changes.*.value.messages.*.text.body').exists(),
    body('entry.*.changes.*.value.metadata.phone_number_id').exists(),
    body('entry.*.changes.*.value.messages.*.from').exists()
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    if (req.body.object) {
        if (req.body.entry &&
            req.body.entry[0].changes &&
            req.body.entry[0].changes[0] &&
            req.body.entry[0].changes[0].value.messages &&
            req.body.entry[0].changes[0].value.messages[0]
        ) {
            const phone_number_id = req.body.entry[0].changes[0].value.metadata.phone_number_id;
            const from = req.body.entry[0].changes[0].value.messages[0].from;
            const msg_body = req.body.entry[0].changes[0].value.messages[0].text.body;

            try {
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
        }
    }
    
    res.status(400).json({ error: 'Invalid request format' });
});

// Modify the sendMessage function
async function sendMessage(phone_number_id, to, message) {
    // In test/development environment, mock the WhatsApp API call
    if (isTestEnvironment) {
        console.log('Test environment: Mocking WhatsApp API call');
        console.log('Would have sent:', { to, message });
        return { success: true, mocked: true };
    }

    // Real WhatsApp API call for production
    const url = `https://graph.facebook.com/v12.0/${phone_number_id}/messages`;
    
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
            throw new Error(`WhatsApp API error! status: ${response.status}`);
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