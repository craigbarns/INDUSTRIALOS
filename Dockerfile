FROM node:22-bookworm-slim
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
# Keep development tools: the same image runs versioned migrations and the TypeScript worker.
RUN npm ci --include=dev
COPY --chown=node:node . .
RUN npm run build && chown -R node:node /app/.next
ENV NODE_ENV=production
USER node
EXPOSE 3000
CMD ["node", "node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0"]
