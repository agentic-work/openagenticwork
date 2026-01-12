# GitHub Repository Settings

This document describes the recommended GitHub repository settings for OpenAgenticWork.

## Repository Settings

### General
- **Repository name:** openagenticwork
- **Visibility:** Public
- **Features:**
  - [x] Issues
  - [x] Discussions (optional)
  - [ ] Wiki (disabled)
  - [ ] Projects (disabled)

### Branch Protection Rules

#### `main` branch
1. Go to Settings > Branches > Add rule
2. Branch name pattern: `main`
3. Enable:
   - [x] Require a pull request before merging
   - [x] Require approvals (1)
   - [x] Dismiss stale pull request approvals when new commits are pushed
   - [x] Require review from Code Owners
   - [x] Require status checks to pass before merging
   - [x] Require branches to be up to date before merging
   - [x] Do not allow bypassing the above settings
   - [x] Restrict who can push to matching branches
     - Only allow: Agenticwork team members

### Access and Permissions

#### Collaborators and Teams
- **Agenticwork Team:** Admin (can merge PRs)
- **External Contributors:** Read (can create issues and PRs, cannot merge)

#### Actions
- Allow all actions and reusable workflows
- Require approval for first-time contributors

### Notifications

#### Email Notifications
Configure notifications to be sent to `support@agenticwork.io`:

1. Go to Settings > Notifications
2. Under "Email addresses", add: `support@agenticwork.io`
3. Enable notifications for:
   - [x] Issues
   - [x] Pull requests
   - [x] Discussions (if enabled)
   - [x] Security alerts

#### Alternative: GitHub Actions Notification
Add this workflow to `.github/workflows/notify.yml` for custom notifications:

```yaml
name: Notify on Issue/PR

on:
  issues:
    types: [opened, reopened]
  pull_request:
    types: [opened, reopened]

jobs:
  notify:
    runs-on: ubuntu-latest
    steps:
      - name: Send email notification
        uses: dawidd6/action-send-mail@v3
        with:
          server_address: smtp.example.com
          server_port: 587
          username: ${{ secrets.SMTP_USERNAME }}
          password: ${{ secrets.SMTP_PASSWORD }}
          subject: |
            [${{ github.event_name }}] ${{ github.event.issue.title || github.event.pull_request.title }}
          to: support@agenticwork.io
          from: GitHub Actions
          body: |
            New ${{ github.event_name }} in OpenAgenticWork:
            ${{ github.event.issue.html_url || github.event.pull_request.html_url }}
```

### Code Owners

Create `.github/CODEOWNERS`:
```
# Default owners for everything in the repo
* @agentic-work/core-team
```

### Security

1. Enable Dependabot alerts
2. Enable Dependabot security updates
3. Enable secret scanning
4. Enable push protection

## Quick Setup Checklist

- [ ] Create repository at https://github.com/agentic-work/openagenticwork
- [ ] Set repository to public
- [ ] Enable Issues
- [ ] Add branch protection for `main`
- [ ] Add team with admin access
- [ ] Configure email notifications
- [ ] Add CODEOWNERS file
- [ ] Enable security features

---
Copyright (c) 2026 Agenticwork LLC
https://agenticwork.io
