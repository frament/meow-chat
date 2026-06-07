.PHONY: build up down logs restart-backend dev-backend dev-backend-win dev-frontend update admin admin-remove admin-list reset-password

update:
	git pull && docker compose build && docker compose up -d

build:
	docker compose build

up:
	docker compose up -d

down:
	docker compose down

logs:
	docker compose logs -f

restart-backend:
	docker compose build backend && docker compose up -d --no-deps backend

dev-backend:
	cd backend && DB_PATH=./data/chat.db go run .

dev-backend-win:
	cd backend && set DB_PATH=./data/chat.db && go run .

dev-frontend:
	cd frontend && npm run start

admin:
	docker compose exec backend ./server admin add $(filter-out $@,$(MAKECMDGOALS))

admin-remove:
	docker compose exec backend ./server admin remove $(filter-out $@,$(MAKECMDGOALS))

admin-list:
	docker compose exec backend ./server admin list

reset-password:
	docker compose exec backend ./server admin reset-password $(filter-out $@,$(MAKECMDGOALS))

# Prevent make from erroring on unknown targets passed as args
%:
	@:
