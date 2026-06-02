interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * OpenFEMA MCP — US Federal Emergency Management Agency open data.
 *
 * Keyless. API base: https://www.fema.gov/api/open
 *
 * OData-style query params on every dataset endpoint:
 *   $top, $skip, $filter, $select, $orderby, $inlinecount=allpages, $format=json
 *
 * Filter syntax (OData):
 *   field eq 'value'        (string values are single-quoted)
 *   field eq 2024           (numbers/booleans unquoted)
 *   <expr> and <expr>       (combine with `and` / `or`)
 *   e.g. "state eq 'TX' and fyDeclared eq 2023 and incidentType eq 'Fire'"
 *
 * Datasets are VERSIONED (v1/v2/v4 etc.) — each entity has its own current
 * version; the version is part of the path (/v2/DisasterDeclarationsSummaries).
 *
 * Response shape: { metadata: { count, skip, top, ... }, <EntityName>: [...records] }
 * Records live under a key named exactly after the entity (e.g. response.DisasterDeclarationsSummaries).
 */


const BASE = 'https://www.fema.gov/api/open';
const UA = 'pipeworx-mcp-openfema/1.0 (+https://pipeworx.io)';

// Verified live 2026-06: entity name -> current version path segment.
const DATASETS: Record<string, { version: string; description: string }> = {
  DisasterDeclarationsSummaries: {
    version: 'v2',
    description: 'One row per declared disaster + designated area (state, incidentType, declarationType DR/EM/FM, fyDeclared, programs declared).',
  },
  FemaWebDisasterDeclarations: {
    version: 'v1',
    description: 'Disaster-level declaration summary (disasterName, dates, stateName, incidentType).',
  },
  PublicAssistanceFundedProjectsDetails: {
    version: 'v2',
    description: 'Public Assistance grant project detail (applicant, damage category, federal share obligated).',
  },
  IndividualsAndHouseholdsProgramValidRegistrations: {
    version: 'v2',
    description: 'Individuals & Households Program valid registrations (county/fips, damaged location, assistance amounts). Very large.',
  },
  HazardMitigationAssistanceProjects: {
    version: 'v4',
    description: 'Hazard Mitigation Assistance funded projects (programArea, state, county, project amounts).',
  },
  MissionAssignments: {
    version: 'v2',
    description: 'Inter-agency Mission Assignments tied to disasters (supportFunction, agency, obligation amounts).',
  },
  FemaRegions: {
    version: 'v2',
    description: 'The 10 FEMA regions + national office (region number, address, member states). Small reference table.',
  },
};

const ODATA_PARAMS = ['$filter', '$select', '$orderby', '$top', '$skip'];

const tools: McpToolExport['tools'] = [
  {
    name: 'disaster_declarations',
    description:
      "Look up FEMA disaster declarations (DisasterDeclarationsSummaries). Convenience filters for state (2-letter), year (fyDeclared, the federal fiscal year of declaration), incidentType (e.g. 'Fire', 'Flood', 'Hurricane', 'Severe Storm'), and declarationType ('DR' major disaster, 'EM' emergency, 'FM' fire management). Returns the most recent first by default.",
    inputSchema: {
      type: 'object',
      properties: {
        state: { type: 'string', description: "2-letter state/territory code, e.g. 'CA', 'TX'." },
        year: { type: 'integer', description: 'Fiscal year declared (fyDeclared), e.g. 2024.' },
        incidentType: { type: 'string', description: "Incident type, e.g. 'Fire', 'Flood', 'Hurricane', 'Severe Storm'." },
        declarationType: { type: 'string', description: "'DR' (major disaster), 'EM' (emergency), or 'FM' (fire management)." },
        limit: { type: 'integer', description: 'Max records (default 50, max 1000).' },
        orderby: { type: 'string', description: "OData $orderby, default 'declarationDate desc'." },
      },
    },
  },
  {
    name: 'query_dataset',
    description:
      'Generic OData query against any OpenFEMA dataset. Specify the entity name (and optionally version; defaults to the verified current version) plus OData params: filter, select, orderby, top, skip. Use list_datasets to see available entities/versions and the filter syntax. Returns { metadata, records }.',
    inputSchema: {
      type: 'object',
      properties: {
        entity: { type: 'string', description: "Dataset entity name, e.g. 'PublicAssistanceFundedProjectsDetails'." },
        version: { type: 'string', description: "Path version like 'v1'/'v2'/'v4'. Optional — defaults to the verified current version for known entities." },
        filter: { type: 'string', description: "OData $filter, e.g. \"state eq 'TX' and fyDeclared eq 2023\"." },
        select: { type: 'string', description: 'Comma-separated $select fields, e.g. "disasterNumber,state,incidentType".' },
        orderby: { type: 'string', description: "OData $orderby, e.g. 'declarationDate desc'." },
        top: { type: 'integer', description: 'Max records ($top, default 50, max 1000).' },
        skip: { type: 'integer', description: 'Records to skip ($skip) for paging.' },
      },
      required: ['entity'],
    },
  },
  {
    name: 'list_datasets',
    description:
      'List the OpenFEMA datasets this pack knows about, with their entity name, current version, and a description. Also documents the OData filter syntax and response shape. Call this first to discover what query_dataset can target.',
    inputSchema: { type: 'object', properties: {} },
  },
];

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'disaster_declarations': {
      const clauses: string[] = [];
      const state = args.state as string | undefined;
      const incidentType = args.incidentType as string | undefined;
      const declarationType = args.declarationType as string | undefined;
      const year = args.year;
      if (state?.trim()) clauses.push(`state eq '${odataEscape(state.trim().toUpperCase())}'`);
      if (typeof year === 'number') clauses.push(`fyDeclared eq ${Math.trunc(year)}`);
      if (incidentType?.trim()) clauses.push(`incidentType eq '${odataEscape(incidentType.trim())}'`);
      if (declarationType?.trim()) clauses.push(`declarationType eq '${odataEscape(declarationType.trim().toUpperCase())}'`);

      const params: Record<string, string> = {
        $top: String(clampLimit(args.limit)),
        $orderby: (args.orderby as string | undefined)?.trim() || 'declarationDate desc',
        $inlinecount: 'allpages',
      };
      if (clauses.length) params.$filter = clauses.join(' and ');
      return femaQuery('DisasterDeclarationsSummaries', 'v2', params);
    }
    case 'query_dataset': {
      const entity = reqStr(args, 'entity', '"DisasterDeclarationsSummaries"').trim();
      const known = DATASETS[entity];
      const version = ((args.version as string | undefined)?.trim() || known?.version);
      if (!version) {
        throw new Error(
          `Unknown entity "${entity}". Pass a version (e.g. "v2"), or use one of: ${Object.keys(DATASETS).join(', ')}. Call list_datasets for details.`,
        );
      }
      const params: Record<string, string> = { $inlinecount: 'allpages' };
      if ((args.filter as string | undefined)?.trim()) params.$filter = (args.filter as string).trim();
      if ((args.select as string | undefined)?.trim()) params.$select = (args.select as string).trim();
      if ((args.orderby as string | undefined)?.trim()) params.$orderby = (args.orderby as string).trim();
      params.$top = String(clampLimit(args.top));
      if (typeof args.skip === 'number' && args.skip > 0) params.$skip = String(Math.trunc(args.skip));
      return femaQuery(entity, version, params);
    }
    case 'list_datasets': {
      return {
        apiBase: BASE,
        note: 'Datasets are versioned (v1/v2/v4...). Records are returned under a key named exactly after the entity.',
        responseShape: '{ metadata: { count, top, skip, ... }, <EntityName>: [...records] }',
        odataParams: ODATA_PARAMS.concat(['$inlinecount=allpages', '$format=json']),
        filterSyntax: {
          string: "field eq 'value'  (single-quote string values)",
          number: 'field eq 2024',
          combine: "expr and expr  /  expr or expr",
          example: "state eq 'TX' and fyDeclared eq 2023 and incidentType eq 'Fire'",
        },
        datasets: Object.entries(DATASETS).map(([entity, d]) => ({
          entity,
          version: d.version,
          path: `/${d.version}/${entity}`,
          description: d.description,
        })),
      };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function femaQuery(entity: string, version: string, params: Record<string, string>): Promise<unknown> {
  const qs = new URLSearchParams(params);
  const res = await fetch(`${BASE}/${version}/${entity}?${qs.toString()}`, {
    headers: { Accept: 'application/json', 'User-Agent': UA },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenFEMA: ${res.status} ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as Record<string, unknown>;
  const metadata = data.metadata;
  const records = data[entity] ?? [];
  return { metadata, records };
}

function clampLimit(v: unknown): number {
  const n = typeof v === 'number' && v > 0 ? Math.trunc(v) : 50;
  return Math.min(n, 1000);
}

function odataEscape(v: string): string {
  return v.replace(/'/g, "''");
}

function reqStr(args: Record<string, unknown>, key: string, example: string): string {
  const v = args[key];
  if (typeof v !== 'string' || !v.trim()) throw new Error(`Required argument "${key}" is missing. Pass a string like ${example}.`);
  return v;
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
