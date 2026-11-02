FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
# Pacote opcional da IA (sem ANTHROPIC_API_KEY o guia responde pelo conteúdo curado).
RUN npm ci --omit=dev --no-audit --no-fund
COPY server ./server
COPY public ./public
COPY pacotes ./pacotes
# Avaliações dos usuários em /data/feedback.jsonl: monte um volume nesse caminho para não perder no deploy.
ENV NODE_ENV=production PORT=3000 GUIA_DADOS=/data
RUN mkdir -p /data
EXPOSE 3000
CMD ["node", "server/server.js"]
