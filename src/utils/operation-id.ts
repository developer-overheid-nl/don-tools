export const toLowerCamelCase = (operationId: string): string => {
  if (!operationId) return operationId;
  let result = operationId.trim();
  if (result.length === 0) return result;
  result = result.replace(/[_-]+/g, " ").replace(/[^a-zA-Z0-9_$]+/g, " ");
  result = result
    .split(" ")
    .filter((segment) => segment.length > 0)
    .map((segment, index) =>
      index === 0 ? segment : segment.charAt(0).toUpperCase() + segment.slice(1),
    )
    .join("");
  result = result.replace(/^[^a-zA-Z_$]+/, "");
  if (result.length === 0) return operationId;
  return result.charAt(0).toLowerCase() + result.slice(1);
};
