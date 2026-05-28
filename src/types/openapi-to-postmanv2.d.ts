declare module "openapi-to-postmanv2" {
  interface ConvertInput {
    type: "string" | "json" | "file";
    data: string;
  }

  interface ConvertResult {
    result: boolean;
    reason?: string;
    output?: Array<{ type: string; data: { info?: { name?: string } } }>;
  }

  type ConvertCallback = (error: Error | null, result: ConvertResult) => void;

  const openapiToPostman: {
    convert: (input: ConvertInput, options: Record<string, unknown>, callback: ConvertCallback) => void;
  };

  export default openapiToPostman;
}
