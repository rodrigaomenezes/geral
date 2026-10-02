FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY server ./server
COPY public ./public
# Dados em /data: monte um volume nesse caminho (Railway: Volume com mount path /data).
ENV NODE_ENV=production PORT=3000 ESTADIA_DATA=/data
RUN mkdir -p /data
EXPOSE 3000
CMD ["node", "server/server.js"]
