export interface PriorityQueueItem<T> {
  item: T;
  priority: number;
}

export type CompareFn<T> = (a: PriorityQueueItem<T>, b: PriorityQueueItem<T>) => number;

export class PriorityQueue<T> {
  private heap: PriorityQueueItem<T>[] = [];
  private compare: CompareFn<T>;

  constructor(compareFn?: CompareFn<T>) {
    // Default to min-heap (lower priority values come first)
    this.compare = compareFn || ((a, b) => a.priority - b.priority);
  }

  private swap(i: number, j: number): void {
    [this.heap[i], this.heap[j]] = [this.heap[j], this.heap[i]];
  }

  private bubbleUp(index: number = this.heap.length - 1): void {
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2);
      if (this.compare(this.heap[index], this.heap[parentIndex]) >= 0) break;
      this.swap(index, parentIndex);
      index = parentIndex;
    }
  }

  private bubbleDown(index: number = 0): void {
    const length = this.heap.length;

    while (true) {
      const leftChild = 2 * index + 1;
      const rightChild = 2 * index + 2;
      let targetIndex = index;

      if (leftChild < length && this.compare(this.heap[leftChild], this.heap[targetIndex]) < 0) {
        targetIndex = leftChild;
      }

      if (rightChild < length && this.compare(this.heap[rightChild], this.heap[targetIndex]) < 0) {
        targetIndex = rightChild;
      }

      if (targetIndex === index) break;

      this.swap(index, targetIndex);
      index = targetIndex;
    }
  }

  enqueue(item: T, priority: number): void {
    this.heap.push({ item, priority });
    this.bubbleUp();
  }

  dequeue(): T | undefined {
    if (this.heap.length === 0) return undefined;

    const result = this.heap[0].item;
    const lastItem = this.heap.pop()!;

    if (this.heap.length > 0) {
      this.heap[0] = lastItem;
      this.bubbleDown();
    }

    return result;
  }

  dequeueLessThan(threshold: number): T[] {
    const result: T[] = [];
    const tempItems: PriorityQueueItem<T>[] = [];

    // Extract all items less than threshold in proper priority order
    while (this.heap.length > 0 && this.heap[0].priority < threshold) {
      const topItem = this.heap[0];
      result.push(topItem.item);
      tempItems.push(topItem);

      // Remove the top item
      const lastItem = this.heap.pop()!;
      if (this.heap.length > 0) {
        this.heap[0] = lastItem;
        this.bubbleDown();
      }
    }

    return result;
  }

  peek(): PriorityQueueItem<T> | undefined {
    return this.heap.length > 0 ? { ...this.heap[0] } : undefined;
  }

  peekItem(): T | undefined {
    return this.heap.length > 0 ? this.heap[0].item : undefined;
  }

  peekPriority(): number | undefined {
    return this.heap.length > 0 ? this.heap[0].priority : undefined;
  }

  isEmpty(): boolean {
    return this.heap.length === 0;
  }

  size(): number {
    return this.heap.length;
  }

  clear(): void {
    this.heap.length = 0;
  }

  // Convert to array (useful for debugging/testing)
  toArray(): PriorityQueueItem<T>[] {
    return this.heap.map((item) => ({ ...item }));
  }
}
