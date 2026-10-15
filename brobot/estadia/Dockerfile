FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
# Pacote opcional da conferência de fotos por IA (sem ANTHROPIC_API_KEY ele não é usado).
RUN npm ci --omit=dev --no-audit --no-fund
COPY server ./server
COPY public ./public
# Dados em /data: monte um volume nesse caminho (Railway: Volume com mount path /data).
ENV NODE_ENV=production PORT=3000 ESTADIA_DATA=/data
RUN mkdir -p /data
EXPOSE 3000
CMD ["node", "server/server.js"]
