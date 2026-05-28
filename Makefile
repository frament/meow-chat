.PHONY: build up down logs dev-backend dev-backend-win dev-frontend

build:
	docker compose build

up:
	docker compose up -d

down:
	docker compose down

logs:
	docker compose logs -f

dev-backend:
	cd backend && DB_PATH=./data/chat.db go run .

dev-backend-win:
	cd backend && set DB_PATH=./data/chat.db && go run .

dev-frontend:
	cd frontend && npm run start
