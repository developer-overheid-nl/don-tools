import { visualizeArazzo } from "../helpers/arazzo-visualization.helper.js";
import type { OasInput } from "../types/api.js";

export const arazzoMermaid = async (input: OasInput): Promise<string> => {
  const { mermaid } = await visualizeArazzo(input);
  return mermaid;
};
