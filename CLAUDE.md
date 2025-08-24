# Claude Code Instructions for Kaja

This file contains specific instructions for Claude Code when working on the Kaja project.

## Development Guidelines

- See [Development](README.md#development) for instructions how to run and test.
- Avoid using React.FC explicitly. Use function components instead.
- **ALWAYS run `npm run tsc` in the ui directory after making changes to TypeScript files to ensure there are no type errors**
- Use https://primer.style/product/components/ where possible, avoid using custom components.
- Add comments to only very complex or non-obvious code blocks.

## React & TypeScript Guidelines

### Component Structure

- Use function components with TypeScript interfaces for props
- Prefer explicit prop destructuring in function parameters
- Use proper TypeScript typing for all props, state, and functions

### Styling Guidelines

- **DO NOT** create separate CSS files or CSS modules
- Use inline styles with Primer CSS variables only
- When pseudo-selectors are needed (hover, scrollbar), use scoped `<style>` tags within components
- Always use Primer CSS variables (e.g., `var(--bgColor-default)`, `var(--fgColor-muted)`)
- Avoid hard-coded colors - use semantic Primer color tokens

### Primer React Usage

- The project uses Primer React v37+ where Box component is deprecated
- Replace deprecated Box components with standard HTML elements (div, span, etc.) + inline styles
- Use Primer CSS variables for consistent theming
- Leverage existing Primer components (Button, TreeView, etc.) when available

### Code Quality

- Remove redundant code and unnecessary wrapper elements
- Use consistent coding patterns across components
- Prefer semantic HTML elements over generic divs when appropriate
- Use proper cursor types for interactive elements (col-resize, row-resize)

## Project-Specific Guidelines

### File Structure

- UI components are in `/src`
- Server-side code is in `/server` (Go)
- Workspace examples are in `/workspace`

### Key Components

- **App.tsx**: Main application with ThemeProvider and dark theme
- **Task.tsx**: Editor + console layout for task execution
- **Tabs.tsx**: Tab navigation with custom scrollbar styling
- **Console.tsx**: Terminal-like output display with method call interactions
- **Gutter.tsx**: Resizable dividers between UI sections
- **Sidebar.tsx**: Project/service/method navigation tree

### Testing

- Run tests with `npm test` (Vitest)
- Follow existing test patterns in `*.test.ts` files

### Theme & Accessibility

- App uses dark theme by default (`colorMode="night"`)
- Use proper ARIA labels and semantic HTML
- Ensure keyboard navigation works properly
- Test with different theme modes if applicable

## Common Tasks

### Adding New Components

1. Create functional component with TypeScript interface
2. Use inline styles with Primer CSS variables
3. Follow existing component patterns
4. Add proper TypeScript typing
5. Ensure theme compatibility

### Debugging Style Issues

1. Check Primer CSS variable names in `/node_modules/@primer/primitives/dist/css/functional/themes/`
2. Verify ThemeProvider is working correctly
3. Use browser dev tools to inspect actual CSS variable values
4. Test across light/dark themes if supported

### Performance Considerations

- Monaco Editor is heavy - avoid unnecessary re-renders
- Use React.memo() for expensive components if needed
- Prefer CSS-in-JS over separate stylesheets for bundle optimization

## Don'ts

- ❌ Don't create separate CSS files or CSS modules
- ❌ Don't use hard-coded colors instead of Primer variables
- ❌ Don't use deprecated Box components
- ❌ Don't mix styling approaches (sx props + inline styles)
- ❌ Don't assume library availability - check imports first
- ❌ Don't break existing Monaco Editor integration
