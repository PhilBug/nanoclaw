---
name: container-control
description: Manage whitelisted external Docker containers (restart, stop, recreate, logs). Main group only.
allowed-tools: Bash(mcp__nanoclaw__container_cmd *)
---

# Container Control

Manage external Docker containers from the main group. Containers must be listed in the allowlist (`~/.config/nanoclaw/container-allowlist.json`).

## Available Actions

| Action | Description | Parameters |
|--------|-------------|------------|
| `restart` | Restart a container | — |
| `stop` | Stop a container | — |
| `recreate` | Recreate from compose file (requires composeFile/service in allowlist) | — |
| `logs` | Fetch container logs | `lines` (optional, default 100) |

## Usage

Use the `container_cmd` MCP tool:

```
mcp__nanoclaw__container_cmd(container="traszka-search", action="restart")
mcp__nanoclaw__container_cmd(container="traszka-search", action="logs", lines=50)
mcp__nanoclaw__container_cmd(container="traszka-search", action="stop")
mcp__nanoclaw__container_cmd(container="traszka-search", action="recreate")
```

## Allowlist

Only containers listed in `~/.config/nanoclaw/container-allowlist.json` can be managed. Example:

```json
{
  "traszka-search": {
    "composeFile": "/opt/traszka-search/docker-compose.yml",
    "service": "traszka-search"
  }
}
```

- `composeFile` and `service` are optional — only needed for the `recreate` action.
- To add new containers, edit the allowlist file on the host.

## Restrictions

- Main group only — non-main groups receive an access denied error.
- Only the four actions listed above are supported.
- Container names are validated against a strict regex (`^[a-zA-Z0-9][a-zA-Z0-9_.-]*$`).
