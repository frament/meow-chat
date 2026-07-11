.PHONY: build up down logs restart-backend dev-backend dev-backend-win dev-frontend update install install-backend install-frontend install-systemd install-nginx uninstall admin admin-remove admin-list reset-password

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

test-backend:
	cd backend && GOMEMLIMIT=12GiB go test -count=1 -p=2 -parallel=2 ./...

dev-backend:
	cd backend && DB_PATH=./data/chat.db go run .

dev-backend-win:
	cd backend && set DB_PATH=./data/chat.db && go run .

dev-frontend:
	cd frontend && npm run start

PREFIX ?= /usr/local
BINDIR ?= $(PREFIX)/bin
LIBDIR ?= /var/lib/meow-chat
WWWDIR ?= /var/www/meow-chat
SYSTEMD_DIR ?= /etc/systemd/system
NGINX_DIR ?= /etc/nginx/sites-available
MEOW_CHAT_USER ?= meow-chat

install: install-backend install-frontend install-systemd install-nginx

install-backend:
	cd backend && CGO_ENABLED=1 go build -ldflags="-X my-chat-backend/version.Version=$(shell git describe --tags --always --dirty 2>/dev/null || echo dev)" -o $(BINDIR)/meow-chat-server .

install-frontend:
	cd frontend && npm ci --omit=dev 2>/dev/null || true
	cd frontend && npx ng build --configuration production --output-path $(WWWDIR)

install-systemd:
	install -d -m 755 $(LIBDIR)/data $(LIBDIR)/uploads/avatars $(LIBDIR)/uploads/posts $(LIBDIR)/uploads/messages $(LIBDIR)/uploads/federation_cache
	install -d -m 755 /etc/meow-chat
	install -m 644 contrib/env.template /etc/meow-chat/env.template
	[ -f /etc/meow-chat.env ] || cp contrib/env.template /etc/meow-chat.env
	install -m 644 contrib/systemd/meow-chat.service $(SYSTEMD_DIR)/meow-chat.service
	systemctl daemon-reload
	systemctl enable meow-chat
	chown -R $(MEOW_CHAT_USER):$(MEOW_CHAT_USER) $(LIBDIR) 2>/dev/null || true

install-nginx:
	install -m 644 contrib/nginx/meow-chat.conf $(NGINX_DIR)/meow-chat.conf
	[ -L /etc/nginx/sites-enabled/meow-chat ] || ln -s $(NGINX_DIR)/meow-chat.conf /etc/nginx/sites-enabled/
	nginx -t && systemctl reload nginx || true

uninstall:
	systemctl stop meow-chat 2>/dev/null || true
	systemctl disable meow-chat 2>/dev/null || true
	rm -f $(SYSTEMD_DIR)/meow-chat.service
	rm -f $(BINDIR)/meow-chat-server
	rm -f $(NGINX_DIR)/meow-chat.conf
	rm -f /etc/nginx/sites-enabled/meow-chat
	rm -rf $(WWWDIR)
	systemctl daemon-reload

admin:
	docker compose exec backend ./server admin add $(filter-out $@,$(MAKECMDGOALS))

admin-remove:
	docker compose exec backend ./server admin remove $(filter-out $@,$(MAKECMDGOALS))

admin-list:
	docker compose exec backend ./server admin list

reset-password:
	docker compose exec backend ./server admin reset-password $(filter-out $@,$(MAKECMDGOALS))

push-test:
	CGO_ENABLED=1 go build -o ./bin/push-test ./cmd/push-test/ && echo "built bin/push-test"

# Prevent make from erroring on unknown targets passed as args
%:
	@:
