FROM node:22-slim

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY public ./public
COPY server ./server

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["node", "server/server.js"]
