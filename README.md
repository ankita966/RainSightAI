# Maharashtra Compass

refer all these things and also add maharashtra map to this and don't stop without finishing

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/060dd3ce-ce94-4d9a-9c60-5b022c4877c0).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## RainSight data API

The RainSight page reads forecast, verification, and grid-cell data from the Flask API. Start the API in the backend directory before opening the frontend:

```sh
python3 api.py
```

The API listens on `127.0.0.1:5000` by default. The browser calls this local API directly; CORS is enabled by Flask. Vite also proxies `/api/*` to port 5000 for local requests. Set `RAINSIGHT_API_PORT` to use another port and update the Vite proxy target and `VITE_RAINSIGHT_API_BASE_URL` to match. When deploying the frontend separately, set `VITE_RAINSIGHT_API_BASE_URL` to the deployed API origin; see `.env.example`.
