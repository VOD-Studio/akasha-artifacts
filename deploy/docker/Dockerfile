FROM node:24-bookworm AS build
WORKDIR /work
RUN corepack enable pnpm
COPY . .
RUN make install && make build \
    && pnpm --filter akasha-artifacts deploy --legacy --prod /runtime

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    AKASHA_WEB_DIR=/app/web \
    AKASHA_SANDBOX_DIR=/app/sandbox \
    AKASHA_SQLITE_PATH=/data/akasha.db
COPY --from=build --chown=node:node /runtime/ /app/
COPY --from=build --chown=node:node /work/apps/web/dist/ /app/web/
COPY --from=build --chown=node:node /work/apps/sandbox/dist/ /app/sandbox/
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8080 8081
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e 'fetch("http://127.0.0.1:"+(process.env.AKASHA_HUB_PORT||8080)+"/api/v1/health").then(r=>process.exit(r.ok?0:1),()=>process.exit(1))'
CMD ["node", "dist/hub/serve.js"]
