# Electron Screen Recorder

A modern screen recording application built with Electron, React, and Vite.

## Features

- 🎥 Screen recording with audio
- 🎨 Modern UI with Tailwind CSS
- 🌓 Light/Dark mode support
- 💾 Save recordings locally
- ⚡ Fast and lightweight

## Prerequisites

- Node.js (v18 or higher)
- npm or pnpm
- FFmpeg (automatically installed via dependencies)

## Installation

```bash
# Clone the repository
git clone [your-repo-url]
cd electron-screen-recorder

# Install dependencies
npm install
# or if using pnpm
pnpm install
```

## Development

```bash
# Start the development server
npm run start
# or
pnpm start
```

This will:
1. Start Vite dev server
2. Launch Electron in development mode
3. Enable hot reload for both frontend and Electron

## Building

### For macOS

```bash
# Build for macOS
npm run package
# or
pnpm package
```

### For Windows and macOS

```bash
# Build for both platforms
npm run make
# or
pnpm make
```

The built applications will be available in:
- `dist/` - Vite build output
- `out/` - Electron packaged applications

## Scripts

- `npm run dev` - Start Vite development server
- `npm run build` - Build the Vite application
- `npm run preview` - Preview the built application
- `npm run electron:dev` - Start Electron in development mode
- `npm run start` - Start both Vite and Electron for development
- `npm run electron:build` - Build Electron application
- `npm run package` - Package for macOS
- `npm run make` - Package for Windows and macOS

## Tech Stack

- Electron
- React
- Vite
- TypeScript
- Tailwind CSS
- FFmpeg
- Radix UI Components

## Project Structure

```
electron-screen-recorder/
├── src/               # Source files
│   ├── components/    # React components
│   ├── styles/        # Global styles
│   └── ...
├── public/           # Static assets
├── main.js           # Electron main process
├── preload.js        # Electron preload script
└── vite.config.ts    # Vite configuration
```

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details
