FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY server.js ./

# SQLite file lives in a mounted volume so data survives container restarts
VOLUME ["/app/data"]
ENV DB_PATH=/app/data/pastes.db

EXPOSE 4000

CMD ["node", "server.js"]
