FROM golang:1.23-alpine AS builder

RUN apk add --no-cache gcc musl-dev

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .
# No VERSION build arg: the release number is embedded from version/VERSION, so
# there is nothing to pass in and nothing that can silently fall back to a
# stale literal.
RUN CGO_ENABLED=1 go build -o server .

FROM alpine:3.19

RUN apk add --no-cache ca-certificates sqlite

WORKDIR /app

COPY --from=builder /app/server .

EXPOSE 8080

CMD ["./server"]
