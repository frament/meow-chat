# 2026-06-27: Admin stickers tab, sidebar layout, paste images

## Changes

### `frontend/src/app/components/admin/admin.ts`
- Added stickers management tab to admin panel (create/delete pack, upload/delete sticker)
- Refactored desktop layout from horizontal tabs to sidebar navigation
- Mobile keeps the dropdown selector
- Fixed `createStickerPack` error handling — logs errors to console, shows detailed message

### `frontend/src/app/components/chat/chat.ts`
- Added `(paste)="onPaste($event)"` handler on message input (both desktop and mobile)
- `onPaste` reads image files from `clipboardData.items`, adds to `selectedFiles`/`previews`, switches to image type
- Enables iOS sticker paste support

## Files changed
- `frontend/src/app/components/admin/admin.ts`
- `frontend/src/app/components/chat/chat.ts`
