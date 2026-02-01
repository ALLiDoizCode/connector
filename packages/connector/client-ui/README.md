# Client UI - ILP Workflow Demo Image Processor

React-based web UI for uploading images and processing them through the Interledger payment network.

## Purpose

This client UI enables users to:

- Upload images via drag-and-drop or file picker
- Select image processing steps (resize, watermark, optimize)
- View cost breakdown in millisatoshis (msat)
- Process images through the ILP workflow demo
- Download processed results

## Prerequisites

- Node.js 20.11.0 LTS
- Facilitator server running on port 3001
- npm (comes with Node.js)

## Development

Start the development server:

```bash
npm run dev
```

The UI will be available at http://localhost:3000

## Build

Build for production:

```bash
npm run build
```

Output will be in `dist/` directory.

## Testing

Run unit tests:

```bash
npm test
```

Run tests in watch mode:

```bash
npm run test:watch
```

Run linting:

```bash
npm run lint
```

## Architecture

### Components

- **App.tsx** - Main application component with workflow state machine
- **ImageUploader.tsx** - File upload with drag-and-drop support
- **ProcessingOptions.tsx** - Step selection with cost calculation
- **ResultViewer.tsx** - Before/after image display with download
- **ProcessingIndicator.tsx** - Loading spinner with progress feedback

### API Client

- **api-client.ts** - Facilitator API integration with error handling

### UI Library

Uses shadcn/ui v4 components:

- Card - Layout containers
- Button - Actions (process, download, retry)
- Checkbox - Step selection
- Progress - Loading indicator
- Label - Form labels

## Workflow States

1. **Upload** - User selects image and processing options
2. **Processing** - API call in progress, spinner displayed
3. **Result** - Before/after images with download button
4. **Error** - Error message with retry/start over options

## Configuration

The UI proxies API requests to the facilitator server:

- Dev proxy: `http://localhost:3001/api/*`
- Configured in `vite.config.ts`

## File Upload Limits

- **Max file size**: 10MB
- **Supported formats**: PNG, JPEG, WebP
- Validation occurs client-side before API call

## Processing Costs

| Step                  | Cost         |
| --------------------- | ------------ |
| Resize to 800x600     | 100 msat     |
| Add watermark         | 200 msat     |
| Optimize file size    | 150 msat     |
| **Total (all steps)** | **450 msat** |

## Troubleshooting

### Facilitator API not responding

Verify the facilitator server is running:

```bash
# From the connector package directory
npm run dev:facilitator
```

The facilitator should be listening on port 3001.

### CORS errors

Ensure the facilitator has CORS configured for `localhost:3000`:

```typescript
// In facilitator server configuration
cors: {
  origin: ['http://localhost:3000', 'http://localhost:5173'];
}
```

### Build errors

Clear node_modules and reinstall:

```bash
rm -rf node_modules package-lock.json
npm install
```

### Tests failing

Ensure test dependencies are installed:

```bash
npm install
```

Run tests with verbose output:

```bash
npm test -- --reporter=verbose
```

## Screenshots

### Upload Screen

![Upload Screen](.playwright-mcp/client-ui-initial-state.png)

The upload screen shows:

- Drag-and-drop upload area
- Processing options with checkboxes
- Cost breakdown
- Disabled "Process Image" button (enabled when file selected)

### Processing Screen

(Placeholder - displays loading spinner with "Processing pipeline..." message)

### Result Screen

(Placeholder - displays before/after images side-by-side with download button)

## Technology Stack

- React 18.3.1
- TypeScript 5.3.3
- Vite 6.x (build tool)
- Tailwind CSS 3.4.19
- shadcn/ui v4 (component library)
- Vitest (testing framework)

## License

MIT
