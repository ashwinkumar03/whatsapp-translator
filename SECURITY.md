# Security Configuration

## Required Environment Variables

This application requires the following environment variables to be set:

- `WHATSAPP_TOKEN`: Your WhatsApp Business API token
- `WHATSAPP_VERIFY_TOKEN`: A custom token for webhook verification
- `GOOGLE_PROJECT_ID`: Your Google Cloud Project ID
- `GOOGLE_APPLICATION_CREDENTIALS_JSON`: Your Google Cloud service account credentials
- `NODE_ENV`: Set to 'development' for local testing, 'production' for deployment

## Setting Up Credentials

1. **Google Cloud Translation API**
   - Create a project in Google Cloud Console
   - Enable the Cloud Translation API
   - Create a service account
   - Download JSON credentials
   - Never commit these credentials to version control

2. **WhatsApp Business API**
   - Set up a Meta Developer account
   - Create a WhatsApp Business API application
   - Generate access tokens
   - Never commit these tokens to version control

## Local Development

1. Copy `.env.example` to `.env`
2. Fill in your credentials in `.env`
3. Keep `.env` in your `.gitignore`

## Production Deployment

In production:
- Use environment variables in your hosting platform
- Enable IP whitelisting for WhatsApp webhooks
- Set NODE_ENV=production 