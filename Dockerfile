FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install all dependencies (including dev for TypeScript build)
RUN npm ci

# Copy source files
COPY src/ ./src/

# Build TypeScript
RUN npm run build

# Expose port (Cloud Run uses PORT env var)
EXPOSE 8080

# Start the server
CMD ["node", "dist/index.js"]