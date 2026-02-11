export const snippetify = (content: string, maxLen = 300): string => {
  const clean = content.trim().replace(/\s+/g, ' ');
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, maxLen - 1)}…`;
};
