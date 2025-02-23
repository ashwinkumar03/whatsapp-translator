const fetch = require('node-fetch');
require('dotenv').config();

async function testWebhook() {
    const testMessages = [
        { text: "Hola, ¿cómo estás?", expectedLang: "Spanish" },
        { text: "Bonjour, comment allez-vous?", expectedLang: "French" },
        { text: "こんにちは", expectedLang: "Japanese" }
    ];

    console.log('\n🔍 Starting local tests...\n');

    // Test health check endpoint
    try {
        const healthResponse = await fetch('http://localhost:3000/');
        console.log('Health check test:', 
            healthResponse.status === 200 ? '✅ PASSED' : '❌ FAILED',
            await healthResponse.text()
        );
    } catch (error) {
        console.error('❌ Health check test failed:', error.message);
        console.log('Make sure your server is running (npm run dev)');
        process.exit(1);
    }

    // Test webhook verification
    try {
        const verifyResponse = await fetch(
            `http://localhost:3000/webhook?hub.mode=subscribe&hub.verify_token=${process.env.WHATSAPP_VERIFY_TOKEN}&hub.challenge=challenge123`
        );
        console.log('\nWebhook verification test:', 
            verifyResponse.status === 200 ? '✅ PASSED' : '❌ FAILED'
        );
    } catch (error) {
        console.error('❌ Webhook verification test failed:', error.message);
    }

    // Test message translation
    console.log('\nTesting message translations:');
    for (const test of testMessages) {
        try {
            console.log(`\nTesting ${test.expectedLang} translation: "${test.text}"`);
            
            const response = await fetch('http://localhost:3000/webhook', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    object: 'whatsapp_business_account',
                    entry: [{
                        changes: [{
                            value: {
                                messages: [{
                                    from: '123456789',
                                    text: { body: test.text }
                                }],
                                metadata: {
                                    phone_number_id: '123456789'
                                }
                            }
                        }]
                    }]
                })
            });

            const responseData = await response.text();
            let jsonData;
            try {
                jsonData = JSON.parse(responseData);
            } catch (e) {
                console.log(`❌ ${test.expectedLang} translation test FAILED: Non-JSON response:`, responseData);
                continue;
            }

            if (response.status === 200) {
                console.log(`✅ ${test.expectedLang} translation test PASSED`);
                console.log(`   Original: "${test.text}"`);
                console.log(`   Translated: "${jsonData.translation}"`);
            } else {
                console.log(`❌ ${test.expectedLang} translation test FAILED:`, jsonData.error || 'Unknown error');
                if (jsonData.details) {
                    console.log(`   Details: ${jsonData.details}`);
                }
            }
        } catch (error) {
            console.error(`❌ ${test.expectedLang} translation test failed:`, error.message);
        }
    }
}

// Add error handling for the main function
testWebhook().catch(error => {
    console.error('❌ Test suite failed:', error);
    process.exit(1);
}); 