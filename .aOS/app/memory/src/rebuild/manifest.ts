export interface EntityManifestRow {
  path: string;
  name: string;
  type: string;
  bucket: 'projects' | 'people' | 'areas' | 'resources' | 'archives';
  tags: string[];
  factCount: number;
  lastUpdated: string;
}

export interface ManifestDiff {
  beforeEntityCount: number;
  afterEntityCount: number;
  addedPaths: string[];
  removedPaths: string[];
  changedFactCounts: Array<{ path: string; before: number; after: number; delta: number }>;
}

export const diffEntityManifests = (
  before: EntityManifestRow[],
  after: EntityManifestRow[],
): ManifestDiff => {
  const beforeMap = new Map(before.map((row) => [row.path, row]));
  const afterMap = new Map(after.map((row) => [row.path, row]));

  const beforePaths = [...beforeMap.keys()].sort((a, b) => a.localeCompare(b));
  const afterPaths = [...afterMap.keys()].sort((a, b) => a.localeCompare(b));

  const addedPaths = afterPaths.filter((path) => !beforeMap.has(path));
  const removedPaths = beforePaths.filter((path) => !afterMap.has(path));

  const changedFactCounts = beforePaths
    .filter((path) => afterMap.has(path))
    .map((path) => {
      const pre = beforeMap.get(path)!;
      const post = afterMap.get(path)!;
      return {
        path,
        before: pre.factCount,
        after: post.factCount,
        delta: post.factCount - pre.factCount,
      };
    })
    .filter((row) => row.delta !== 0);

  return {
    beforeEntityCount: before.length,
    afterEntityCount: after.length,
    addedPaths,
    removedPaths,
    changedFactCounts,
  };
};
