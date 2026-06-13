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

dev-backend:
	cd backend && DB_PATH=./data/chat.db go run .

dev-backend-win:
	cd backend && set DB_PATH=./data/chat.db && go run .

dev-frontend:
	cd frontend && npm run start

PREFIX ?= /usr/local
BINDIR ?= $(PREFIX)/bin
LIBDIR ?= /var/lib/my-chat
WWWDIR ?= /var/www/my-chat
SYSTEMD_DIR ?= /etc/systemd/system
NGINX_DIR ?= /etc/nginx/sites-available
MY_CHAT_USER ?= my-chat

install: install-backend install-frontend install-systemd install-nginx

install-backend:
	cd backend && CGO_ENABLED=1 go build -ldflags="-X my-chat-backend/version.Version=$(shell git describe --tags --always --dirty 2>/dev/null || echo dev)" -o $(BINDIR)/my-chat-server .

install-frontend:
	cd frontend && npm ci --omit=dev 2>/dev/null || true
	cd frontend && npx ng build --configuration production --output-path $(WWWDIR)

install-systemd:
	install -d -m 755 $(LIBDIR)/data $(LIBDIR)/uploads/avatars $(LIBDIR)/uploads/posts $(LIBDIR)/uploads/messages $(LIBDIR)/uploads/federation_cache
	install -d -m 755 /etc/my-chat
	install -m 644 contrib/env.template /etc/my-chat/env.template
	[ -f /etc/my-chat.env ] || cp contrib/env.template /etc/my-chat.env
	install -m 644 contrib/systemd/my-chat.service $(SYSTEMD_DIR)/my-chat.service
	systemctl daemon-reload
	systemctl enable my-chat
	chown -R $(MY_CHAT_USER):$(MY_CHAT_USER) $(LIBDIR) 2>/dev/null || true

install-nginx:
	install -m 644 contrib/nginx/my-chat.conf $(NGINX_DIR)/my-chat.conf
	[ -L /etc/nginx/sites-enabled/my-chat ] || ln -s $(NGINX_DIR)/my-chat.conf /etc/nginx/sites-enabled/
	nginx -t && systemctl reload nginx || true

uninstall:
	systemctl stop my-chat 2>/dev/null || true
	systemctl disable my-chat 2>/dev/null || true
	rm -f $(SYSTEMD_DIR)/my-chat.service
	rm -f $(BINDIR)/my-chat-server
	rm -f $(NGINX_DIR)/my-chat.conf
	rm -f /etc/nginx/sites-enabled/my-chat
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

# Prevent make from erroring on unknown targets passed as args
%:
	@:
