# Studio editor stand

Standalone browser preview of the Studio text editor in its clean, empty state. Use the testbench controls to preview real Studio status messages and confirmation dialogs without changing the application.

The status selector covers send, draft storage, attachment, text import, chat lookup, version history, chat preview, connection, Telegram rate-limit, schedule warning, mass scheduling, progress, and success states. On medium and wide viewports, status text remains on one line; overflowing text is shortened with an ellipsis, while the complete message remains available on hover.

Build it from the repository root with:

```powershell
npx vite build testbenches/studio-editor --config vite.config.ts --outDir "../../../Stands/Studio Editor Stand" --emptyOutDir
```