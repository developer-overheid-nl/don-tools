import { visualizeArazzo } from "../helpers/arazzo-visualization.helper.js";
import type { OasInput } from "../types/api.js";

export const arazzoMarkdown = async (input: OasInput): Promise<string> => {
  const { markdown } = await visualizeArazzo(input);
  return markdown;
};
