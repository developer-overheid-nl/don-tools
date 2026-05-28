import type { FastifyReply, FastifyRequest } from "fastify";
import * as ArazzoMarkdownService from "./services/arazzo-markdown.service.js";
import * as ArazzoMermaidService from "./services/arazzo-mermaid.service.js";
import * as BundleOasService from "./services/bundle-oas.service.js";
import * as ConvertOasService from "./services/convert-oas.service.js";
import * as CreatePostmanCollectionService from "./services/create-postman-collection.service.js";
import * as GenerateOasService from "./services/generate-oas.service.js";
import * as UntrustedClientService from "./services/untrusted-client.service.js";
import * as ValidatorOpenAPIPostService from "./services/validator-openapi-post.service.js";
import type { OasInput, UntrustedClientInput, ValidateInput } from "./types/api.js";

type OasRequest = FastifyRequest<{ Body: OasInput }>;
type ValidateRequest = FastifyRequest<{ Body: ValidateInput }>;
type UntrustedClientRequest = FastifyRequest<{ Body: UntrustedClientInput }>;

const sendBuffer = (reply: FastifyReply, headers: Record<string, string>, buffer: Buffer) => {
  for (const [name, value] of Object.entries(headers)) reply.header(name, value);
  return reply.send(buffer);
};

export class Routes {
  arazzoMarkdown = async (request: OasRequest, reply: FastifyReply) => {
    const markdown = await ArazzoMarkdownService.arazzoMarkdown(request.body);
    reply.header("Content-Type", "text/markdown; charset=utf-8");
    return reply.send(markdown);
  };

  arazzoMermaid = async (request: OasRequest, reply: FastifyReply) => {
    const mermaid = await ArazzoMermaidService.arazzoMermaid(request.body);
    reply.header("Content-Type", "text/plain; charset=utf-8");
    return reply.send(mermaid);
  };

  bundleOAS = async (request: OasRequest, reply: FastifyReply) => {
    const result = await BundleOasService.bundleOAS(request.body);
    return sendBuffer(reply, result.headers, result.rawBody);
  };

  convertOAS = async (request: OasRequest, reply: FastifyReply) => {
    const result = await ConvertOasService.convertOAS(request.body);
    return sendBuffer(reply, result.headers, result.rawBody);
  };

  createPostmanCollection = async (request: OasRequest, reply: FastifyReply) => {
    const result = await CreatePostmanCollectionService.createPostmanCollection(request.body);
    return sendBuffer(reply, result.headers, result.rawBody);
  };

  generateOAS = async (request: OasRequest, reply: FastifyReply) => {
    const result = await GenerateOasService.generateOAS(request.body);
    return sendBuffer(reply, result.headers, result.rawBody);
  };

  untrustedClient = async (request: UntrustedClientRequest, reply: FastifyReply) =>
    reply.send(await UntrustedClientService.untrustedClient(request.body));

  validatorOpenAPIPost = async (request: ValidateRequest, reply: FastifyReply) =>
    reply.send(await ValidatorOpenAPIPostService.validatorOpenAPIPost(request.body));
}
