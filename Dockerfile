# VALENIXIA POS - Production Container Configuration
FROM node:20-alpine AS builder

WORKDIR /usr/src/app

# Install build dependencies for compiling native modules
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci

FROM node:20-alpine

WORKDIR /usr/src/app

COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY . .

# Run as non-root user for production safety
USER node

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000

CMD ["node", "server.js"]
