/**
 * Mock for Cytoscape.js library
 * Provides mock implementations of core Cytoscape APIs for testing
 */

import type cytoscape from 'cytoscape';

interface MockElement {
  data: (key?: string, value?: unknown) => unknown;
  id: () => string;
  position: (pos?: { x: number; y: number }) => { x: number; y: number };
  remove: () => void;
}

interface MockCollection {
  data: (key?: string, value?: unknown) => unknown;
  forEach: (callback: (element: MockElement) => void) => void;
  filter: (selector: string | ((element: MockElement) => boolean)) => MockCollection;
  length: number;
  [Symbol.iterator]: () => Iterator<MockElement>;
}

interface MockCore {
  nodes: jest.Mock<MockCollection>;
  edges: jest.Mock<MockCollection>;
  add: jest.Mock<MockCollection>;
  remove: jest.Mock<MockCollection>;
  getElementById: jest.Mock<MockElement | undefined>;
  style: jest.Mock<MockCore>;
  layout: jest.Mock<{ run: jest.Mock; stop: jest.Mock }>;
  on: jest.Mock<MockCore>;
  off: jest.Mock<MockCore>;
  one: jest.Mock<MockCore>;
  fit: jest.Mock<void>;
  center: jest.Mock<void>;
  zoom: jest.Mock<number>;
  pan: jest.Mock<{ x: number; y: number }>;
  destroy: jest.Mock<void>;
  ready: jest.Mock<void>;
  elements: jest.Mock<MockCollection>;
  $: jest.Mock<MockCollection>;
}

const createMockElement = (id: string, data: Record<string, unknown> = {}): MockElement => {
  const elementData: Record<string, unknown> = { id, ...data };
  return {
    data: jest.fn((key?: string, value?: unknown): unknown => {
      if (key === undefined) return elementData;
      if (value !== undefined) {
        elementData[key] = value;
        return undefined;
      }
      return elementData[key];
    }),
    id: jest.fn(() => id),
    position: jest.fn((pos?: { x: number; y: number }) => pos || { x: 0, y: 0 }),
    remove: jest.fn(),
  };
};

const createMockCollection = (elements: MockElement[] = []): MockCollection => {
  return {
    data: jest.fn((key?: string, value?: unknown): unknown => {
      if (elements.length > 0 && elements[0]) return elements[0].data(key, value);
      return undefined;
    }),
    forEach: jest.fn((callback: (element: MockElement) => void) => {
      elements.forEach(callback);
    }),
    filter: jest.fn((selector: string | ((element: MockElement) => boolean)) => {
      const filtered = typeof selector === 'function' ? elements.filter(selector) : elements;
      return createMockCollection(filtered);
    }),
    length: elements.length,
    [Symbol.iterator]: function* () {
      yield* elements;
    },
  };
};

let mockCoreInstance: MockCore | null = null;

export const createMockCytoscape = (): MockCore => {
  const mockElements: MockElement[] = [];

  const mockCore: MockCore = {
    nodes: jest.fn(() => {
      const nodeElements = mockElements.filter((el) => !el.data('source'));
      return createMockCollection(nodeElements);
    }),
    edges: jest.fn(() => {
      const edgeElements = mockElements.filter((el) => el.data('source'));
      return createMockCollection(edgeElements);
    }),
    add: jest.fn((eleData: unknown) => {
      const elements = Array.isArray(eleData) ? eleData : [eleData];
      const newElements: MockElement[] = [];

      elements.forEach((ele: { data?: { id?: string } }) => {
        if (ele.data?.id) {
          const mockEl = createMockElement(ele.data.id, ele.data);
          mockElements.push(mockEl);
          newElements.push(mockEl);
        }
      });

      return createMockCollection(newElements);
    }),
    remove: jest.fn((selector: string) => {
      const index = mockElements.findIndex((el) => el.id() === selector.replace('#', ''));
      if (index >= 0) {
        const removed = mockElements.splice(index, 1);
        return createMockCollection(removed);
      }
      return createMockCollection([]);
    }),
    getElementById: jest.fn((id: string) => {
      return mockElements.find((el) => el.id() === id);
    }),
    style: jest.fn(() => mockCore),
    layout: jest.fn(() => ({
      run: jest.fn(),
      stop: jest.fn(),
    })),
    on: jest.fn(() => mockCore),
    off: jest.fn(() => mockCore),
    one: jest.fn(() => mockCore),
    fit: jest.fn(),
    center: jest.fn(),
    zoom: jest.fn(() => 1),
    pan: jest.fn(() => ({ x: 0, y: 0 })),
    destroy: jest.fn(),
    ready: jest.fn((callback: () => void) => {
      callback();
    }),
    elements: jest.fn(() => createMockCollection(mockElements)),
    $: jest.fn((_selector: string) => createMockCollection(mockElements)),
  };

  mockCoreInstance = mockCore;
  return mockCore;
};

const cytoscapeMock = jest.fn((options?: cytoscape.CytoscapeOptions) => {
  const core = createMockCytoscape();

  // Call cy callback if provided (for react-cytoscapejs)
  if (options && 'cy' in options && typeof options.cy === 'function') {
    options.cy(core as unknown as cytoscape.Core);
  }

  return core as unknown as cytoscape.Core;
});

// Export helper to get the current mock instance for testing
export const getMockCytoscapeInstance = (): MockCore | null => mockCoreInstance;

// Export helper to reset the mock
export const resetMockCytoscape = (): void => {
  mockCoreInstance = null;
};

export default cytoscapeMock;
