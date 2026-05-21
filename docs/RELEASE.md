# Release

## Private staging

1. Run `npm install`
2. Run `npm test`
3. Run `node --check src/cli.js && node --check src/index.js`
4. Run `npm pack --json --dry-run`
5. Run `npm publish --dry-run --access public`
6. Confirm `skills/agentor` mirrors the embedded project skill
7. Push GitHub repo as private first

## Public launch

1. Publish npm package `@builtbyecho/agentor`
2. Publish ClawHub skill with matching version
3. Add any hosted docs, x402 routes, or launch assets
4. Tag GitHub release
