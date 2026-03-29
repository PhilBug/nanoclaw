---
name: health
description: System health report — Docker, channels, queue, and container error rates. Read-only.
---

# /health — System Health Report

Generate a health report based on the orchestrator's health snapshot.

**Main-channel check:** Only the main channel has `/workspace/project` mounted. Run:

```bash
test -d /workspace/project && echo "MAIN" || echo "NOT_MAIN"
```

If `NOT_MAIN`, respond with:
> This command is available in your main chat only. Send `/health` there to see system health.

Then stop — do not generate the report.

## How to gather the information

The health monitor writes a snapshot to the IPC directory every 30 seconds. Read it:

```bash
cat /workspace/ipc/health_snapshot.json 2>/dev/null || echo "NO_SNAPSHOT"
```

If `NO_SNAPSHOT`, the health monitor may not be running yet. Report this to the user.

## Report format

Parse the JSON and present as:

```
🏥 *System Health*

*Docker:* ✅ OK (Xms latency) / 🔴 UNREACHABLE
*Uptime:* Xh Xm
*Channels:*
• Telegram: ✅ connected / ❌ disconnected
• WhatsApp: ✅ connected / ❌ disconnected
(list all channels from the snapshot)

*Queue:*
• Active containers: X/5
• Waiting groups: X

*Container Errors:*
• Last 30min: X errors (threshold: 5)

*Last Check:* YYYY-MM-DD HH:MM:SS
```

Use ✅ for healthy/ok, 🔴 for critical, 🟡 for warning, ⚪ for info.

If Docker is unreachable, highlight it prominently — this is the most critical check.
