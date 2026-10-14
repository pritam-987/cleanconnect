# CleanConnect

A simple web-based platform for residents to report garbage, and for cleanup teams to track and complete cleanup tasks. Admins can monitor areas and manage reports.

## Description

CleanConnect is a citizen reporting system designed to help communities track and manage garbage/cleanup issues. Residents can create accounts, submit reports with photos of garbage in their area, and track the status of their reports. Designated cleanup teams can accept and complete tasks assigned to their ward. Administrators can oversee all reports, adjust priorities, assign teams, and view area dashboards with hotspot information.

The application runs as a simple Node.js server with a static frontend - no database setup required for local development. Data is stored in a local JSON file, making it easy to get started for demonstrations or small-scale use.

**Note:** This is a demo/prototype implementation. It is not production-ready (see limitations section below).

## Screenshots

![CleanConnect Screenshot](public/screenshot.png)

*Add a screenshot of the application here*

## Getting Started

### Dependencies

- **Node.js**: Version 18+ is required
- **Operating System**: Works on Windows, macOS, or Linux
- No external package installation required (`npm install` not needed)

### Installing

1. Clone or download this repository to your local machine
2. Navigate to the project directory (`/mnt/d/temp`)
3. No modifications are needed to files or folders for local development

### Executing program

To run the program locally:

1. Start the server:
   ```bash
   node server.js
   ```

2. Open your browser and navigate to:
   ```text
   http://localhost:3000
   ```

3. **Important:** Always access the site through the server (not by double-clicking `index.html`). The pages call API endpoints (`/api`) which require the server to be running.

#### First-time setup notes

- On first start, the console will print passwords for:
  - `admin@demo.local` (Admin)
  - `t1@demo.local` (Riverside team)
  - `t2@demo.local` (Old Market team) 
  - `t3@demo.local` (Hillview teams)

- **Residents:** Create your own account via "Sign in" → "Create a resident account"

- **To reset data:** Stop the server and delete `data.json` and `uploads/` folders

## Usage Demo Guide

1. **Resident:** Sign up, report garbage (photo required), open the report, support other reports, view "My Reports"
2. **Team account** (matching the ward you reported in): Go to "Team Tasks", open the task, click "Accept and start cleanup", then "Mark cleanup completed" (optional photo). Each action requires confirmation.
3. **Back as resident:** Open the completed report and submit a rating (only the original reporter can do this once)
4. **Admin:** Change priority, assign or reassign teams, view the Area Dashboard and hotspots

## Help

### Common issues

- **Pages don't load properly:** Make sure you're accessing via `http://localhost:3000` through the running server, not by opening `index.html` directly.
- **API errors:** The server must be running. Check the console for any errors.
- **Lost demo passwords:** Delete `data.json` and restart the server to regenerate demo account passwords.
- **Photo uploads fail:** Photos are automatically compressed in the browser. Keep image sizes reasonable.

### Additional help

For Vercel deployment instructions, see [VERCEL-SETUP.md](VERCEL-SETUP.md).

## Limitations

This is **not production-ready**. Known limitations include:

- No email verification or moderation
- No HTTPS (local only)
- No real database (uses `data.json` file)
- Session tokens stored in browser localStorage
- No notifications or automated dispatching
- Hotspots use simple text matching on ward/landmark (hint only)
- Concurrent edits can overwrite each other
- Login attempt limiting is per-server-instance only
- No merging of hotspots, no editing of team-to-ward mappings, no sample data seeding

## License

This project is licensed under the MIT License - see the LICENSE.md file for details.