import type http from 'node:http';

export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/**
 * Safely parses a JSON request body from an IncomingMessage stream.
 * Enforces a maximum payload size to prevent memory exhaustion attacks.
 */
export async function parseJsonBody<T = Record<string, unknown>>(
  req: http.IncomingMessage,
  maxSizeBytes: number = 1024 * 1024 // 1 MB limit
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const contentType = req.headers['content-type'];
    if (contentType && !contentType.includes('application/json')) {
      return reject(
        new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Expected Content-Type: application/json')
      );
    }

    const chunks: Buffer[] = [];
    let receivedBytes = 0;

    req.on('data', (chunk: Buffer) => {
      receivedBytes += chunk.length;
      if (receivedBytes > maxSizeBytes) {
        req.destroy();
        return reject(
          new HttpError(413, 'PAYLOAD_TOO_LARGE', `Request body exceeds maximum size of ${maxSizeBytes} bytes`)
        );
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (chunks.length === 0) {
        return reject(
          new HttpError(400, 'BAD_REQUEST', 'Request body cannot be empty for JSON endpoints')
        );
      }

      const bodyString = Buffer.concat(chunks).toString('utf8');
      try {
        const parsed = JSON.parse(bodyString) as T;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return reject(
            new HttpError(400, 'INVALID_BODY', 'Request body must be a valid JSON object')
          );
        }
        resolve(parsed);
      } catch {
        reject(
          new HttpError(400, 'INVALID_JSON', 'Malformed JSON in request body')
        );
      }
    });

    req.on('error', (err) => {
      reject(new HttpError(500, 'STREAM_ERROR', `Stream reading error: ${err.message}`));
    });
  });
}

/**
 * Sends a standard JSON response.
 */
export function sendJson(res: http.ServerResponse, statusCode: number, data: unknown): void {
  const json = JSON.stringify(data);
  res.setHeader('Content-Type', 'application/json');
  res.writeHead(statusCode);
  res.end(json);
}

/**
 * Sends a structured JSON error response.
 */
export function sendError(
  res: http.ServerResponse,
  statusCode: number,
  code: string,
  message: string
): void {
  sendJson(res, statusCode, {
    error: {
      code,
      message,
    },
  });
}
