# Build context = RAIZ do repositório (precisa enxergar "sistema web/").
# No Coolify: Base Directory = / e Dockerfile Location = backend/Dockerfile
FROM node:20-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

# Dependências primeiro (cache de camada)
COPY backend/package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

# Código do backend
COPY backend/ ./

# Front estático servido pelo Fastify
COPY ["sistema web", "/app/sistema web"]
ENV STATIC_DIR="/app/sistema web"

EXPOSE 3000

# Healthcheck bate em /api/health (fetch nativo do Node 20)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
