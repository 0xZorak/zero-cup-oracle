# The Oracle — agent runtime (the autonomous predict/resolve loop).
# Not a web server: this runs `npm run agent`, which schedules predictions and
# resolutions against 0G. Pass secrets at runtime via --env-file .env.
FROM node:22-slim

WORKDIR /app

# Install deps first for layer caching. tsx is a devDependency the loop needs,
# so install everything (not --omit=dev).
COPY package.json package-lock.json ./
RUN npm ci

# App source (data/ provides the offline fixture fallback).
COPY tsconfig.json ./
COPY src ./src
COPY data ./data

# The agent reads config from environment variables (see .env.example).
CMD ["npm", "run", "agent"]
