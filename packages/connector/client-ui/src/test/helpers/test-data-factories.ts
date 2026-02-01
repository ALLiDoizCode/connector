export function createMockImageFile(
  overrides?: Partial<{
    name: string;
    type: string;
    size: number;
    content: string;
  }>
): File {
  const defaults = {
    name: 'test-image.jpg',
    type: 'image/jpeg',
    size: 1024 * 1024, // 1MB
    content: 'fake image data',
  };
  const props = { ...defaults, ...overrides };

  // Create a blob with the specified size
  // Use the content if provided, otherwise create a buffer of the specified size
  const buffer = props.content
    ? new Array(Math.ceil(props.size / props.content.length))
        .fill(props.content)
        .join('')
        .slice(0, props.size)
    : new Array(props.size).fill('x').join('');

  return new File([buffer], props.name, { type: props.type });
}

export function createMockProcessedBlob(type = 'image/jpeg'): Blob {
  return new Blob(['processed image data'], { type });
}

export function createMockAPIError(code: string, message: string, status = 400) {
  return {
    response: {
      ok: false,
      status,
      json: async () => ({ error: code, message, code }),
    },
  };
}
