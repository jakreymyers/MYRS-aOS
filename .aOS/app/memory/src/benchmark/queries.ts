export interface BenchmarkQuery {
  id: number;
  category: string;
  query: string;
  /** Entity paths that should appear in top results */
  expectedEntities: string[];
  /** For noise queries: expect few/no relevant results */
  expectNoise?: boolean;
}

export const BENCHMARK_QUERIES: BenchmarkQuery[] = [
  // Exact name lookups
  {
    id: 1, category: 'exact-name', query: 'Sandy Weldon',
    expectedEntities: ['people/sandy-weldon'],
  },
  {
    id: 2, category: 'exact-name', query: 'PRISM',
    expectedEntities: ['archives/prism', 'projects/prism-modernization'],
  },
  {
    id: 3, category: 'exact-name', query: 'Dylan Moulton',
    expectedEntities: ['people/dylan-moulton'],
  },

  // Role lookups
  {
    id: 4, category: 'role-lookup', query: 'who is the Director of Finance',
    expectedEntities: ['people/sandy-weldon', 'areas/departments/finance'],
  },
  {
    id: 5, category: 'role-lookup', query: 'who manages the editorial department',
    expectedEntities: ['people/jessica-thomas', 'areas/departments/editorial'],
  },

  // Relationship queries
  {
    id: 6, category: 'relationship', query: 'who reports to Beth Gunzel',
    expectedEntities: ['people/beth-gunzel'],
  },
  {
    id: 7, category: 'relationship', query: "Jak's direct reports",
    expectedEntities: ['people/jak-myers'],
  },

  // Conceptual queries
  {
    id: 8, category: 'conceptual', query: 'departments working on AI initiatives',
    expectedEntities: ['areas/departments/information-systems', 'projects/ai-strategy', 'projects/ai-adoption'],
  },
  {
    id: 9, category: 'conceptual', query: 'digital transformation efforts',
    expectedEntities: ['projects/publications-workflow-transformation', 'areas/departments/information-systems'],
  },
  {
    id: 10, category: 'conceptual', query: 'customer experience improvements',
    expectedEntities: ['projects/experience-design', 'areas/departments/information-systems'],
  },

  // Cross-entity queries
  {
    id: 11, category: 'cross-entity', query: 'collaboration between marketing and sales',
    expectedEntities: ['areas/departments/marketing', 'areas/departments/sales'],
  },
  {
    id: 12, category: 'cross-entity', query: 'publishing technology stack',
    expectedEntities: ['projects/publications-workflow-transformation', 'areas/departments/editorial'],
  },

  // Temporal queries
  {
    id: 13, category: 'temporal', query: 'recent organizational changes',
    expectedEntities: ['areas/departments/information-systems', 'projects/2026-is-planning'],
  },
  {
    id: 14, category: 'temporal', query: '2026 department goals',
    expectedEntities: ['projects/2026-is-planning', 'projects/2026-business-plan'],
  },

  // Synonym/paraphrase queries
  {
    id: 15, category: 'synonym', query: 'staff restructuring',
    expectedEntities: ['areas/departments/human-resources', 'areas/departments/information-systems'],
  },
  {
    id: 16, category: 'synonym', query: 'budget oversight process',
    expectedEntities: ['areas/departments/finance', 'people/sandy-weldon'],
  },

  // Specific fact queries
  {
    id: 17, category: 'specific-fact', query: 'how many staff in the finance department',
    expectedEntities: ['people/sandy-weldon', 'areas/departments/finance'],
  },
  {
    id: 18, category: 'specific-fact', query: 'what tools does the IS department use',
    expectedEntities: ['areas/departments/information-systems'],
  },

  // Noise resistance queries (should return few/no results)
  {
    id: 19, category: 'noise', query: 'quantum computing research papers',
    expectedEntities: [], expectNoise: true,
  },
  {
    id: 20, category: 'noise', query: 'machine learning model training',
    expectedEntities: [], expectNoise: true,
  },
];
