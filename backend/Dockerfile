# syntax=docker/dockerfile:1

FROM golang:1.26-alpine AS builder

RUN apk add --no-cache gcc musl-dev

WORKDIR /app

COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod \
    go mod download

COPY . .
# No VERSION build arg: the release number is embedded from version/VERSION, so
# there is nothing to pass in and nothing that can silently fall back to a
# stale literal.
#
# The cache mount is the whole point of this line. Without it the build cache
# lives in the image layer that `go build` creates, so any change under COPY . .
# throws it away and the next build recompiles every dependency from scratch -
# measured at 751s on the home-lab server (i5-8300H, 8 cores), which is why a
# one-file change took twelve minutes. With the mount the cache outlives the
# layer, and only the packages that actually changed are rebuilt.
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=1 go build -o server .

FROM alpine:3.19

RUN apk add --no-cache ca-certificates sqlite

WORKDIR /app

COPY --from=builder /app/server .

EXPOSE 8080

CMD ["./server"]