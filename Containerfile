# Build one target at a time:
#   podman build --target api -t localhost/osusume-api:dev -f Containerfile .
#   podman build --target web -t localhost/osusume-web:dev -f Containerfile .

FROM docker.io/library/node:26-alpine AS build
# Same version as packageManager in package.json. Node no longer ships corepack.
RUN npm install --global pnpm@12.16.1
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY e2e/package.json e2e/
RUN pnpm install --frozen-lockfile
COPY apps apps
COPY packages packages
RUN pnpm -r build
# The api with only its production dependencies, sharp's musl binary among them.
RUN pnpm --filter @osusume/api --prod deploy /api

FROM docker.io/library/node:26-alpine AS api
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /api/package.json ./
COPY --from=build /api/node_modules node_modules
COPY --from=build /api/dist dist
COPY --from=build /api/drizzle drizzle
# A new named volume takes this directory's owner, so the api can write to it.
RUN mkdir -p /var/lib/osusume/images && chown -R 1000:1000 /var/lib/osusume
ENV IMAGE_STORAGE_PATH=/var/lib/osusume/images
USER 1000:1000
EXPOSE 3000
CMD ["node", "dist/main.js"]

FROM docker.io/nginxinc/nginx-unprivileged:1.29-alpine AS web
COPY infra/nginx/web.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
