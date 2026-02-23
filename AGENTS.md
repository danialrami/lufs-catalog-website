# AGENTS.md

## Build Commands
- **Development Server**: `npm run dev`
  ```bash
  npm run dev
  ```

- **Build Production**: `npm run build`
  ```bash
  npm run build
  ```

- **Preview Production**: `npm run preview`
  ```bash
  npm run preview
  ```

## Testing Commands
Since this is an Astro/Svelte project, testing involves manual verification in development mode:
1. Run `npm run dev`.
2. Navigate to the component/page.
3. Verify behavior interactively.

For single-component testing, open a browser tab with `npm run dev` and inspect the page directly.

## Linting & Type Checking
- **Type Check**: `npm run astro`
  ```bash
  npm run astro
  ```

- **Format Check**: Use tools like Prettier if configured. If not, manually enforce formatting (e.g., 2-space indentation).

## Code Style Guidelines
### Imports
- Relative imports for Svelte/Astro components.
- Explicitly import third-party libraries (e.g., `@astrojs/svelte`).
- Avoid circular dependencies; refactor if needed.

### Formatting
- **Indentation**: 2 spaces.
- **Line Length**: Max 100 characters per line.
- **Quotes**: Double quotes (`"` and `"`) in JS/TS files.

### Naming Conventions
- **Components**: PascalCase (e.g., `MyComponent.svelte`).
- **Variables & Functions**: camelCase (e.g., `myFunction()`).
- **Constants**: UPPER_CASE if applicable (e.g., `MAX_LENGTH = 100`).

### Error Handling
- Gracefully handle missing props.
- Log errors in development mode:
  ```svelte
  <script>
    if (error) console.error(error);
  </script>
  ```

## TypeScript Support
- Use `@types/node` and `typescript`.
- Leverage Svelte’s built-in types for components.

## Rules & Best Practices
No specific rules files found. Follow Astro/Svelte conventions:
- Prefer `@astrojs/svelte` for Svelte integration.
- Use `svelte.config.js` if present for component configurations.