# Session 2026-06-23 — LeanKG + MCP servers setup

## LeanKG установка
- Установлен LeanKG v0.17.4 на Windows (бинарник из GitHub releases)
- Выполнена инициализация (`leankg init`) и индексация (`leankg index .`)
- **107 файлов**, **1975 элементов**, **6744 связей**, **42 документа**

## Вынос сессий из AGENTS.md
- AGENTS.md сокращён с 376 до ~100 строк (только Stack, Structure, Commands, Key quirks)
- 23 сессии вынесены в `docs/sessions/2026-*-*.md`
- LeanKG переиндексирован — теперь покрывает сессии

## MCP серверы установлены в `~/.config/opencode/opencode.jsonc`

| MCP | Пакет | Статус |
|-----|-------|--------|
| **LeanKG** | `leankg mcp-stdio --watch` | ✅ |
| **SQLite** | `npx mcp-sqlite <db_path>` | ✅ |
| **Context7** | `@upstash/context7-mcp` | ✅ |
| **gopls** | `gopls-mcp -workspace backend -transport stdio` | ✅ |
| **GitHub** | `@modelcontextprotocol/server-github` | ⚠️ требует GITHUB_PERSONAL_ACCESS_TOKEN |

### Установка GitHub токена (PowerShell):
```powershell
[Environment]::SetEnvironmentVariable("GITHUB_PERSONAL_ACCESS_TOKEN", "ghp_ваш_токен", "User")
```
