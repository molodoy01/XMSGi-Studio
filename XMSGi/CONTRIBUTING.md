# Contributing

Thanks for helping improve XMSGi Studio.

## How to contribute

- keep changes focused and small
- prefer clear, testable fixes over broad refactors
- document behavioral changes when they affect users or workflows
- add or update tests for bug fixes and regression coverage

## Development workflow

```bash
npm install
npm test -- --run
npm run build
```

## Pull request expectations

- explain the problem and the fix
- include validation evidence from tests or build output
- keep the scope narrow and reviewable
- avoid unrelated formatting churn

## Code quality

- maintain TypeScript safety
- keep Electron and UI changes compatible with the desktop app model
- respect local-storage and privacy constraints

We review contributions that improve reliability, clarity, and security.
