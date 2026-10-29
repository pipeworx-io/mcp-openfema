# mcp-openfema

OpenFEMA MCP — US Federal Emergency Management Agency open data.

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1856+ live data sources. This is an independent, unofficial integration — not affiliated with, endorsed by, or published by the upstream provider.

## Tools

| Tool | Description |
|------|-------------|
| `disaster_declarations` | Look up and COUNT US federal disaster declarations (FEMA DisasterDeclarationsSummaries). Filters: state (2-letter), incidentType (e.g. 'Fire', 'Flood', 'Hurricane', 'Severe Storm'), declarationType ('DR' major disaster, 'EM' emergency, 'FM' fire management), year (fyDeclared, the federal FISCAL year), and since/until for a real calendar date range — use since/until for questions like 'in the past year', which a fiscal year does not answer. Counts are DISTINCT DISASTERS by default, not table rows: FEMA publishes one row per disaster per designated county, so Hurricane Harvey is ~60 rows for Texas but one declaration. Pass designatedArea or grain:'area' for county-level rows. Returns the most recent first. The response echoes `filters_applied` plus a `note`: declarationType/incidentType/state/designatedArea each narrow the total to a SUBSET (e.g. declarationType:'DR' excludes 'EM' and 'FM') — for an across-all-types/all-states total, call again WITHOUT that filter rather than treating one filtered call's total as the grand total; for a true breakdown, call once per value and sum the totals yourself. |
| `query_dataset` | Generic OData query against any OpenFEMA dataset. Specify the entity name (and optionally version; defaults to the verified current version) plus OData params: filter, select, orderby, top, skip. Use list_datasets to see available entities/versions and the filter syntax. Returns { metadata, records }. |
| `list_datasets` | List the OpenFEMA datasets this pack knows about, with their entity name, current version, and a description. Also documents the OData filter syntax and response shape. Call this first to discover what query_dataset can target. |

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "openfema": {
      "url": "https://gateway.pipeworx.io/openfema/mcp"
    }
  }
}
```

### What this endpoint actually serves

`tools/list` at `https://gateway.pipeworx.io/openfema/mcp` returns the tools in the table
above **plus the shared Pipeworx meta-tools** — `ask_pipeworx`,
`discover_tools`, `search_within`, `remember`/`recall` and the rest of the
gateway-wide set. So the tool count you see is larger than this table: a
single-pack endpoint currently lists roughly 30 shared tools alongside the
pack's own. The connection's `initialize` response states its exact scope, and
is the authoritative answer for a given day.

This is deliberate, not multiplexing by accident. The meta-tools are what let a
scoped connection answer a question this pack does not cover — via
`ask_pipeworx`, which routes across the whole catalog — without you adding a
second MCP server. There is currently no way to mount a pack endpoint without
them; if the extra schemas cost you more context than the routing is worth,
connect to the full gateway once rather than to several pack endpoints.

Or connect to the full Pipeworx gateway to get every pack's tools listed
directly, instead of just this one's:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

Both URLs reach the same gateway and the same 1856+ data sources. The
only difference is which pack's tools are listed **directly**; `ask_pipeworx`
reaches all of them from either one.

## No MCP client? Call it over HTTP

```bash
curl -X POST https://gateway.pipeworx.io/v1/tools/disaster_declarations \
  -H 'Content-Type: application/json' \
  -d '{"state":"CA","year":2024}'
```

No account needed for the first calls. Inspect any tool: `GET https://gateway.pipeworx.io/v1/tools/disaster_declarations`. Find one: `POST https://gateway.pipeworx.io/v1/tools/search_packs` with `{"query":"..."}`.

## Run it from npm

`@pipeworx/mcp-openfema` is a local stdio bridge to the Pipeworx gateway: your MCP client
starts it with `npx`, and it forwards every call to the same
`https://gateway.pipeworx.io/openfema/mcp` endpoint shown above. It needs network access;
there is no offline mode.

```json
{
  "mcpServers": {
    "openfema": {
      "command": "npx",
      "args": ["-y", "@pipeworx/mcp-openfema"]
    }
  }
}
```

Without a key it calls anonymously, capped at 50 calls a day. A free account
raises that to 200 a day: get a key at https://pipeworx.io/signup and add
`"env": { "PIPEWORX_API_KEY": "<your key>" }` to the server entry.
The key is sent as a Bearer token, the same way a hosted connection sends it,
so calls are metered and billed exactly as they are there.

It lists **only** this pack's tools by default. Set `PIPEWORX_META_TOOLS=1` to
also list `ask_pipeworx` and the other gateway-wide tools.

Behind an HTTPS proxy: Node's built-in `fetch` does not read `HTTPS_PROXY` by
default. Newer Node releases honour it when `NODE_USE_ENV_PROXY=1` is set; check
your Node version's documentation.

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English —
this works on the pack endpoint above as well as on the full gateway:

```
ask_pipeworx({ question: "your question about Openfema data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
