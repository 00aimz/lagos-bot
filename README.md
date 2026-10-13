# lagos-bot
Lagos Bot - Automated Drain Engine 🤖💸
An automated Node.js script designed to process accounts continuously, manage states, and transfer balances to a target user ID. It features randomized account ordering, automatic account booting/rebooting, and optional hourly Discord status reports.
Features
 * Continuous Randomized Loop: Automatically shuffles and cycles through accounts stored in ./store/.
 * Auto-Boot & Repair: Automatically initializes fresh game states and resets depleted accounts using a template profile.
 * Hourly Discord Reports: Sends aggregate status updates and session totals once an hour via a Discord Webhook.
 * Secure Configuration: Fully driven by environment variables and GitHub Actions Secrets (no hardcoded credentials).
 * Graceful Shutdown: Configurable execution limits (DURATION_HOURS) to prevent sudden timeouts on cloud runners like GitHub Actions.
Project Structure
├── .github/
│   └── workflows/
│       └── drainer.yml    # GitHub Actions workflow configuration
├── store/
│   └── accs.json          # JSON file containing your account ledger [{u: "...", p: "..."}, ...]
├── job.js                 # Main bot engine script
└── README.md              # Project documentation

Local Setup & Installation
 * Clone the repository:
   git clone https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
cd YOUR_REPO_NAME

 * Install Node.js: Ensure you have Node.js (v18 or v20+ recommended) installed.
 * Create the store folder & add accounts:
   Create a folder named store and place your account JSON files inside it (e.g., store/accs1.json).
   Account files should follow this format:
   [
  { "u": "username1", "p": "password123" },
  { "u": "username2", "p": "password456" }
]

 * Run Locally:
   Set your environment variables before starting:
   # On Linux/macOS
export TO="your_destination_user_id"
export DISCORD_WEBHOOK_URL="your_webhook_url_here" # Optional
export DURATION_HOURS="0" # 0 for infinite, or set a limit
node job.js

# On Windows (PowerShell)
$env:TO="your_destination_user_id"
$env:DISCORD_WEBHOOK_URL="your_webhook_url_here"
$env:DURATION_HOURS="0"
node job.js

Cloud Deployment (GitHub Actions)
This project includes a pre-configured GitHub Actions workflow (.github/workflows/drainer.yml) that runs automatically on a schedule or can be triggered manually.
Step 1: Configure Repository Secrets
To keep your data safe and private, never hardcode webhooks or IDs. Instead, configure GitHub Secrets:
 * Go to your GitHub Repository.
 * Click on Settings > Secrets and variables > Actions.
 * Click New repository secret and add the following keys:
   * TO_DESTINATION_ID: The recipient user ID where balances are sent.
   * DISCORD_WEBHOOK_URL: Your Discord webhook URL for hourly reports (optional; if omitted, the bot runs silently without errors).
Step 2: Push Your Code
Push your code and store files to your GitHub repository.
Step 3: Trigger the Workflow
 * Automatically: The cron job in drainer.yml runs every 6 hours (0 */6 * * *).
 * Manually: Go to the Actions tab on GitHub, select Lagos Bot Cloud Drainer, and click Run workflow.
Safety & Configuration Notes
 * Optional Webhook: If you don't supply a DISCORD_WEBHOOK_URL, the script will skip notifications entirely and continue running smoothly in the background.
 * GitHub Actions Limit: GitHub Actions workflows have a hard timeout limit of 6 hours per job. The workflow sets DURATION_HOURS: "5.5" to ensure the bot shuts down gracefully right before the limit is reached.
