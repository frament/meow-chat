FROM node:24-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# The build stamp needs to know which commit it is building. `.git/` is in
# .dockerignore - correctly, it is large and irrelevant to the bundle - so
# inside the image there is no repository to ask. These args are how the
# commit gets in. Empty means "not told", and the script falls back to asking
# git, which is what a local `npm run build` uses.
ARG BUILD_COMMIT=""
ARG BUILD_DIRTY=""
ENV BUILD_COMMIT=$BUILD_COMMIT BUILD_DIRTY=$BUILD_DIRTY

RUN npm run build:prod

FROM nginx:alpine

COPY nginx.conf /etc/nginx/nginx.conf

COPY --from=builder /app/dist/frontend/browser /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
