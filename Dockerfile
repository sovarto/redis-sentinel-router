# Use an up-to-date Node.js image based on Alpine Linux
FROM node:18-alpine

RUN apk add --no-cache haproxy

COPY haproxy.cfg /haproxy.cfg

WORKDIR /app

RUN npm install -g pm2

COPY package*.json ./
RUN npm install

COPY . .
RUN npx tsc

CMD ["pm2-runtime", "./dist/app.js"]
