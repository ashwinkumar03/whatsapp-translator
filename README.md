# WhatsApp Translator Bot

A WhatsApp bot that automatically translates messages to English using the WhatsApp Cloud API and Google Cloud Translation API.

## Setup

1. Clone the repository
2. Install dependencies: `npm install`
3. Copy `.env.example` to `.env`
4. Set up your credentials (see SECURITY.md)
5. Run locally: `npm run dev`
6. Run tests: `npm test`

## Security

See [SECURITY.md](SECURITY.md) for important security configuration details.

## Environment Variables

Never commit your `.env` file or any credentials to version control!

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

[Add your chosen license here]

## Service Uptime

This repository includes a GitHub Action that pings the service every 12 minutes to prevent it from going to sleep on Render's free tier. The workflow can be found in `.github/workflows/keep-alive.yml`. 