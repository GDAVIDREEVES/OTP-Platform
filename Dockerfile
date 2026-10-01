# OTP Platform — single-container image: builds the React app, then runs
# FastAPI which serves both the API and the built SPA on one port.
#
#   docker build -t otp-platform .
#   docker run --rm -p 8000:8000 otp-platform      # → http://localhost:8000

FROM node:20-slim AS web
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY index.html vite.config.ts tsconfig.json tsconfig.node.json tailwind.config.js postcss.config.js ./
COPY public ./public
COPY src ./src
RUN npm run build

FROM python:3.12-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY backend ./backend
COPY data ./data
COPY --from=web /app/dist ./dist
EXPOSE 8000
ENV HOST=0.0.0.0 PORT=8000
WORKDIR /app/backend
CMD ["sh", "-c", "uvicorn main:app --host ${HOST} --port ${PORT}"]
