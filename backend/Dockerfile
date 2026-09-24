FROM golang:1.23-alpine AS builder

RUN apk add --no-cache gcc musl-dev

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .
ARG VERSION=1.2.0
RUN CGO_ENABLED=1 go build -ldflags="-X my-chat-backend/version.Version=${VERSION}" -o server .

FROM alpine:3.19

RUN apk add --no-cache ca-certificates sqlite

WORKDIR /app

COPY --from=builder /app/server .

EXPOSE 8080

CMD ["./server"]
