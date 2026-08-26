# mcp-openfema

OpenFEMA MCP — US Federal Emergency Management Agency open data.

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1476+ live data sources.

## Tools

| Tool | Description |
|------|-------------|
| `disaster_declarations` | Look up and COUNT US federal disaster declarations (FEMA DisasterDeclarationsSummaries). Filters: state (2-letter), incidentType (e.g. 'Fire', 'Flood', 'Hurricane', 'Severe Storm'), declarationType ('DR' major disaster, 'EM' emergency, 'FM' fire management), year (fyDeclared, the federal FISCAL year), and since/until for a real calendar date range — use since/until for questions like 'in the past year', which a fiscal year does not answer. Counts are DISTINCT DISASTERS by default, not table rows: FEMA publishes one row per disaster per designated county, so Hurricane Harvey is ~60 rows for Texas but one declaration. Pass designatedArea or grain:'area' for county-level rows. Returns the most recent first. |
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

Both URLs reach the same gateway and the same 1476+ data sources. The
only difference is which pack's tools are listed **directly**; `ask_pipeworx`
reaches all of them from either one.

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
