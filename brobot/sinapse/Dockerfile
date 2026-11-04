FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY server ./server
COPY public ./public
# Sem DATABASE_URL, o PostgreSQL embutido grava em /data/pg: monte um Volume em /data (Railway: Volume, mount path /data).
ENV NODE_ENV=production PORT=3000 SINAPSE_DATA=/data/pg
RUN mkdir -p /data
EXPOSE 3000
CMD ["node", "server/main.js"]
