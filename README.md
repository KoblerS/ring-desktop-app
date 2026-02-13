# Ring Desktop

An unofficial desktop application for managing Ring cameras.

## Disclaimer

**This project is not affiliated with, endorsed by, or connected to Ring LLC or Amazon.com, Inc.** Ring is a trademark of Ring LLC. This is an independent, open-source project that uses the unofficial [ring-client-api](https://github.com/dgreif/ring) to interact with Ring devices.

Use at your own risk. This project is provided "as is" without warranty of any kind.

## Features

- View all Ring cameras in one dashboard
- Live camera snapshots
- Desktop notifications for motion, doorbell, and other events
- Secure credential storage
- Two-factor authentication support

## Installation

### From Releases

Download the latest release for your platform from the [Releases](https://github.com/user/ring-desktop-app/releases) page.

### From Source

```bash
git clone https://github.com/user/ring-desktop-app.git
cd ring-desktop-app
npm install
npm run build
npm start
```

## Building

```bash
npm run package:mac   # macOS (DMG, ZIP)
npm run package:win   # Windows (Installer, Portable)
npm run package:all   # All platforms
```

## License

MIT License - see [LICENSE](LICENSE) for details.

## Acknowledgments

- [ring-client-api](https://github.com/dgreif/ring) - Unofficial Ring API client
- [Electron](https://www.electronjs.org/) - Cross-platform desktop framework
