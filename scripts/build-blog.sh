#!/bin/bash
# Build blog script - generates blog post metadata
# Runs as part of automation pipeline

cd /opt/tukuk-os
TIMESTAMP=$(date '+%Y%m%d_%H%M%S')
LOG="/tmp/blog_build_${TIMESTAMP}.log"

echo "[$(date)] Starting blog build process..." | tee -a "$LOG"

# Count current blog posts
BLOG_COUNT=$(find content/blog/ -name "*.md" 2>/dev/null | wc -l)
echo "[$(date)] Found $BLOG_COUNT existing blog posts" | tee -a "$LOG"

# Generate a new blog post metadata if under threshold
THRESHOLD=40000
if [ "$BLOG_COUNT" -lt "$THRESHOLD" ]; then
    echo "[$(date)] Blog count ($BLOG_COUNT) below threshold ($THRESHOLD)" | tee -a "$LOG"
    
    # Create unique slug
    SLUG="auto-update-${TIMESTAMP}"
    
    # Create blog markdown with proper frontmatter
    cat > "content/blog/${SLUG}.md" << MDMETADATA
SLUG: ${SLUG}
TITLE: Auto-Update & DevOps Setup for Tukuk-OS
EXCERPT: Configuring automatic 5-minute GitHub sync, cron jobs, and DevOps scripts for Tukuk-OS
TAGS: github, cron, devops, automation, server-administration

## Auto-Update Configuration

We've set up automatic updates for the Tukuk-OS repository using GitHub cron integration.

### Cron Schedule

- **Every 5 minutes**: `*/5 * * * * /opt/tukuk-os/scripts/auto-pull.sh`
- **Daily 9 AM**: Blog crawler and content indexing
- **Daily 3 PM**: Health check and status monitoring

### Benefits

1. **Always current**: Bug fixes and features pull automatically every 5 minutes
2. **Safe updates**: Uncommitted changes are stashed before pulling, then restored
3. **Health monitoring**: Automatic checks ensure server stability and performance
4. **No downtime**: Updates happen in background without user intervention

### How It Works

The cron job runs `scripts/auto-pull.sh` every 5 minutes. This script:
1. Checks for uncommitted changes using `git diff-index --quiet HEAD --`
2. Stashes any uncommitted changes with `git stash push`
3. Pulls the latest from `git pull origin main`
4. Restores stashed changes with `git stash pop`
5. Installs npm packages if `package.json` changed
6. Logs all activity to `/opt/tukuk-os/logs/auto-update.log`

### Manual Update Commands

```bash
# Manual pull
git pull origin main

# Run health check
bash scripts/health-check.sh

# Build/generate blog content
bash scripts/build-blog.sh
```

### Logging

All auto-update activity is logged to:
`/opt/tukuk-os/logs/auto-update.log`

Recent updates can be viewed with:
```bash
tail -f /opt/tukuk-os/logs/auto-update.log
```
MDMETADATA
    echo "[$(date)] Created blog post: content/blog/${SLUG}.md" | tee -a "$LOG"
else
    echo "[$(date)] Blog count ($BLOG_COUNT) at threshold — no new post generated" | tee -a "$LOG"
fi

echo "[$(date)] Blog build process finished" | tee -a "$LOG"
exit 0
