import { kebabCase, upperCamelCase } from "case-anything";
import { HttpError } from "../utils/problem-details.js";
import { resolveOasInput } from "../helpers/oas-input.helper.js";
import type { OasInput } from "../types/api.js";
import { sanitizeFileName } from "../utils/file-name.js";

const EMPTY_BODY_ERROR = "Body ontbreekt of heeft een ongeldig formaat.";
const INVALID_JSON_ERROR = "Het aangeleverde JSON-document kon niet worden gelezen.";
const NO_RESOURCES_ERROR = "Geef minimaal één resource op in het 'resources' veld.";
const missingValueError = (field: string) => `Eigenschap '${field}' ontbreekt of is ongeldig.`;

interface Contact {
  name: string;
  email: string;
  url: string;
}

interface Resource {
  name: string;
  plural: string;
  readonly: boolean;
}

interface GeneratorConfig {
  title: string;
  description: string;
  contact: Contact;
  resources: Resource[];
}

export interface GeneratorResult {
  headers: Record<string, string>;
  rawBody: Buffer;
}

const toUppercase = (value: string): string =>
  typeof value === "string" && value.length > 0 ? value.charAt(0).toUpperCase() + value.slice(1) : "";

const requireString = (value: unknown, fieldName: string): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(400, missingValueError(fieldName), { detail: `${fieldName} moet een niet-lege string zijn.` });
  }
  return value.trim();
};

const requireObject = (value: unknown, fieldName: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, missingValueError(fieldName), { detail: `${fieldName} moet een object zijn.` });
  }
  return value as Record<string, unknown>;
};

const normalizeContact = (contact: unknown): Contact => {
  const source = requireObject(contact, "contact");
  return {
    name: requireString(source.name, "contact.name"),
    email: requireString(source.email, "contact.email"),
    url: requireString(source.url, "contact.url"),
  };
};

const normalizeResources = (resources: unknown): Resource[] => {
  if (!Array.isArray(resources) || resources.length === 0) {
    throw new HttpError(400, NO_RESOURCES_ERROR, { detail: NO_RESOURCES_ERROR });
  }
  return resources.map((resource, index) => {
    const source = requireObject(resource, `resources[${index}]`);
    return {
      name: requireString(source.name, `resources[${index}].name`),
      plural: requireString(source.plural, `resources[${index}].plural`),
      readonly: Boolean(source.readonly),
    };
  });
};

const parseGeneratorConfig = (contents: string): GeneratorConfig => {
  if (typeof contents !== "string" || contents.trim().length === 0) {
    throw new HttpError(400, EMPTY_BODY_ERROR);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch (error) {
    const message = error instanceof Error ? error.message : INVALID_JSON_ERROR;
    throw new HttpError(400, INVALID_JSON_ERROR, { detail: message });
  }
  const normalized = requireObject(parsed, "root");
  return {
    title: requireString(normalized.title, "title"),
    description: requireString(normalized.description, "description"),
    contact: normalizeContact(normalized.contact),
    resources: normalizeResources(normalized.resources),
  };
};

const REF_BASE = "https://static.developer.overheid.nl/adr/components.yaml";

const createEndpointSingle = (resource: Resource): Record<string, unknown> => {
  const baseName = upperCamelCase(resource.name);
  const schemaRef = `#/components/schemas/${baseName}`;
  const pluralLabel = toUppercase(resource.plural);
  const singularLabel = toUppercase(resource.name);
  const endpoint: Record<string, unknown> = {
    parameters: [{ $ref: "#/components/parameters/id" }],
    get: {
      operationId: `retrieve${baseName}`,
      description: `${singularLabel} ophalen`,
      summary: `${singularLabel} ophalen`,
      tags: [pluralLabel],
      responses: {
        200: {
          headers: { "API-Version": { $ref: `${REF_BASE}#/headers/API-Version` } },
          description: "OK",
          content: { "application/json": { schema: { $ref: schemaRef } } },
        },
        404: { $ref: `${REF_BASE}#/responses/404` },
      },
    },
  };
  if (!resource.readonly) {
    endpoint.put = {
      operationId: `edit${baseName}`,
      description: `${singularLabel} wijzigen`,
      summary: `${singularLabel} wijzigen`,
      tags: [pluralLabel],
      responses: {
        200: {
          headers: { "API-Version": { $ref: `${REF_BASE}#/headers/API-Version` } },
          description: "OK",
          content: { "application/json": { schema: { $ref: schemaRef } } },
        },
        400: { $ref: `${REF_BASE}#/responses/400` },
      },
    };
    endpoint.delete = {
      operationId: `remove${baseName}`,
      description: `${singularLabel} verwijderen`,
      summary: `${singularLabel} verwijderen`,
      tags: [pluralLabel],
      responses: {
        204: { $ref: `${REF_BASE}#/responses/204` },
        404: { $ref: `${REF_BASE}#/responses/404` },
      },
    };
  }
  return endpoint;
};

const createEndpointList = (resource: Resource): Record<string, unknown> => {
  const pluralName = upperCamelCase(resource.plural);
  const schemaRef = `#/components/schemas/${upperCamelCase(resource.name)}`;
  const pluralLabel = toUppercase(resource.plural);
  const endpoint: Record<string, unknown> = {
    get: {
      operationId: `list${pluralName}`,
      description: `Alle ${resource.plural} ophalen`,
      summary: `Alle ${resource.plural} ophalen`,
      tags: [pluralLabel],
      responses: {
        200: {
          headers: {
            "API-Version": { $ref: `${REF_BASE}#/headers/API-Version` },
            Link: { $ref: `${REF_BASE}#/headers/Link` },
          },
          description: "OK",
          content: { "application/json": { schema: { $ref: schemaRef } } },
        },
      },
    },
  };
  if (!resource.readonly) {
    endpoint.post = {
      operationId: `create${pluralName}`,
      description: `Nieuwe ${resource.name} aanmaken`,
      summary: `Nieuwe ${resource.name} aanmaken`,
      tags: [pluralLabel],
      responses: {
        201: {
          headers: { "API-Version": { $ref: `${REF_BASE}#/headers/API-Version` } },
          description: "Created",
          content: { "application/json": { schema: { $ref: schemaRef } } },
        },
        400: { $ref: `${REF_BASE}#/responses/400` },
      },
    };
  }
  return endpoint;
};

const createPaths = (resources: Resource[]): Record<string, unknown> =>
  resources.reduce<Record<string, unknown>>((paths, resource) => {
    const pluralPath = kebabCase(resource.plural);
    paths[`/${pluralPath}`] = createEndpointList(resource);
    paths[`/${pluralPath}/{id}`] = createEndpointSingle(resource);
    return paths;
  }, {});

const createSchemas = (resources: Resource[]): Record<string, unknown> =>
  resources.reduce<Record<string, unknown>>((schemas, resource) => {
    schemas[upperCamelCase(resource.name)] = {
      type: "object",
      properties: { id: { type: "string", format: "uuid" } },
    };
    return schemas;
  }, {});

const buildOpenApiDocument = (cfg: GeneratorConfig): Record<string, unknown> => ({
  openapi: "3.0.2",
  info: {
    title: cfg.title,
    description: cfg.description,
    version: "1.0.0",
    contact: cfg.contact,
  },
  servers: [{ url: "@TODO: Add server URL" }],
  tags: cfg.resources.map((resource) => ({
    name: toUppercase(resource.plural),
    description: `Alle API operaties die bij ${resource.plural} horen.`,
  })),
  paths: createPaths(cfg.resources),
  components: {
    schemas: createSchemas(cfg.resources),
    parameters: {
      id: {
        name: "id",
        in: "path",
        description: "id",
        required: true,
        schema: { type: "string" },
      },
    },
  },
});

const deriveFilename = (title: string): string => {
  const sanitized = sanitizeFileName(title, { fallback: "openapi-boilerplate", lowercase: true });
  return sanitized ? `${sanitized}.json` : "openapi-boilerplate.json";
};

export const generateOAS = async (input: OasInput): Promise<GeneratorResult> => {
  const { contents } = await resolveOasInput(input);
  const cfg = parseGeneratorConfig(contents);
  const document = buildOpenApiDocument(cfg);
  const filename = deriveFilename(cfg.title);
  const buffer = Buffer.from(JSON.stringify(document, null, 2), "utf8");
  return {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
    rawBody: buffer,
  };
};
