# Memory CLI API

## MemoryStore

```ts
interface MemoryStore {
  addEntry(input: CreateEntryInput): Promise<Result<MemoryEntry>>;
  getEntry(id: string): Promise<Result<MemoryEntry>>;
  updateEntry(id: string, updates: Partial<CreateEntryInput>): Promise<Result<MemoryEntry>>;
  deleteEntry(id: string): Promise<Result<void>>;
  listEntries(options?: { type?: EntryType; limit?: number }): Promise<Result<MemoryEntry[]>>;

  search(query: string, options?: SearchOptions): Promise<Result<SearchResult[]>>;

  indexFiles(paths?: string[]): Promise<Result<{ added: number; updated: number; removed: number }>>;
  getIndexedFiles(): Promise<Result<IndexedFile[]>>;

  getStats(): Promise<Result<{ totalEntries: number; byType: Record<EntryType, number>; indexedFiles: number; totalChunks: number }>>;

  close(): void;
}
```

## Example

```ts
import { createStore } from './src/db';

const store = createStore();
const result = await store.addEntry({ content: 'Example entry', type: 'fact' });
if (result.success) {
  console.log(result.data.id);
}
store.close();
```

## Error Handling

Every operation returns `Result<T>`:

```ts
type Result<T> =
  | { success: true; data: T; message?: string }
  | { success: false; error: string; code?: string };
```

Check `success` before using data. Errors include a short message and optional `code`.
